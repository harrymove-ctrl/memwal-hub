import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Link } from "react-router";
import { createProject, listProjects, type Project } from "../services/conversations";
import { MemoryConnectDialog } from "./SettingsDialog";
import { BuilderApiError } from "../services/api-client";
import modelProxyService, {
  emptyProxyForm,
  modelChoices,
  parseConfigSnippet,
  proxyBadge,
  sameBaseUrl,
  validateProxyForm,
  type ModelList,
  type ModelProxyForm,
  type ModelProxyStatus,
  type ProxyFormErrors,
} from "../services/model-proxy";
import { useMemorySession, useModelProxyStatus, useSaveModelProxy } from "../state/integration-queries";

interface ModelProxyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Opens the Memory setup URL instead of a nested dialog. */
  onContinueToMemory?: () => void;
}

function formFrom(status: ModelProxyStatus | undefined): ModelProxyForm {
  if (!status?.configured) return emptyProxyForm;
  return {
    connectionName: status.connection_name ?? emptyProxyForm.connectionName,
    baseUrl: status.base_url ?? "",
    apiKey: "",
    modelId: status.model_id ?? "",
    maxOutputTokens: String(status.max_output_tokens ?? 2048),
    temperature: status.temperature === null ? "" : String(status.temperature),
  };
}

/** Focused dialog for the ZRouter / OpenAI-compatible proxy connection. */
export function ModelProxyDialog({ open, onClose, onContinueToMemory }: ModelProxyDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog bew-builder settings" aria-describedby="proxy-desc">
          {open ? <ModelProxyForm onClose={onClose} onContinueToMemory={onContinueToMemory} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ModelProxyFormProps {
  onClose: () => void;
  onContinueToMemory?: () => void;
}

function ModelProxyForm({ onClose, onContinueToMemory }: ModelProxyFormProps) {
  const status = useModelProxyStatus();
  const save = useSaveModelProxy();
  const memory = useMemorySession();
  // The form shows the saved connection with the user's own edits layered on top.
  // A refetch can therefore never overwrite a field the user has touched, and
  // nothing is shown as "saved" until the status has actually arrived.
  const saved = formFrom(status.data);
  const [draft, setDraft] = useState<Partial<ModelProxyForm>>({});
  const form: ModelProxyForm = { ...saved, ...draft };
  const [errors, setErrors] = useState<ProxyFormErrors>({});
  const [advanced, setAdvanced] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [snippetNote, setSnippetNote] = useState("");
  const [discovery, setDiscovery] = useState<{ baseUrl: string; list: ModelList } | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState(false);
  const discoveryRun = useRef(0);
  const autoDiscovered = useRef(false);
  const [lastAction, setLastAction] = useState<"save" | "test" | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [continueWithoutMemory, setContinueWithoutMemory] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState("");

  const keySaved = Boolean(status.data?.key_saved);
  const current = status.data;
  const isApiReady = current?.status === "ready";
  const memoryVerified = memory.data?.walrus.status === "verified";
  const badge = proxyBadge(current, save.isPending && lastAction === "test");

  useEffect(() => {
    if (!isApiReady) return;
    let live = true;
    void listProjects()
      .then((items) => {
        if (!live) return;
        setProjects(items);
        // Keep a project the user already chose; otherwise default to the first one.
        if (items.length > 0) setSelectedProjectId((current) => current || items[0].id);
      })
      .catch(() => {
        if (live) setProjects([]);
      });
    return () => {
      live = false;
    };
  }, [isApiReady]);

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setProjectError("");
    try {
      const created = await createProject(name, crypto.randomUUID());
      setProjects((prev) => [created, ...(prev ?? [])]);
      setSelectedProjectId(created.id);
      setNewProjectName("");
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Could not create project.");
    } finally {
      setCreatingProject(false);
    }
  }

  const set = (field: keyof ModelProxyForm) => (value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  function submit(test: boolean) {
    const found = validateProxyForm(form, keySaved, status.data?.base_url ?? null);
    setErrors(found);
    if (Object.keys(found).length) return;
    setLastAction(test ? "test" : "save");
    save.mutate(
      { form, test },
      {
        // Only a stored result clears the draft (and with it the typed key). A failed
        // save or test keeps every edit so the user can correct it and retry.
        onSuccess: () => {
          setDraft({});
          if (!test) onClose();
        },
      },
    );
  }

  /** Asks the backend to list models for this URL. Stale answers are dropped. */
  const discover = useCallback(async (baseUrl: string, apiKey: string) => {
    const run = ++discoveryRun.current;
    setLoadingModels(true);
    let list: ModelList;
    try {
      list = await modelProxyService.discoverModels(baseUrl, apiKey);
    } catch (error) {
      list = { available: false, models: [], message: error instanceof Error ? error.message : "Models could not be listed." };
    }
    if (run !== discoveryRun.current) return;
    setDiscovery({ baseUrl, list });
    setLoadingModels(false);
  }, []);

  function loadModels() {
    const found = validateProxyForm(form, keySaved, status.data?.base_url ?? null);
    const blocking = { baseUrl: found.baseUrl, apiKey: found.apiKey };
    if (blocking.baseUrl || blocking.apiKey) {
      setErrors((previous) => ({ ...previous, ...blocking }));
      return;
    }
    void discover(form.baseUrl, form.apiKey);
  }

  // A saved connection lists its models once when the dialog opens (a free /models call).
  const savedBaseUrl = status.data?.base_url ?? null;
  const canAutoDiscover = Boolean(status.data?.configured && status.data.key_saved && savedBaseUrl);
  useEffect(() => {
    if (autoDiscovered.current || !canAutoDiscover || !savedBaseUrl) return;
    autoDiscovered.current = true;
    void discover(savedBaseUrl, "");
  }, [canAutoDiscover, savedBaseUrl, discover]);

  useEffect(() => () => { discoveryRun.current += 1; }, []);

  function applyParsed(text: string) {
    const parsed = parseConfigSnippet(text);
    if (!parsed.apiKey && !parsed.baseUrl) {
      setSnippetNote(text.trim() ? "No supported fields were found. Nothing was run." : "");
      return;
    }
    setDraft((previous) => ({ ...previous, ...parsed }));
    setErrors({});
    setSnippet("");
    setSnippetNote("Filled from the paste. The command was not run.");
  }

  function onKeyPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    const parsed = parseConfigSnippet(text);
    if (!parsed.baseUrl && text.trim() === parsed.apiKey) return;
    if (!parsed.apiKey && !parsed.baseUrl) return;
    event.preventDefault();
    setDraft((previous) => ({ ...previous, ...parsed }));
    setErrors({});
    setSnippetNote("Filled from the paste. The command was not run.");
  }

  const saveError = save.error instanceof BuilderApiError ? save.error.message : save.error ? "The connection could not be saved." : "";
  const listedForUrl = discovery && sameBaseUrl(discovery.baseUrl, form.baseUrl) ? discovery.list : null;
  const listedModels = listedForUrl?.available ? listedForUrl.models : [];
  const useSelect = listedModels.length > 0 && !manualModel;
  const keyHostChanged =
    keySaved && !form.apiKey.trim() && Boolean(savedBaseUrl) && Boolean(form.baseUrl.trim()) &&
    (() => {
      try {
        return new URL(form.baseUrl.trim()).host.toLowerCase() !== new URL(savedBaseUrl as string).host.toLowerCase();
      } catch {
        return false;
      }
    })();
  const modelHint = loadingModels
    ? "Loading the provider's model list…"
    : listedForUrl?.available
      ? listedModels.length > 0
        ? `${listedModels.length} models listed by the provider.`
        : "The provider returned no models. Enter the model ID manually."
      : listedForUrl
        ? (listedForUrl.message ?? "The provider's model list is unavailable. Enter the model ID manually.")
        : "Enter the model ID, or list the provider's models once the URL and key are filled in.";

  if (status.isPending) {
    return (
      <>
        <header className="settings-head">
          <div>
            <Dialog.Title>ZRouter / OpenAI-compatible proxy</Dialog.Title>
            <p id="proxy-desc">Loading your saved connection…</p>
          </div>
          <Dialog.Close className="icon-btn" aria-label="Close proxy settings">×</Dialog.Close>
        </header>
        <div className="settings-card" aria-busy="true" role="status" aria-label="Loading saved connection">
          <p className="hint">Checking for a saved connection.</p>
        </div>
      </>
    );
  }
  if (status.isError) {
    return (
      <>
        <header className="settings-head">
          <div>
            <Dialog.Title>ZRouter / OpenAI-compatible proxy</Dialog.Title>
            <p id="proxy-desc">The saved connection could not be read.</p>
          </div>
          <Dialog.Close className="icon-btn" aria-label="Close proxy settings">×</Dialog.Close>
        </header>
        <div className="settings-card">
          <p className="error" role="alert">Your saved connection could not be loaded, so nothing is shown to edit. Saving now could overwrite it.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void status.refetch()}>Retry</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="settings-head">
        <div>
          <Dialog.Title>ZRouter / OpenAI-compatible proxy</Dialog.Title>
          <p id="proxy-desc">Chat responses use this endpoint and model. The key is stored encrypted on the workspace backend and is never shown again.</p>
        </div>
        <Dialog.Close className="icon-btn" aria-label="Close proxy settings">×</Dialog.Close>
      </header>
      <form className="settings-card proxy-form" noValidate onSubmit={(event) => { event.preventDefault(); submit(true); }}>
        <div className="settings-card-head">
          <h2>Connection</h2>
          <span className={badge.tone === "ok" ? "badge" : "badge amber"} role="status" aria-label={`Connection status: ${badge.label}`}>{badge.label}</span>
        </div>
        {current?.configured ? (
          <p className="hint">
            Saved: {current.connection_name} · {current.base_url} · {current.model_id} · key stored (hidden)
            {current.last_model_reported ? <> · last reply from <code>{current.last_model_reported}</code></> : null}
          </p>
        ) : null}
        <Field label="Install command or config" hint="Paste the ZRoute install line or a curl/JSON snippet. It is read here and never run.">
          <textarea className="input proxy-snippet" rows={3} placeholder="curl -fsSL https://dev.zroute.ai/install.sh | bash -s -- '…'" value={snippet} onChange={(event) => { setSnippet(event.target.value); if (/install\.sh|zr_(?:live|test)_|Bearer /i.test(event.target.value)) applyParsed(event.target.value); }} spellCheck={false} />
        </Field>
        {snippetNote ? <p className="hint" role="status">{snippetNote}</p> : null}
        <Field label="Connection name" error={errors.connectionName}>
          <input className="input" value={form.connectionName} onChange={(event) => set("connectionName")(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="API base URL" error={errors.baseUrl} hint="For ZRoute dev this is https://api-dev.zroute.ai/openai. /chat/completions is added by the backend.">
          <input className="input" inputMode="url" placeholder="https://api-dev.zroute.ai/openai" value={form.baseUrl} onChange={(event) => set("baseUrl")(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field
          label="API key"
          error={errors.apiKey}
          hint={
            keyHostChanged
              ? "The stored key only works for the saved host. Enter a key for this host."
              : keySaved
                ? "A key is stored securely and never shown. Leave empty to keep using it."
                : "Sent only to the workspace backend."
          }
        >
          <input className="input" type="password" placeholder={keySaved ? "Stored key (hidden)" : "Paste a key or the install command"} value={form.apiKey} onPaste={onKeyPaste} onChange={(event) => set("apiKey")(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        {useSelect ? (
          <Field label="Model" error={errors.modelId} hint={modelHint}>
            <select className="input" value={form.modelId} onChange={(event) => set("modelId")(event.target.value)}>
              <option value="">Select a model</option>
              {modelChoices(form.baseUrl, listedModels, form.modelId).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Model ID" error={errors.modelId} hint={modelHint}>
            <input className="input" placeholder="provider/model-name" value={form.modelId} onChange={(event) => set("modelId")(event.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        )}
        <div className="proxy-row">
          <button type="button" className="btn" disabled={loadingModels} onClick={loadModels}>{loadingModels ? "Loading models" : listedForUrl ? "Refresh model list" : "List models"}</button>
          {listedModels.length > 0 ? (
            <button type="button" className="btn" aria-pressed={manualModel} onClick={() => setManualModel((value) => !value)}>{manualModel ? "Choose from the list" : "Enter a model ID manually"}</button>
          ) : null}
        </div>
        <button type="button" className="btn proxy-advanced" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced" : "Advanced"}</button>
        {advanced ? (
          <div className="proxy-advanced-body">
            <div className="settings-split">
              <Field label="Maximum output tokens" error={errors.maxOutputTokens}>
                <input className="input" inputMode="numeric" value={form.maxOutputTokens} onChange={(event) => set("maxOutputTokens")(event.target.value)} />
              </Field>
              <Field label="Temperature (optional)" error={errors.temperature}>
                <input className="input" inputMode="decimal" placeholder="Proxy default" value={form.temperature} onChange={(event) => set("temperature")(event.target.value)} />
              </Field>
            </div>
            <button type="button" className="btn" onClick={() => applyParsed(snippet)} disabled={!snippet.trim()}>Read snippet</button>
            {current?.local_http_exception ? <p className="hint">Local development exception is on: http://localhost and 127.0.0.1 are allowed.</p> : null}
          </div>
        ) : null}
        {current?.status === "needs_attention" || current?.status === "unavailable" ? (
          <p className="error" role="alert">{current.last_error ?? "The last test failed."}</p>
        ) : null}
        {current?.status === "untested" ? <p className="hint">Saved, not tested. Chat stays unavailable until a test succeeds.</p> : null}
        {saveError ? <p className="error" role="alert">{saveError}</p> : null}
        {isApiReady ? (
          <div className="dc-callout" role="status" aria-label="Guided setup">
            <p><strong>Verified Model:</strong> {current?.model_id ?? "Default model"}{current?.last_model_reported ? <> · replies from <code>{current.last_model_reported}</code></> : null}{current?.last_tested_at ? <> · last tested {current.last_tested_at}</> : null}</p>
            {memoryVerified ? (
              <p className="hint">Project memory is already verified.</p>
            ) : (
              <div>
                <p className="hint">Walrus Memory is not connected yet. Save context across project chats, or continue without memory.</p>
                <div className="settings-row" style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <button type="button" className="btn btn-primary" onClick={() => { if (onContinueToMemory) onContinueToMemory(); else setMemoryOpen(true); }}>
                    Set up project memory
                  </button>
                  <button type="button" className="btn" onClick={() => setContinueWithoutMemory(true)}>
                    Continue without memory
                  </button>
                </div>
              </div>
            )}
            {(memoryVerified || continueWithoutMemory) ? (
              <div style={{ marginTop: "12px", borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: "8px" }}>
                {projects && projects.length > 0 ? (
                  <label className="field">
                    Select project
                    <select
                      className="input"
                      aria-label="Select project"
                      value={selectedProjectId}
                      onChange={(event) => setSelectedProjectId(event.target.value)}
                    >
                      {projects.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="settings-row" style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <input
                    className="input"
                    placeholder="New project name"
                    aria-label="New project name"
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!newProjectName.trim() || creatingProject}
                    onClick={() => void handleCreateProject()}
                  >
                    {creatingProject ? "Creating…" : "Create project"}
                  </button>
                </div>
                {projectError ? <p className="error" role="alert">{projectError}</p> : null}
                <div style={{ marginTop: "10px" }}>
                  <Link
                    to={selectedProjectId ? `/builder/chat?project=${encodeURIComponent(selectedProjectId)}` : "/builder/chat"}
                    className="btn btn-primary"
                    onClick={onClose}
                  >
                    Continue to conversation
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <MemoryConnectDialog open={memoryOpen} onClose={() => setMemoryOpen(false)} />
        <p className="hint">Test connection saves these settings and sends one small request (at most 32 output tokens). It is never retried automatically. Ready appears only after a test succeeds.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={save.isPending} onClick={() => submit(false)}>{save.isPending && lastAction === "save" ? "Saving" : "Save without testing"}</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending && lastAction === "test" ? "Testing" : "Test connection"}</button>
        </div>
      </form>
    </>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="field">
      {label}
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
