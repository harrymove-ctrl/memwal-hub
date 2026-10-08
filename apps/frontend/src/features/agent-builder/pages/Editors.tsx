import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import type { AgentConfig, SectionId } from "../domain/types";
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
    tools: config.tools.map((t) => t.name).join("\n"),
    subAgents: config.subAgents.join("\n"),
    skills: config.skills.join("\n"),
  }));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const errors: Partial<Record<keyof typeof f, string>> = {};
  if (section === "agent") {
    if (!f.name.trim()) errors.name = "Name is required.";
    if (f.name.length > 60) errors.name = "Keep the name under 60 characters.";
  }
  if (section === "instructions" && f.instructions.trim().length < 10) errors.instructions = "Instructions need at least 10 characters.";
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
      case "tools": patch.tools = lines(f.tools).map((name, i) => ({ id: config.tools[i]?.id ?? `tool${i}`, name, app: config.tools.find((t) => t.name === name)?.app ?? "x" })); break;
      case "subAgents": patch.subAgents = lines(f.subAgents); break;
      case "skills": patch.skills = lines(f.skills); break;
    }
    onApply(patch);
    onClose();
  };

  const err = (k: keyof typeof f) => (touched && errors[k] ? <span className="error" id={`err-${k}`}>{errors[k]}</span> : null);
  const inv = (k: keyof typeof f) => ({ "aria-invalid": touched && !!errors[k], "aria-describedby": errors[k] ? `err-${k}` : undefined });
  const list = (k: "triggers" | "channels" | "memory" | "tools" | "subAgents" | "skills", label: string, hint: string) => (
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
        Changes apply to this agent's draft. Use Save agent to keep them (stored locally in this browser — demo mode).
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
      {section === "files" ? <p className="hint">These are sample file names. No folder is connected, and nothing is uploaded from this editor.</p> : null}
      {section === "tools" ? list("tools", "Tools", "One tool per line. This does not connect Walrus.") : null}
      {section === "skills" ? list("skills", "Skills", "One skill per line.") : null}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Dialog.Close asChild><button type="button" className="btn">Cancel</button></Dialog.Close>
        <button type="submit" className="btn btn-primary" disabled={touched && !valid}>Apply</button>
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
