import { ArrowDown, ArrowUp, Check, ChevronRight, Play, Square, Wrench, X, Zap, Loader2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { NavLink } from "react-router";
import { AppIcon } from "../components/AppIcon";
import type { AgentExample, RunEvent, RunState } from "../domain/types";
import { useMemorySession } from "../state/integration-queries";
import { DiscoveryFlow, type DiscoveryStage } from "./DiscoveryFlow";
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
const SUGGESTED_PROMPT = "Review this week’s MemWal feedback and identify the strongest product opportunities.";

export function RunPanel({ run, busy, onStop, onSend, discovery, onNotify }: Props) {
  const [stage, setStage] = useState<DiscoveryStage | "idle" | "reading" | "analyzing">("idle");
  const playback = useRef<number[]>([]);
  const memory = useMemorySession();
  const memoryReady = memory.data?.walrus.status === "verified";
  useEffect(() => () => { playback.current.forEach((id) => window.clearTimeout(id)); }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

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
  const stopPlayback = () => { playback.current.forEach((id) => window.clearTimeout(id)); playback.current = []; };
  const beginRead = () => {
    stopPlayback();
    setStage("reading");
    playback.current = [
      window.setTimeout(() => setStage("analyzing"), 450),
      window.setTimeout(() => setStage("review"), 900),
    ];
  };
  const send = () => {
    if (!canSend || sending.current) return;
    if (discovery) {
      setText("");
      if (stage === "idle") setStage("files");
      onNotify("Example run. This message was not sent to Memory, Console, or a live model.");
      return;
    }
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
        <p><span className="chip"><Zap size={11} /> product-discovery-agent</span> <span>Past 7 days</span></p>
        {busy ? (
          <button className="run-stop" aria-label="Stop run" onClick={onStop}><Square size={10} /> Stop</button>
        ) : discovery && stage === "idle" ? (
          <div className="run-actions">
            <button type="button" className="btn btn-primary" onClick={() => { onNotify(memoryReady ? "Memory is ready. Console file upload is still unavailable." : "Memory is not connected. A live run cannot read files until you connect sources."); window.dispatchEvent(new Event("bew:open-settings")); }}>{memoryReady ? "Memory ready" : "Connect sources"}</button>
            <NavLink className="btn" to="/builder/chat">Try Product Discovery</NavLink>
            <button type="button" className="btn" onClick={() => setStage("files")}><Play size={12} /> Preview example</button>
          </div>
        ) : null}
        {discovery && stage === "idle" ? <p className="run-connect">{memoryReady ? "Memory ready" : "Memory not connected"} · Console not connected{memoryReady ? null : <> · <button type="button" className="link" onClick={() => window.dispatchEvent(new Event("bew:open-settings"))}>Connect</button></>}</p> : null}
      </div>
      <div className="run-scroll" ref={scroller} onScroll={onScroll} aria-live="off">
        <div className="run-events">
          {discovery && stage === "idle" && run.status === "idle" ? (
            <>
              <p className="ev-text">Review product feedback using your saved strategy, past opportunities, and selected research files.</p>
              <button type="button" className="suggest" onClick={() => setText(SUGGESTED_PROMPT)}>{SUGGESTED_PROMPT}</button>
            </>
          ) : null}
          {groupEvents(run.events).map((item) => <EventView key={item.key} item={item} />)}
          {discovery && (stage === "files" || stage === "review" || stage === "save") ? <DiscoveryFlow stage={stage} exampleMode onRead={beginRead} onSave={() => setStage("save")} onNotify={onNotify} /> : null}
          {stage === "reading" ? <p className="run-meta">Example run · Reading selected files</p> : null}
          {stage === "analyzing" ? <p className="run-meta">Example run · Analyzing example feedback</p> : null}
          {stage === "reading" || stage === "analyzing" ? <button type="button" className="btn" onClick={() => { stopPlayback(); setStage("idle"); }}>Stop example</button> : null}
          {stage !== "idle" ? <p className="run-meta">Example run</p> : null}
        </div>
      </div>
      {!pinned ? (
        <button className="btn run-latest" onClick={jumpToLatest}><ArrowDown size={12} /> Jump to latest</button>
      ) : null}

      <div className="run-foot">

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




