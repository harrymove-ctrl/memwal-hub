import {
  useConnectWallet,
  useSignPersonalMessage,
  useWallets,
} from "@mysten/dapp-kit";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import authService, { AuthServiceError } from "@/services/auth";
import type { AuthenticatedUser } from "@/services/auth";

interface WalletLoginProps {
  onAuthenticated: (user: AuthenticatedUser) => void;
}

export default function WalletLogin({ onAuthenticated }: WalletLoginProps) {
  const wallets = useWallets();
  const { mutateAsync: connect } = useConnectWallet();
  const { mutateAsync: signMessage } = useSignPersonalMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function signIn(address: string) {
    const challenge = await authService.walletNonce(address);
    const signed = await signMessage({
      message: new TextEncoder().encode(challenge.message),
    });
    return authService.walletLogin({
      address,
      nonce: challenge.nonce,
      signature: signed.signature,
    });
  }

  async function connectAndSign(walletName: string) {
    const wallet = wallets.find((item) => item.name === walletName);
    if (!wallet) return;
    setError(null);
    setBusy(wallet.name);
    try {
      const { accounts } = await connect({ wallet });
      const address = accounts[0]?.address;
      if (!address) throw new Error("Wallet returned no account.");
      onAuthenticated(await signIn(address));
    } catch (caught) {
      setError(
        caught instanceof AuthServiceError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Wallet sign-in failed.",
      );
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        Or prove a Sui address. Slush signs in the wallet. Google appears when
        Enoki is configured. Nothing here moves funds.
      </p>
      {wallets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No wallet detected. Install Slush, then reopen this dialog.
        </p>
      ) : (
        <ul className="grid gap-2">
          {wallets.map((wallet) => (
            <li key={wallet.name}>
              <Button
                className="w-full"
                disabled={busy !== null}
                onClick={() => void connectAndSign(wallet.name)}
                type="button"
                variant="outline"
              >
                {busy === wallet.name ? "Waiting for signature…" : wallet.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
