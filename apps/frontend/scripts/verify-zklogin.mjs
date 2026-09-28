import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { normalizeSuiAddress } from "@mysten/sui/utils";

const raw = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", reject);
});

const { address, message, signature } = JSON.parse(raw);
const client = new SuiClient({ url: getFullnodeUrl("testnet") });

try {
  const publicKey = await verifyPersonalMessageSignature(
    new TextEncoder().encode(message),
    signature,
    { address, client },
  );
  const recovered = normalizeSuiAddress(publicKey.toSuiAddress());
  if (recovered !== normalizeSuiAddress(address)) {
    console.log(JSON.stringify({ ok: false, error: "Signature is for a different address." }));
  } else {
    console.log(JSON.stringify({ ok: true }));
  }
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Signature invalid.",
    }),
  );
}
