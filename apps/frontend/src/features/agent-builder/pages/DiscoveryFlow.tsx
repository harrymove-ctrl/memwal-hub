import { useState } from "react";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");

const FILES = [
  { name: "customer-interviews.md", excerpt: "Example excerpt. People could not tell whether a memory had been saved." },
  { name: "community-feedback.md", excerpt: "Example excerpt. Project memory was hard to select." },
  { name: "onboarding-observations.md", excerpt: "Example excerpt. Recalled facts did not show a source." },
  { name: "weekly-discovery-report.md", excerpt: "Example excerpt. This file is not a stored Console object." },
];

const FINDINGS = [
  { id: "verify", title: "Make memory save status easier to verify", problem: "Users cannot tell storage completion from search visibility." },
  { id: "select", title: "Make project memory easier to select", problem: "The right project scope is hard to choose before recall." },
  { id: "source", title: "Show the source behind recalled facts", problem: "A recalled fact does not name its file or memory scope." },
];

type Row = "pending" | "approved" | "dismissed";
type Dest = { status: string; detail: string };

export function DiscoveryFlow({ onNotify }: { onNotify: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [memory, setMemory] = useState<Dest>({ status: "Not started", detail: "Approved findings stay here until you save." });
  const [consoleSave, setConsoleSave] = useState<Dest>({ status: "Not started", detail: "The report is separate from Memory." });
  const [partial, setPartial] = useState("");

  function toggle(name: string) {
    setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }

  function openSelected() {
    if (selected.length === 0) {
      onNotify("Select an example file first. Console is not connected, so nothing is downloaded.");
      return;
    }
    setOpened(selected);
  }

  async function saveApproved() {
    const approved = FINDINGS.filter((item) => rows[item.id] === "approved");
    if (approved.length === 0) {
      onNotify("Approve a finding before saving. Nothing was written.");
      return;
    }
    setMemory({ status: "Saving", detail: "Checking the Memory connection." });
    setConsoleSave({ status: "Saving", detail: "Checking Console. This does not upload yet." });
    const text = approved.map((item) => item.title).join("\n");
    const [memoryResult, consoleResult] = await Promise.all([
      post("/memory/remember", { text }),
      post("/memory/console/report", { text }),
    ]);
    setMemory(memoryResult);
    setConsoleSave(consoleResult);
    if (memoryResult.status === "saved" && consoleResult.status !== "saved") {
      setPartial("Findings saved to Walrus Memory. The discovery report could not be uploaded to Walrus Console.");
    } else if (consoleResult.status === "saved" && memoryResult.status !== "saved") {
      setPartial("The discovery report was accepted by Console. Findings were not saved to Walrus Memory.");
    } else if (memoryResult.status !== "saved" && consoleResult.status !== "saved") {
      setPartial("Neither destination completed. Memory and Console are separate, and neither save was confirmed.");
    } else {
      setPartial("");
    }
  }

  function downloadReport() {
    const approved = FINDINGS.filter((item) => rows[item.id] === "approved").map((item) => item.title);
    const body = ["MemWal discovery report", "Example data. This file was created in the browser. It was not uploaded.", ...approved].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "weekly-discovery-report.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="discovery" aria-label="Review and save">
      <h2>Select research files</h2>
      <p className="hint">Example files. Walrus Console is not connected, so opening one does not decrypt a stored object.</p>
      <ul className="discovery-files">
        {FILES.map((file) => (
          <li key={file.name}>
            <label><input type="checkbox" checked={selected.includes(file.name)} onChange={() => toggle(file.name)} /> {file.name}</label>
            {opened.includes(file.name) ? <p>{file.excerpt}</p> : null}
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={openSelected}>Open selected</button>

      <h2>Review findings</h2>
      <ul className="discovery-findings">
        {FINDINGS.map((item) => (
          <li key={item.id} data-state={rows[item.id] ?? "pending"}>
            <strong>{item.title}</strong>
            <p>{editing === item.id ? <input className="input" value={draft} onChange={(event) => setDraft(event.target.value)} /> : item.problem}</p>
            <div className="composer-row">
              <button type="button" className="btn" onClick={() => setRows((current) => ({ ...current, [item.id]: "approved" }))}>Approve</button>
              <button type="button" className="btn" onClick={() => { setEditing(item.id); setDraft(item.problem); }}>Edit</button>
              <button type="button" className="btn" onClick={() => setRows((current) => ({ ...current, [item.id]: "dismissed" }))}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Save results</h2>
      <p><span className="badge">{memory.status}</span> Walrus Memory. {memory.detail}</p>
      <p><span className="badge amber">{consoleSave.status}</span> Walrus Console. {consoleSave.detail}</p>
      <button type="button" className="btn btn-primary" onClick={() => void saveApproved()}>Save approved findings</button>
      {partial ? (
        <div className="run-error" role="status">
          <p>{partial}</p>
          <button type="button" className="btn" onClick={() => void saveApproved()}>Retry report upload</button>
          <button type="button" className="btn" onClick={downloadReport}>Download report locally</button>
          <button type="button" className="btn" onClick={() => setPartial("")}>Dismiss</button>
        </div>
      ) : null}
    </section>
  );
}

async function post(path: string, body: { text: string }): Promise<Dest> {
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { status?: string; detail?: string; message?: string };
    return {
      status: payload.status === "saved" ? "Saved" : "Failed",
      detail: payload.detail || payload.message || "The save was not confirmed.",
    };
  } catch {
    return { status: "Failed", detail: "The save request did not complete." };
  }
}
