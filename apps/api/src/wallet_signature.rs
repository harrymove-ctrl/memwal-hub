use base64::{Engine, engine::general_purpose::STANDARD};
use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::error::ApiError;

const PERSONAL_MESSAGE_INTENT: [u8; 3] = [3, 0, 0];

/// Ed25519 and secp256k1 (Slush and other Wallet Standard wallets) verify
/// in-process. zkLogin (Enoki / Google, scheme `0x05`) is detected separately
/// and verified by `scripts/verify-zklogin.mjs`.
pub(crate) fn verify_wallet_signature(
    address: &str,
    message: &str,
    signature: &str,
) -> Result<(), ApiError> {
    let bytes = decode_signature(signature)?;
    let digest = personal_message_digest(message.as_bytes());
    let signer = match bytes[0] {
        0x00 => verify_ed25519(&bytes[1..], &digest)?,
        0x01 => verify_secp256k1(&bytes[1..], &digest)?,
        _ => return Err(ApiError::Unauthorized),
    };
    if signer != normalize_sui_address(address)? {
        return Err(ApiError::Unauthorized);
    }
    Ok(())
}

pub(crate) fn is_zklogin_signature(signature: &str) -> bool {
    decode_signature(signature)
        .ok()
        .is_some_and(|bytes| bytes.first() == Some(&0x05))
}

fn decode_signature(signature: &str) -> Result<Vec<u8>, ApiError> {
    let bytes = STANDARD
        .decode(signature.trim())
        .map_err(|_| ApiError::Unauthorized)?;
    if bytes.is_empty() {
        return Err(ApiError::Unauthorized);
    }
    Ok(bytes)
}

pub(crate) fn normalize_sui_address(raw: &str) -> Result<String, ApiError> {
    let hex = raw.trim().trim_start_matches("0x").trim_start_matches("0X");
    if hex.is_empty() || hex.len() > 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::Validation(
            "Wallet address must be a Sui address.",
        ));
    }
    Ok(format!("0x{:0>64}", hex.to_ascii_lowercase()))
}

fn personal_message_digest(message: &[u8]) -> [u8; 32] {
    let mut preimage = Vec::with_capacity(3 + 10 + message.len());
    preimage.extend_from_slice(&PERSONAL_MESSAGE_INTENT);
    write_uleb128(&mut preimage, message.len());
    preimage.extend_from_slice(message);
    let hash = Blake2b::<U32>::digest(&preimage);
    hash.into()
}

fn write_uleb128(out: &mut Vec<u8>, mut value: usize) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn verify_ed25519(body: &[u8], digest: &[u8; 32]) -> Result<String, ApiError> {
    if body.len() != 96 {
        return Err(ApiError::Unauthorized);
    }
    let signature = Signature::from_bytes(body[..64].try_into().expect("64"));
    let key = VerifyingKey::from_bytes(body[64..].try_into().expect("32"))
        .map_err(|_| ApiError::Unauthorized)?;
    key.verify(digest, &signature)
        .map_err(|_| ApiError::Unauthorized)?;
    Ok(sui_address(0x00, key.as_bytes()))
}

fn verify_secp256k1(body: &[u8], digest: &[u8; 32]) -> Result<String, ApiError> {
    if body.len() != 97 {
        return Err(ApiError::Unauthorized);
    }
    let signature = k256::ecdsa::Signature::from_bytes((&body[..64]).into())
        .map_err(|_| ApiError::Unauthorized)?;
    let key = k256::ecdsa::VerifyingKey::from_sec1_bytes(&body[64..])
        .map_err(|_| ApiError::Unauthorized)?;
    k256::ecdsa::signature::Verifier::verify(&key, digest.as_slice(), &signature)
        .map_err(|_| ApiError::Unauthorized)?;
    Ok(sui_address(0x01, &body[64..]))
}

fn sui_address(flag: u8, public_key: &[u8]) -> String {
    let mut preimage = Vec::with_capacity(1 + public_key.len());
    preimage.push(flag);
    preimage.extend_from_slice(public_key);
    let hash = Blake2b::<U32>::digest(&preimage);
    let mut address = String::from("0x");
    for byte in &hash[..32] {
        address.push_str(&format!("{byte:02x}"));
    }
    address
}

#[cfg(test)]
mod tests {
    use super::verify_wallet_signature;

    const MESSAGE: &str = "Sign in to Bew Harness\n\nAddress: 0xabc\nNonce: deadbeef\n\nThis request does not move funds.";

    #[test]
    fn ed25519_personal_message_recovers_the_signer() {
        verify_wallet_signature(
            "0x97a999125dc0a95256eb84698019a3c36b465cbe5c36a89b44e24dc58285f5ac",
            MESSAGE,
            "ALhGEDPa9ULGTtWtmt8+OF/UP6PZhY6u7SQqp0iNsgtLOZxKM7DDcVOdt0SK9OEUtzwBqZj2N1nqDHAoWWy/3QYB4ba0VMzm8Kkp6irRYa9yEr3+r6iUndchaNswq+UGyg==",
        )
        .expect("ed25519 vector");
    }

    #[test]
    fn secp256k1_personal_message_recovers_the_signer() {
        verify_wallet_signature(
            "0x0ec44ef97a6315ea25487b775c2338172fe515dc3e2bc696cb52788e9251d0ec",
            MESSAGE,
            "AcVzTUjQWhjhaBFvDtQUwB2XMssBpHK43ao2DwQIhDmnZAp/dnuQsPhtH3U9pt+jANM71+Wa+ztagO+fixELt9QCNA84TH1LtHueQzR60zQH2YXMbftqEUldDRHHBcczhCo=",
        )
        .expect("secp256k1 vector");
    }

    #[test]
    fn a_signature_for_another_address_is_rejected() {
        assert!(
            verify_wallet_signature(
                "0x0000000000000000000000000000000000000000000000000000000000000001",
                MESSAGE,
                "ALhGEDPa9ULGTtWtmt8+OF/UP6PZhY6u7SQqp0iNsgtLOZxKM7DDcVOdt0SK9OEUtzwBqZj2N1nqDHAoWWy/3QYB4ba0VMzm8Kkp6irRYa9yEr3+r6iUndchaNswq+UGyg==",
            )
            .is_err()
        );
    }
}
