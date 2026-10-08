import { Dialog } from "radix-ui";
import { useState, type ClipboardEvent } from "react";

import { BuilderApiError } from "../services/api-client";
import modelProxyService, {
  emptyProxyForm,
  modelChoices,
  parseConfigSnippet,
  proxyBadge,
  validateProxyForm,
  type ModelList,
  type ModelProxyForm,
  type ModelProxyStatus,
  type ProxyFormErrors,
} from "../services/model-proxy";
import { useModelProxyStatus, useSaveModelProxy } from "../state/integration-queries";

interface ModelProxyDialogProps {
  open: boolean;
  onClose: () => void;
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
export function ModelProxyDialog({ open, onClose }: ModelProxyDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog bew-builder settings" aria-describedby="proxy-desc">
          {open ? <ModelProxyForm onClose={onClose} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ModelProxyFormProps {
  onClose: () => void;
}

function ModelProxyForm({ onClose }: ModelProxyFormProps) {
  const status = useModelProxyStatus();
  const save = useSaveModelProxy();
  const [form, setForm] = useState<ModelProxyForm>(() => formFrom(status.data));
  const [errors, setErrors] = useState<ProxyFormErrors>({});
  const [advanced, setAdvanced] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [snippetNote, setSnippetNote] = useState("");
  const [models, setModels] = useState<ModelList | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [lastAction, setLastAction] = useState<"save" | "test" | null>(null);
  const keySaved = Boolean(status.data?.key_saved);
  const current = save.data ?? status.data;
  const badge = proxyBadge(current, save.isPending && lastAction === "test");

  const set = (field: keyof ModelProxyForm) => (value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  function submit(test: boolean) {
    const found = validateProxyForm(form, keySaved);
    setErrors(found);
    if (Object.keys(found).length) return;
    setLastAction(test ? "test" : "save");
    save.mutate(
      { form, test },
      {
        onSuccess: (next) => {
          // The key leaves component state as soon as the backend stores it.
          setForm((previous) => ({ ...previous, apiKey: "", baseUrl: next.base_url ?? previous.baseUrl }));
          if (!test) onClose();
        },
      },
    );
  }

  async function loadModels() {
    setLoadingModels(true);
    try {
      setModels(await modelProxyService.models());
    } catch (error) {
      setModels({ available: false, models: [], message: error instanceof Error ? error.message : "Models could not be listed." });
    } finally {
      setLoadingModels(false);
    }
  }

  function applyParsed(text: string) {
    const parsed = parseConfigSnippet(text);
    if (!parsed.apiKey && !parsed.baseUrl) {
      setSnippetNote(text.trim() ? "No supported fields were found. Nothing was run." : "");
      return;
    }
    setForm((previous) => ({ ...previous, ...parsed }));
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
    setForm((previous) => ({ ...previous, ...parsed }));
    setErrors({});
    setSnippetNote("Filled from the paste. The command was not run.");
  }

  const saveError = save.error instanceof BuilderApiError ? save.error.message : save.error ? "The connection could not be saved." : "";

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
          <span className={badge.tone === "ok" ? "badge" : "badge amber"} role="status">{badge.label}</span>
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
        <Field label="API key" error={errors.apiKey} hint={keySaved ? "Leave empty to keep the stored key." : "Sent only to the workspace backend."}>
          <input className="input" type="password" placeholder={keySaved ? "Stored key (hidden)" : "Paste a key or the install command"} value={form.apiKey} onPaste={onKeyPaste} onChange={(event) => set("apiKey")(event.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Model" error={errors.modelId} hint="Pick a listed model, or load the proxy list after the key is saved.">
          <select className="input" value={form.modelId} onChange={(event) => set("modelId")(event.target.value)}>
            <option value="">Select a model</option>
            {modelChoices(form.baseUrl || "https://api-dev.zroute.ai/openai", models?.models ?? [], form.modelId).map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </Field>
        <div className="proxy-row">
          <button type="button" className="btn" disabled={!keySaved || loadingModels} onClick={() => void loadModels()}>{loadingModels ? "Loading models" : "Load model list"}</button>
          {models ? <span className="hint" role="status">{models.available ? `${models.models.length} models listed.` : models.message}</span> : null}
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
            <Field label="Custom model ID" hint="Use this only when the model is not in the list.">
              <input className="input" placeholder="provider/model-name" value={form.modelId} onChange={(event) => set("modelId")(event.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <button type="button" className="btn" onClick={() => applyParsed(snippet)} disabled={!snippet.trim()}>Read snippet</button>
            {current?.local_http_exception ? <p className="hint">Local development exception is on: http://localhost and 127.0.0.1 are allowed.</p> : null}
          </div>
        ) : null}
        {current?.status === "needs_attention" || current?.status === "unavailable" ? (
          <p className="error" role="alert">{current.last_error ?? "The last test failed."}</p>
        ) : null}
        {current?.status === "untested" ? <p className="hint">Saved but not tested. Chat stays unavailable until a test succeeds.</p> : null}
        {saveError ? <p className="error" role="alert">{saveError}</p> : null}
        <p className="hint">Test connection saves these settings and sends one small request (at most 32 output tokens). It is never retried automatically.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={save.isPending} onClick={() => submit(false)}>{save.isPending && lastAction === "save" ? "Saving" : "Save"}</button>
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
