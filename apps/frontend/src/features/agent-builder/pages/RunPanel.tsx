import { ArrowDown, ArrowUp, Check, ChevronRight, Grip, Info, Paperclip, RotateCcw, Square, Wrench, X, Zap, AlertCircle, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AppIcon } from "../components/AppIcon";
import type { AgentExample, RunEvent, RunState } from "../domain/types";
import { DiscoveryFlow } from "./DiscoveryFlow";
import "./run.css";

interface Props {
  run: RunState;
  busy: boolean;
  example?: AgentExample;
  onStop: () => void;
  onRetry: () => void;
  onSend: (text: string) => void;
  demo: boolean;
  discovery?: boolean;
  onNotify: (message: string) => void;
}

const NEAR_BOTTOM_PX = 48;

export function RunPanel({ run, busy, onStop, onRetry, onSend, discovery, onNotify }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [run.events, run.status, pinned]);

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setPinned(true);
  };

  const canSend = text.trim().length > 0 && !busy;
  const send = () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    onSend(text.trim());
    setText("");
    setFiles([]);
    requestAnimationFrame(() => { sending.current = false; });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const announce = ({ running: "Run started", completed: "Run completed", stopped: "Run stopped", failed: "Run failed" } as Record<string, string>)[run.status] ?? "";


  return (
    <aside className="run" aria-label="Run">
      <div className="run-card">
        <p><span className="chip"><Zap size={11} /> product-discovery-agent</span> Past 7 days</p>
        {busy ? (
          <button className="run-stop" aria-label="Stop run" onClick={onStop}><Square size={10} fill="currentColor" /></button>
        ) : run.status === "failed" || run.status === "stopped" ? (
          <button className="btn" onClick={onRetry}><RotateCcw size={12} /> Retry</button>
        ) : null}
      </div>

      <div className="run-scroll" ref={scroller} onScroll={onScroll} aria-live="off">
        <div className="run-events">

          {groupEvents(run.events).map((item) => <EventView key={item.key} item={item} />)}
          {discovery && onNotify ? <DiscoveryFlow onNotify={onNotify} /> : null}
          {run.status === "failed" ? (
            <div className="run-error" role="alert"><AlertCircle size={14} /> {run.error}</div>
          ) : null}
          {run.status === "stopped" ? <p className="run-meta">Stopped by you.</p> : null}
          {run.status !== "idle" ? (
            <div className="run-progress" data-active={busy}>
              <Grip size={13} aria-hidden /> {busy ? runPhase(run) : "Example run · prototype data"}
            </div>
          ) : null}
        </div>
      </div>
      {!pinned ? (
        <button className="btn run-latest" onClick={jumpToLatest}><ArrowDown size={12} /> Jump to latest</button>
      ) : null}

      <div className="run-foot">
        <div className="usage" role="note"><Info size={13} /> <span>Memory and Console are not connected.</span></div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label htmlFor="followup" className="sr-only">Follow-up message</label>
          <textarea id="followup" rows={1} placeholder="Add a follow-up" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
          {files.length ? (
            <ul className="files" aria-label="Attachments">
              {files.map((f, i) => (
                <li key={f.name + i}>{f.name}<button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={11} /></button></li>
              ))}
            </ul>
          ) : null}
          <div className="composer-row">
            <button type="button" className="icon-btn boxed" aria-label="Attach a file" onClick={() => fileInput.current?.click()}><Paperclip size={13} /></button>
            <input ref={fileInput} type="file" hidden multiple onChange={(e) => { setFiles((x) => [...x, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
            <span className="hint">{busy ? "Wait for the run to finish or stop it" : "Enter to send · Shift+Enter for a new line"}</span>
            <button type="submit" className="send" aria-label="Send" disabled={!canSend}><ArrowUp size={13} /></button>
          </div>
        </form>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
    </aside>
  );
}

type Item =
  | { key: string; kind: "text"; text: string }
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "group"; label: string; tools: Extract<RunEvent, { t: "tool" }>[] }
  | { key: string; kind: "collapsed"; label: string; count: string; items: string[] };

function groupEvents(events: RunEvent[]): Item[] {
  const out: Item[] = [];
  for (const e of events) {
    if (e.t === "text") out.push({ key: e.id, kind: "text", text: e.text });
    else if (e.t === "user") out.push({ key: e.id, kind: "user", text: e.text });
    else if (e.t === "toolGroup") out.push({ key: e.id, kind: "group", label: e.label, tools: [] });
    else if (e.t === "tool") {
      const g = out.findLast((x): x is Extract<Item, { kind: "group" }> => x.kind === "group");
      g?.tools.push(e);
    } else if (e.t === "collapsed") out.push({ key: e.id, kind: "collapsed", label: e.label, count: e.count, items: e.items });
  }
  return out;
}

function EventView({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "text": return <p className="ev-text">{item.text}</p>;
    case "user": return <p className="ev-user">{item.text}</p>;
    case "group":
      return (
        <div className="ev-group">
          <div className="ev-group-head"><Wrench size={12} /> {item.label}</div>
          <ul>
            {item.tools.map((t) => (
              <li key={t.id} data-status={t.status}>
                <span className="ev-status" aria-label={t.status}>
                  {t.status === "running" ? <Loader2 size={11} className="spin" /> : t.status === "done" ? <Check size={11} /> : <X size={11} />}
                </span>
                <AppIcon app={t.app} size={14} /> {t.name}
              </li>
            ))}
          </ul>
        </div>
      );
    case "collapsed":
      return (
        <div className="ev-collapsed">
          <button aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronRight size={12} className="chev" /> {item.label} <span className="run-meta">· {item.count}</span>
          </button>
          {open ? <ul>{item.items.map((x) => <li key={x}>{x}</li>)}</ul> : null}
        </div>
      );
  }
}

function runPhase(run: RunState) {
  const running = [...run.events].reverse().find((event) => event.t === "tool" && event.status === "running");
  if (running?.t === "tool" && running.app === "memory" && running.name.toLowerCase().includes("remember")) return "Saving findings";
  if (running?.t === "tool" && running.app === "memory") return "Reading memories";
  if (running?.t === "tool" && running.app === "console") return "Reading files";
  if (run.events.some((event) => event.t === "toolGroup" && event.id === "save")) return "Waiting for review";
  return "Comparing opportunities";
}


