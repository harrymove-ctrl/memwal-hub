import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { AgentConfig, SectionId } from "../domain/types";
import { memoryCapabilities } from "../domain/capabilities";
import { describeCron, isValidTimezone, validateCron } from "../domain/schedule";

interface Props {
  section: SectionId | null;
  config: AgentConfig;
  onClose: () => void;
  /** Applies the edit to the agent draft (Save agent persists it). */
  onApply: (patch: Partial<AgentConfig>) => void;
}

const TITLES: Record<SectionId, string> = {
  schedule: "Schedule", triggers: "Start", channels: "Channels", memory: "Memory", files: "Research files", agent: "Agent",
  instructions: "Instructions", tools: "Tools", review: "Review findings", save: "Save results", subAgents: "Sub-agents", skills: "Skills",
};
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export const ALLOWED_MEMORY_TOOLS = [
  {
    id: "memwal_recall",
    technical: "memwal_recall",
    name: "Recall project memories",
    app: "memory",
    group: "read" as const,
    detail: "Search relevant facts, decisions, and context from Walrus memory.",
  },
  {
    id: "memwal_remember",
    technical: "memwal_remember",
    name: "Remember project memories",
    app: "memory",
    group: "save" as const,
    detail: "Save user-approved facts and decisions to durable Walrus memory.",
  },
] as const;

const READ_ONLY_SECTIONS: Partial<Record<SectionId, true>> = {
  files: true,
  review: true,
  save: true,
  subAgents: true,
  skills: true,
};
export function SectionEditor({ section, config, onClose, onApply }: Props) {
  return (
    <Dialog.Root open={section !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog" aria-describedby="ed-desc">
          {section ? <EditorBody key={section} section={section} config={config} onClose={onClose} onApply={onApply} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorBody({ section, config, onClose, onApply }: { section: SectionId; config: AgentConfig; onClose: () => void; onApply: Props["onApply"] }) {
  // Local form state opens with current values; Cancel discards it.
  const [f, setF] = useState(() => ({
    name: config.name,
    description: config.description,
    instructions: config.instructions,
    cron: config.schedule?.cron ?? "0 9 * * 1",
    timezone: config.schedule?.timezone ?? "UTC",
    label: config.schedule?.label ?? "",
    scheduleOn: config.schedule !== null,
    triggers: config.triggers.map((t) => `${t.name} | ${t.filter}`).join("\n"),
    identity: config.identity ?? "",
    channels: config.channels.join("\n"),
    memory: config.memory.map((m) => m.name).join("\n"),
  }));
  const [enabledTools, setEnabledTools] = useState<Set<string>>(() => new Set(memoryCapabilities(config.tools)));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const errors: Partial<Record<keyof typeof f, string>> = {};
  if (section === "agent") {
    const trimmed = f.name.trim();
    if (!trimmed || trimmed.length < 1 || trimmed.length > 80) {
      errors.name = "Use an agent name between 1 and 80 characters.";
    }
  }
  if (section === "instructions") {
    const trimmed = f.instructions.trim();
    if (!trimmed || trimmed.length < 1 || trimmed.length > 4000) {
      errors.instructions = "Instructions must be between 1 and 4000 characters.";
    }
  }
  if (section === "schedule" && f.scheduleOn) {
    const c = validateCron(f.cron);
    if (c) errors.cron = c;
    if (!isValidTimezone(f.timezone)) errors.timezone = "Use an IANA timezone, e.g. Europe/Berlin.";
  }
  if (section === "triggers" && lines(f.triggers).some((l) => !l.includes("|"))) errors.triggers = "Each line needs “name | filter”.";
  if (section === "channels" && lines(f.channels).length && !f.identity.trim()) errors.identity = "Set an identity before adding channels.";
  const valid = Object.keys(errors).length === 0;

  const apply = () => {
    setTouched(true);
    if (!valid) return;
    const patch: Partial<AgentConfig> = {};
    switch (section) {
      case "agent": patch.name = f.name.trim(); patch.description = f.description.trim(); break;
      case "instructions": patch.instructions = f.instructions; break;
      case "schedule": patch.schedule = f.scheduleOn ? { cron: f.cron.trim(), timezone: f.timezone.trim(), label: f.label.trim() } : null; break;
      case "triggers": patch.triggers = lines(f.triggers).map((l, i) => { const [name, filter] = l.split("|").map((x) => x.trim()); return { id: `t${i + 1}`, app: config.triggers[i]?.app ?? "zendesk", name, filter }; }); break;
      case "channels": patch.identity = f.identity.trim() || null; patch.channels = lines(f.channels); break;
      case "memory": patch.memory = lines(f.memory).map((name, i) => ({ id: `m${i + 1}`, name })); break;
      case "tools": {
        patch.tools = ALLOWED_MEMORY_TOOLS
          .filter((t) => enabledTools.has(t.technical))
          .map((t) => ({
            id: t.id,
            name: t.name,
            app: t.app,
            technical: t.technical,
            group: t.group,
            detail: t.detail,
          }));
        break;
      }
      case "subAgents":
      case "skills":
        break;
    }
    onApply(patch);
    onClose();
  };

  const err = (k: keyof typeof f) => (touched && errors[k] ? <span className="error" id={`err-${k}`}>{errors[k]}</span> : null);
  const inv = (k: keyof typeof f) => ({ "aria-invalid": touched && !!errors[k], "aria-describedby": errors[k] ? `err-${k}` : undefined });
  const list = (k: "triggers" | "channels" | "memory", label: string, hint: string) => (
    <div className="field">
      <label htmlFor={`f-${k}`}>{label}</label>
      <textarea id={`f-${k}`} className="textarea" style={{ minHeight: 120 }} value={f[k]} onChange={(e) => set(k, e.target.value)} {...inv(k)} />
      <span className="hint">{hint}</span>
      {err(k)}
    </div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <Dialog.Title style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 500 }}>Edit {TITLES[section]}</Dialog.Title>
      <Dialog.Description id="ed-desc" className="hint" style={{ margin: "0 0 16px" }}>
        Changes apply to this agent's draft. Save agent stores a revision on the server. A failed save keeps the draft.
      </Dialog.Description>

      {section === "agent" ? (
        <>
          <div className="field"><label htmlFor="f-name">Name</label><input id="f-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} {...inv("name")} />{err("name")}</div>
          <div className="field"><label htmlFor="f-desc">Description</label><input id="f-desc" className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        </>
      ) : null}
      {section === "instructions" ? (
        <div className="field"><label htmlFor="f-instr">System instructions</label><textarea id="f-instr" className="textarea" style={{ minHeight: 260 }} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} {...inv("instructions")} />{err("instructions")}</div>
      ) : null}
      {section === "schedule" ? (
        <>
          <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={f.scheduleOn} onChange={(e) => set("scheduleOn", e.target.checked)} /> Run on a schedule
          </label>
          {f.scheduleOn ? (
            <>
              <div className="field"><label htmlFor="f-cron">Cron (minute hour day month weekday)</label><input id="f-cron" className="input" value={f.cron} onChange={(e) => set("cron", e.target.value)} {...inv("cron")} />
                <span className="hint">{errors.cron ? "" : `${describeCron(f.cron)} in ${f.timezone} (not converted to your local time)`}</span>{err("cron")}</div>
              <div className="field"><label htmlFor="f-tz">Timezone</label><input id="f-tz" className="input" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} {...inv("timezone")} />{err("timezone")}</div>
              <div className="field"><label htmlFor="f-label">Label</label><input id="f-label" className="input" value={f.label} onChange={(e) => set("label", e.target.value)} /></div>
              <p className="hint">Demo mode: no scheduler is connected, so this schedule does not run anywhere.</p>
            </>
          ) : null}
        </>
      ) : null}
      {section === "triggers" ? list("triggers", "Triggers", "One per line: name | note. Demo only — sending a message does not register a webhook.") : null}
      {section === "channels" ? (
        <>
          <div className="field"><label htmlFor="f-id">Agent identity</label><input id="f-id" className="input" value={f.identity} onChange={(e) => set("identity", e.target.value)} placeholder="e.g. discovery-bot" {...inv("identity")} />{err("identity")}</div>
          {list("channels", "Channels", "One per line, e.g. #product-digest. Demo only — nothing is posted.")}
        </>
      ) : null}
      {section === "memory" ? list("memory", "Memory", "One example scope per line. This does not create a namespace.") : null}
      {section === "files" ? <p className="hint">These are sample file names. No folder is connected, and nothing is uploaded from this editor. Console file tools are not available.</p> : null}
      {section === "review" ? <p className="hint">Review findings is illustrative in this demo. Memory review occurs in Chat before facts are stored.</p> : null}
      {section === "save" ? <p className="hint">Save results is illustrative in this demo. Real memory storage occurs via Walrus relayer jobs in Chat.</p> : null}
      {section === "subAgents" ? <p className="hint">Sub-agents are unavailable in this demo. You can coordinate multiple steps directly in Chat.</p> : null}
      {section === "skills" ? <p className="hint">Skills catalogue is illustrative in this demo. Use built-in memory capabilities.</p> : null}
      {section === "tools" ? (
        <div className="field">
          <label style={{ display: "block", marginBottom: 8 }}>Capabilities</label>
          <p className="hint" style={{ margin: "0 0 12px" }}>
            Allowlisted memory tools. Disabled tools are excluded from agent runs.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ALLOWED_MEMORY_TOOLS.map((tool) => {
              const checked = enabledTools.has(tool.technical);
              return (
                <label key={tool.technical} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setEnabledTools((curr) => {
                        const next = new Set(curr);
                        if (e.target.checked) next.add(tool.technical);
                        else next.delete(tool.technical);
                        return next;
                      });
                    }}
                  />
                  <div>
                    <strong>{tool.name}</strong>
                    <div className="hint">{tool.detail}</div>
                    <div className="hint" style={{ fontFamily: "monospace", fontSize: 11 }}>{tool.technical}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        {READ_ONLY_SECTIONS[section] ? (
          <Dialog.Close asChild><button type="button" className="btn btn-primary">Close</button></Dialog.Close>
        ) : (
          <>
            <Dialog.Close asChild><button type="button" className="btn">Cancel</button></Dialog.Close>
            <button type="submit" className="btn btn-primary" disabled={touched && !valid}>Apply</button>
          </>
        )}
      </div>
      <FocusFirst />
    </form>
  );
}

/** Radix focuses the first focusable (Cancel would be wrong); focus the first field instead. */
function FocusFirst() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".dialog input:not([type=checkbox]), .dialog textarea");
    el?.focus();
  }, []);
  return null;
}
