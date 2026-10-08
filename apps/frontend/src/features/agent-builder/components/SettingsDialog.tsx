import {
  useConnectWallet,
  useSignPersonalMessage,
  useWallets,
} from "@mysten/dapp-kit";
import { Dialog } from "radix-ui";
import { Component, useState, type ReactNode } from "react";

import WalletProviders from "@/components/wallet-providers";
import authService, { AuthServiceError } from "@/services/auth";

import { AppIcon } from "./AppIcon";
import { ModelProxyDialog } from "./ModelProxyDialog";
import { BuilderApiError } from "../services/api-client";
import { proxyBadge } from "../services/model-proxy";
import { DEFAULT_NAMESPACE, memoryBadge, memoryErrorLabel, type MemorySession } from "../services/wallet-recall";
import {
  useDisconnectMemory,
  useDisconnectModelProxy,
  useMemorySession,
  useModelProxyStatus,
  useSaveMemory,
} from "../state/integration-queries";

interface DialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: DialogProps) {
  const session = useMemorySession();
  const proxy = useModelProxyStatus();
  const disconnectMemory = useDisconnectMemory();
  const disconnectProxy = useDisconnectModelProxy();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const address = session.data?.address ?? null;
  const memory = memoryBadge(session.data, session.error, false);
  const proxyState = proxyBadge(proxy.data, false);

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
              <p id="settings-desc">Each connection is separate: the model proxy does not connect Memory, and Memory does not connect the proxy.</p>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close settings">×</Dialog.Close>
          </header>
          <section className="settings-card">
            <div className="settings-card-head">
              <h2>Workspace sign-in</h2>
              <span className={session.data?.signedIn ? "badge" : "badge amber"}>{session.data?.signedIn ? "Signed in" : session.error ? "Unknown" : "Signed out"}</span>
            </div>
            <p className="hint">Workspace sign-in creates this session. It does not connect Walrus Memory, Walrus Console or a model.</p>
            {session.error ? <p className="error" role="alert">{session.error instanceof Error ? session.error.message : "The backend did not respond."}</p> : null}
            <WalletBoundary>
              {session.data?.signedIn ? (
                <div className="settings-row">
                  <code>{address ?? "Signed in with a workspace account"}</code>
                  <button type="button" className="btn" onClick={() => void signOut()}>Sign out</button>
                </div>
              ) : session.data ? (
                <WalletProviders>
                  <WalletSignIn />
                </WalletProviders>
              ) : null}
            </WalletBoundary>
          </section>
          <section className="settings-card">
            <div className="settings-card-head">
              <h2 className="thumb-title"><AppIcon app="zroute" size={20} /> ZRouter / OpenAI-compatible proxy</h2>
              <span className={proxyState.tone === "ok" ? "badge" : "badge amber"}>{proxy.error ? "Unavailable" : proxyState.label}</span>
            </div>
            <p className="hint">{proxy.data?.configured ? `${proxy.data.connection_name} · ${proxy.data.model_id}` : "Use your proxy endpoint and model for chat responses."}</p>
            <div className="settings-row">
              <button type="button" className="btn btn-primary" onClick={() => setProxyOpen(true)}>{proxy.data?.configured ? "Manage" : "Configure"}</button>
              {proxy.data?.configured ? <button type="button" className="btn" disabled={disconnectProxy.isPending} onClick={() => disconnectProxy.mutate()}>Disconnect</button> : null}
            </div>
          </section>
          <section className="settings-card">
            <div className="settings-card-head">
              <h2 className="thumb-title"><AppIcon app="memory" size={20} /> Walrus Memory</h2>
              <span className={memory.tone === "ok" ? "badge" : "badge amber"}>{memory.label}</span>
            </div>
            <p className="hint">{memoryDetail(session.data, session.error)}</p>
            <div className="settings-row">
              <button type="button" className="btn btn-primary" disabled={!session.data?.signedIn} onClick={() => setMemoryOpen(true)}>{session.data?.walrus.configured ? "Manage" : "Connect"}</button>
              {session.data?.walrus.configured ? <button type="button" className="btn" disabled={disconnectMemory.isPending} onClick={() => disconnectMemory.mutate()}>Disconnect</button> : null}
            </div>
          </section>
          <section className="settings-card">
            <div className="settings-card-head">
              <h2 className="thumb-title"><AppIcon app="console" size={20} /> Walrus Console</h2>
              <span className="badge amber">Unavailable</span>
            </div>
            <p className="hint">Optional. File upload is not available in this workspace, and nothing else depends on it.</p>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
      <MemoryConnectDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} />
      <ModelProxyDialog open={proxyOpen} onClose={() => setProxyOpen(false)} />
    </Dialog.Root>
  );
}

export function memoryDetail(session: MemorySession | undefined, error: unknown): string {
  if (error) return error instanceof Error ? error.message : "The memory status could not be loaded.";
  if (!session) return "Loading Memory status.";
  if (!session.signedIn) return "Sign in to the workspace before connecting Memory.";
  const walrus = session.walrus;
  if (walrus.status === "verified") return `Mainnet · namespace ${walrus.namespace} · verified by a signed relayer request`;
  if (walrus.configured) return memoryErrorLabel(walrus.lastErrorCode, walrus.lastError);
  return "Connect a delegate key for this signed-in user. Recall never invents a memory.";
}

export function MemoryConnectDialog({ open, onClose }: DialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog bew-builder settings" aria-describedby="memory-connect-desc">
          {open ? <MemoryConnectForm onClose={onClose} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MemoryConnectForm({ onClose }: { onClose: () => void }) {
  const session = useMemorySession();
  const save = useSaveMemory();
  const walrus = session.data?.walrus;
  const [accountId, setAccountId] = useState(walrus?.accountId ?? "");
  const [delegateKey, setDelegateKey] = useState("");
  const [namespace, setNamespace] = useState(walrus?.namespace ?? DEFAULT_NAMESPACE);
  const [advanced, setAdvanced] = useState(false);
  const [localError, setLocalError] = useState("");
  const keyStored = Boolean(walrus?.configured);

  function submit() {
    setLocalError("");
    if (!/^0x[0-9a-fA-F]{64}$/.test(accountId.trim())) {
      setLocalError("Enter the Memory account ID: 0x followed by 64 hexadecimal characters.");
      return;
    }
    if (!delegateKey.trim() && !keyStored) {
      setLocalError("Enter the delegate key.");
      return;
    }
    save.mutate(
      { accountId, delegateKey, namespace },
      {
        onSuccess: (status) => {
          setDelegateKey("");
          if (status.status === "verified") onClose();
        },
      },
    );
  }

  const result = save.data;
  const error = save.error instanceof BuilderApiError ? memoryErrorLabel(save.error.code, save.error.message) : save.error ? "Save failed." : "";

  return (
    <>
      <header className="settings-head">
        <div>
          <Dialog.Title>Connect Walrus Memory</Dialog.Title>
          <p id="memory-connect-desc">Uses a delegate key, never an owner private key. The key is stored encrypted on the workspace backend and only sent to the Mainnet relayer.</p>
        </div>
        <Dialog.Close className="icon-btn" aria-label="Close Memory connect">×</Dialog.Close>
      </header>
      {session.data && !session.data.signedIn ? (
        <section className="settings-card">
          <div className="settings-card-head"><h2>Workspace sign-in</h2></div>
          <p className="hint">A workspace session is required before a delegate key can be saved.</p>
          <WalletBoundary>
            <WalletProviders>
              <WalletSignIn />
            </WalletProviders>
          </WalletBoundary>
        </section>
      ) : (
        <form className="settings-card" noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="settings-card-head">
            <h2>Mainnet</h2>
            <span className={save.isPending ? "badge amber" : walrus?.status === "verified" ? "badge" : "badge amber"} role="status">
              {save.isPending ? "Verifying" : memoryBadge(session.data, session.error, false).label}
            </span>
          </div>
          <label className="field">Account ID
            <input className="input" value={accountId} placeholder="0x…" onChange={(event) => setAccountId(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="field">Delegate key
            <input className="input" type="password" autoComplete="off" spellCheck={false} value={delegateKey} onChange={(event) => setDelegateKey(event.target.value)} placeholder={keyStored ? "Stored key (hidden). Leave empty to keep it." : "Delegate private key"} />
            <span className="hint">Do not paste an owner wallet key. A delegate key can be revoked from the Memory account.</span>
          </label>
          <button type="button" className="btn" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced" : "Advanced"}</button>
          {advanced ? (
            <div className="settings-split">
              <label className="field">Namespace<input className="input" value={namespace} onChange={(event) => setNamespace(event.target.value)} spellCheck={false} /></label>
              <label className="field">Environment
                <select className="input" value="mainnet" disabled aria-describedby="memory-env-hint"><option value="mainnet">Mainnet</option></select>
                <span className="hint" id="memory-env-hint">Only the Mainnet relayer is supported.</span>
              </label>
            </div>
          ) : null}
          {localError ? <p className="error" role="alert">{localError}</p> : null}
          {error ? <p className="error" role="alert">{error}</p> : null}
          {result && result.status !== "verified" ? <p className="error" role="alert">{memoryErrorLabel(result.lastErrorCode, result.lastError)}</p> : null}
          <p className="hint">Save runs a real signed request against the relayer. Memory shows Ready only if it succeeds.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? "Verifying" : "Save and verify"}</button>
          </div>
        </form>
      )}
    </>
  );
}

class WalletBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) return <p className="hint">Wallet sign-in could not open.</p>;
    return this.props.children;
  }
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
    return <p className="hint">No wallet detected. Install Slush, then reopen this dialog.</p>;
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
