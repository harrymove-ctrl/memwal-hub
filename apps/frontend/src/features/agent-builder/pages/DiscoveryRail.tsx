import { useEffect, useState } from "react";

import type { RecalledFact } from "../services/discovery-chat";
import { runStages, type RunStage, type TimelineInput } from "./discovery-panels";

const ROLES = ["Product lead", "Researcher", "Engineer", "Reviewer"] as const;

export function DiscoveryRail({ projectId, projectName, timeline, recalled }: {
  projectId: string;
  projectName: string;
  timeline: TimelineInput;
  recalled: RecalledFact[];
}) {
  const stages = runStages(timeline);
  return (
    <aside className="dc-discovery" aria-label="Project and this run">
      <section>
        <h2>Project</h2>
        <p>{projectName || "No project selected"}</p>
        <p className="dc-muted">No purpose or audience is stored on the project. This panel lists facts only when a reply received them, or when this session confirms a save.</p>
      </section>
      <section aria-label="This run">
        <h2>This run</h2>
        <ol className="dc-stages">
          {stages.map((stage) => <Stage key={stage.id} stage={stage} />)}
        </ol>
      </section>
      <section aria-label="Retrieved memory">
        <h2>Retrieved memory</h2>
        {recalled.length === 0 ? <p className="dc-muted">No facts were supplied for this reply.</p> : (
          <ul>
            {recalled.map((fact) => (
              <li key={`${fact.blob_id ?? "none"}-${fact.text.slice(0, 24)}`}>
                <span>{fact.text}</span>
                <small>{fact.blob_id ? `Blob ${fact.blob_id}` : "No blob id"}{fact.created_at ? ` · ${fact.created_at}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <TeamPlan projectId={projectId} />
    </aside>
  );
}

function Stage({ stage }: { stage: RunStage }) {
  return (
    <li data-state={stage.state}>
      <strong>{stage.label}</strong>
      <span>{stage.state.replace("-", " ")}</span>
      <p>{stage.detail}</p>
    </li>
  );
}

function TeamPlan({ projectId }: { projectId: string }) {
  const key = projectId ? `memwal:plan:${projectId}` : "";
  const [rows, setRows] = useState<Array<{ role: string; task: string }>>([]);
  useEffect(() => {
    if (!key) return;
    const timer = window.setTimeout(() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]") as Array<{ role: string; task: string }>;
        setRows(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRows([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key]);
  const save = (next: Array<{ role: string; task: string }>) => {
    setRows(next);
    if (key) localStorage.setItem(key, JSON.stringify(next));
  };
  return (
    <section aria-label="Planning roles">
      <h2>Planning roles</h2>
      <p className="dc-muted">Saved in this browser only. These are not accounts, invitations, or running agents.</p>
      {!projectId ? <p className="dc-muted">Choose a project first.</p> : (
        <>
          <ul>
            {rows.map((row, index) => (
              <li key={`${row.role}-${index}`}>
                <span>{row.role}</span>
                <span>{row.task}</span>
                <button type="button" onClick={() => save(rows.filter((_, item) => item !== index))}>Remove</button>
              </li>
            ))}
          </ul>
          <form onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const role = String(data.get("role") || ROLES[0]);
            const task = String(data.get("task") || "").trim();
            if (!task) return;
            save([...rows, { role, task }]);
            event.currentTarget.reset();
          }}>
            <label>Role
              <select name="role">{ROLES.map((role) => <option key={role}>{role}</option>)}</select>
            </label>
            <label>Task
              <input name="task" aria-label="Planning task" />
            </label>
            <button type="submit">Add planning task</button>
          </form>
        </>
      )}
    </section>
  );
}
