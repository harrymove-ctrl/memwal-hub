import {
  useConnectWallet,
  useSignPersonalMessage,
  useWallets,
} from "@mysten/dapp-kit";
import { Dialog } from "radix-ui";
import { Component, useEffect, useState, type ReactNode } from "react";

import WalletProviders from "@/components/wallet-providers";
import authService, { AuthServiceError } from "@/services/auth";

import { AppIcon } from "./AppIcon";
import { clearWalrus, memorySession, saveWalrus, type WalrusStatus } from "../services/wallet-recall";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [walrus, setWalrus] = useState<WalrusStatus | null>(null);
  const [accountId, setAccountId] = useState("");
  const [delegateKey, setDelegateKey] = useState("");
  const [namespace, setNamespace] = useState("bew-harness/product-discovery");
  const [serverUrl, setServerUrl] = useState("https://relayer.memory.walrus.xyz");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void memorySession().then((session) => {
      setAddress(session.address);
      setWalrus(session.walrus);
      setAccountId(session.walrus.accountId ?? "");
      setNamespace(session.walrus.namespace);
      setServerUrl(session.walrus.serverUrl);
    }).catch(() => setError("Memory status could not be loaded."));
  }, [open]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveWalrus({ accountId, delegateKey, namespace, serverUrl });
      setDelegateKey("");
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError("");
    try {
      await clearWalrus();
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Clear failed.");
      setBusy(false);
    }
  }

  async function signOut() {
    await authService.logout();
    window.location.reload();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog bew-builder settings" aria-describedby="settings-desc">
          <header className="settings-head">
            <div>
              <Dialog.Title>Settings</Dialog.Title>
              <p id="settings-desc">Memory and Console stay separate. A model provider does not connect either one. The delegate key never returns to this browser.</p>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close settings">×</Dialog.Close>
          </header>

          <section className="settings-card">
            <div className="settings-card-head">
              <h2 className="thumb-title"><AppIcon app="console" size={20} /> Walrus Console</h2>
              <span className="badge amber">Not connected</span>
            </div>
            <p className="hint">File upload is not available in this workspace yet. Signing in does not connect Console.</p>
            <WalletBoundary>
              {address ? (
                <div className="settings-row">
                  <code>{address}</code>
                  <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
                </div>
              ) : (
                <WalletProviders>
                  <WalletSignIn />
                </WalletProviders>
              )}
            </WalletBoundary>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <h2 className="thumb-title"><AppIcon app="memory" size={20} /> Walrus Memory</h2>
              <span className={walrus?.status === "verified" ? "badge" : "badge amber"}>{walrus?.status === "verified" ? "Ready" : walrus?.status === "requires_reconnect" ? "Needs attention" : "Not connected"}</span>
            </div>
            <p className="hint">{walrus?.lastError ?? (walrus?.status === "verified" ? `Account ${walrus.accountId} is ready for this user. This is not Console, and it is not owner-wallet proof.` : "No verified delegate key for this user. Recall will not invent a memory.")}</p>
            <label className="field">Account ID<input className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)} autoComplete="off" /></label>
            <label className="field">Delegate key<input className="input" type="password" autoComplete="off" value={delegateKey} onChange={(event) => setDelegateKey(event.target.value)} placeholder={walrus?.configured ? "Replace the stored key" : "suiprivkey1…"} /></label>
            <div className="settings-split">
              <label className="field">Namespace<input className="input" value={namespace} onChange={(event) => setNamespace(event.target.value)} /></label>
              <label className="field">Server<input className="input" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label>
            </div>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="btn" disabled={busy || !walrus?.configured} onClick={() => void clear()}>Clear key</button>
              <button type="button" className="btn btn-primary" disabled={busy || !address || !accountId.trim() || !delegateKey.trim()} onClick={() => void save()}>{busy ? "Saving" : "Save"}</button>
            </div>
          </section>
          <ConsoleCustody />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

class WalletBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) return <p className="hint">Wallet sign-in could not open. Memory settings below still work.</p>;
    return this.props.children;
  }
}

function ConsoleCustody() {
  const [mode, setMode] = useState("this application");
  const [stored, setStored] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="thumb-title"><AppIcon app="console" size={20} /> Walrus Console</h2>
        <span className="badge amber">Not connected</span>
      </div>
      <p className="hint">Console encrypts private files before upload. The selected custody mode determines whether encryption and decryption happen in this application or through the local MCP client. This application does not claim it cannot read a file it encrypts. Saving these fields does not upload a file and does not show the keys again.</p>
      <label className="field">Custody mode
        <select className="input" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option>this application</option>
          <option>local MCP client</option>
        </select>
      </label>
      <label className="field">API key<input className="input" type="password" autoComplete="off" value={stored ? "" : apiKey} placeholder={stored ? "Accepted. Not shown again." : ""} onChange={(event) => setApiKey(event.target.value)} /></label>
      <label className="field">Service private key<input className="input" type="password" autoComplete="off" value={stored ? "" : serviceKey} placeholder={stored ? "Accepted. Not shown again." : ""} onChange={(event) => setServiceKey(event.target.value)} /></label>
      <button type="button" className="btn" onClick={() => { setStored(Boolean(apiKey || serviceKey)); setApiKey(""); setServiceKey(""); }}>Accept keys without showing them again</button>
    </section>
  );
}

function WalletSignIn() {
  const wallets = useWallets();
  const { mutateAsync: connect } = useConnectWallet();
  const { mutateAsync: signMessage } = useSignPersonalMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function connectAndSign(walletName: string) {
    const wallet = wallets.find((item) => item.name === walletName);
    if (!wallet) return;
    setError(null);
    setBusy(wallet.name);
    try {
      const { accounts } = await connect({ wallet });
      const address = accounts[0]?.address;
      if (!address) throw new Error("Wallet returned no account.");
      const challenge = await authService.walletNonce(address);
      const signed = await signMessage({ message: new TextEncoder().encode(challenge.message) });
      await authService.walletLogin({ address, nonce: challenge.nonce, signature: signed.signature });
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof AuthServiceError || caught instanceof Error ? caught.message : "Wallet sign-in failed.");
      setBusy(null);
    }
  }

  if (wallets.length === 0) {
    return <p className="hint">No wallet detected. Install Slush, then reopen Settings.</p>;
  }
  return (
    <div className="settings-wallets">
      {wallets.map((wallet) => (
        <button key={wallet.name} type="button" className="btn settings-wallet" disabled={busy !== null} onClick={() => void connectAndSign(wallet.name)}>
          <WalletThumb icon={"icon" in wallet ? String(wallet.icon ?? "") : ""} name={wallet.name} />
          <span>{busy === wallet.name ? "Waiting for signature…" : wallet.name}</span>
        </button>
      ))}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

function WalletThumb({ icon, name }: { icon: string; name: string }) {
  if (icon.startsWith("data:") || icon.startsWith("http")) {
    return <img className="thumb-img" src={icon} alt="" width={20} height={20} />;
  }
  return <AppIcon app={name.toLowerCase()} size={20} />;
}
