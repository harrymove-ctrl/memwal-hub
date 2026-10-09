import { useState } from "react";

const FILES = [
  { name: "customer-interviews.md", excerpt: "Example excerpt. People could not tell whether a memory had been saved." },
  { name: "community-feedback.md", excerpt: "Example excerpt. Project memory was hard to select." },
  { name: "onboarding-observations.md", excerpt: "Example excerpt. Recalled facts did not show a source." },
];

const FINDINGS = [
  { id: "verify", title: "Make memory save status easier to verify", problem: "Users cannot tell storage completion from search visibility." },
  { id: "select", title: "Make project memory easier to select", problem: "The right project scope is hard to choose before recall." },
  { id: "source", title: "Show the source behind recalled facts", problem: "A recalled fact does not name its file or memory scope." },
];

type Row = "pending" | "approved" | "dismissed";
type Dest = { status: "Not started" | "Saving" | "Saved" | "Failed" | "Skipped"; detail: string };
export type DiscoveryStage = "files" | "review" | "save";

export function DiscoveryFlow({
  stage,
  exampleMode,
  onRead,
  onSave,
  onNotify,
}: {
  stage: DiscoveryStage;
  exampleMode: boolean;
  onRead: () => void;
  onSave: () => void;
  onNotify: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [memory, setMemory] = useState<Dest>({ status: "Not started", detail: "Save only after you select findings." });
  const consoleSave: Dest = { status: "Skipped", detail: "Console upload is not available. Nothing was uploaded." };
  const [partial, setPartial] = useState("");
  const selectedCount = Object.values(rows).filter((row) => row === "approved").length;

  function readSelected() {
    if (selected.length === 0) return;
    setOpened(selected);
    onRead();
  }

  function saveMemory() {
    const approved = FINDINGS.filter((item) => rows[item.id] === "approved");
    if (approved.length === 0) {
      onNotify("Select a finding before the example save. Nothing was written.");
      return;
    }
    setMemory({ status: "Skipped", detail: "Example only. Open chat to save real findings to Memory." });
    setPartial("Example run. Memory was not called.");
    onSave();
  }


  function downloadReport() {
    const lines = FINDINGS.filter((item) => rows[item.id] === "approved").map((item) => notes[item.id] || item.title);
    const body = ["MemWal discovery report", "Created in this browser. Not uploaded.", ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "weekly-discovery-report.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="discovery" aria-label="Discovery steps">
      <p className="run-meta" role="status">{exampleMode ? "Example — no model calls or remote writes" : "Open chat for a live run. This panel does not call Memory or Console."}</p>
      {stage === "files" ? (
        <>
          <h2>Choose research files</h2>
          <p className="hint">{selected.length} selected. Example files. Nothing is downloaded.</p>
          <ul className="discovery-files">
            {FILES.map((file) => (
              <li key={file.name}>
                <label><input type="checkbox" checked={selected.includes(file.name)} onChange={() => setSelected((current) => current.includes(file.name) ? current.filter((item) => item !== file.name) : [...current, file.name])} /><span><span className="cv-t">{file.name}</span><span className="cv-sub">Example file</span></span></label>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary" disabled={selected.length === 0} onClick={readSelected}>Read selected files</button>
          <button type="button" className="btn" onClick={onRead}>Continue without files</button>
        </>
      ) : null}
      {stage === "review" || stage === "save" ? (
        <>
          <h2>Review findings</h2>
          <p className="hint">Example run. These are not stored records.</p>
          <ul className="discovery-findings">
            {FINDINGS.map((item) => rows[item.id] === "dismissed" ? null : (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {editing === item.id ? (
                  <input className="input" value={notes[item.id] ?? item.problem} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} />
                ) : <p>{notes[item.id] ?? item.problem}</p>}
                {opened.length ? <p className="hint">Example file: {opened[0]}</p> : null}
                <div className="composer-row">
                  <button type="button" className="btn btn-primary" aria-pressed={rows[item.id] === "approved"} onClick={() => setRows((current) => ({ ...current, [item.id]: current[item.id] === "approved" ? "pending" : "approved" }))}>{rows[item.id] === "approved" ? "Selected" : "Select"}</button>
                  <button type="button" className="btn" onClick={() => setEditing(editing === item.id ? null : item.id)}>Edit</button>
                  <button type="button" className="btn" onClick={() => setRows((current) => ({ ...current, [item.id]: "dismissed" }))}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="discovery-foot"><span>{selectedCount} findings selected</span><button type="button" className="btn" disabled={selectedCount === 0} onClick={saveMemory}>Preview save (not sent)</button></div>
        </>
      ) : null}
      {stage === "save" ? (
        <>
          <h2>Save</h2>
          <p><span className="badge">{memory.status}</span> {memory.detail}</p>
          <p><span className="badge amber">{consoleSave.status}</span> {consoleSave.detail}</p>
          <p className="hint">Console upload is unavailable. The download stays on this computer.</p>
          <button type="button" className="btn" disabled>Console upload unavailable</button>
          <button type="button" className="btn" onClick={downloadReport}>Download report locally</button>

          {partial ? (
            <div className="run-error" role="status">
              <p>{partial}</p>
              <button type="button" className="btn" onClick={() => setPartial("")}>Dismiss</button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

