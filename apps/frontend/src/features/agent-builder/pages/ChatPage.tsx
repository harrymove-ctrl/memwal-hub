import { ArrowUp, ChevronDown, FileText, MessageCircle, Paperclip, Plus, RefreshCcw, History } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { OpenSidebarButton, type ShellCtx } from "../App";
import "./pages.css";

const RECS = [
  { icon: FileText, text: "Continue the MemWal launch plan using our saved decisions." },
  { icon: RefreshCcw, text: "Review this week’s MemWal feedback and rank opportunities." },
  { icon: History, text: "Prepare a handoff before I stop work." },
];

/** Chat landing (reference has no visible conversation; sending is a labeled demo reply). */
export function ChatPage({ ctx }: { ctx: ShellCtx }) {
  const [text, setText] = useState("");

  const [messages, setMessages] = useState<{ role: "user" | "demo"; text: string }[]>([]);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "user", text: t }, { role: "demo", text: "Demo mode: no model is connected, so there is no real answer." }]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs"><MessageCircle size={14} /> <h1>Chat</h1></div>
        <div className="actions">
          <button className="btn" disabled={messages.length === 0} onClick={() => setMessages([])}><Plus size={12} /> New chat</button>
          <button className="icon-btn boxed" aria-label="Chat history" onClick={() => ctx.notify("Chat history is not available in this demo.")}><History size={13} /></button>
        </div>
      </header>
      <div className="page-body chat">
        <div className="chat-col">
          {messages.length === 0 ? (
            <>
              <div className="mascot" aria-hidden />
              <h2 className="chat-title">Who’s on it today?</h2>
            </>
          ) : (
            <ul className="chat-msgs" aria-live="polite">
              {messages.map((m, i) => <li key={i} data-role={m.role}>{m.text}</li>)}
            </ul>
          )}
          <div className="chat-box">
            <p className="hint">Walrus Memory: Not connected · Walrus Console: Not connected</p>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <label htmlFor="chat-input" className="sr-only">Message</label>
              <textarea id="chat-input" rows={2} placeholder="Ask anything, or type @ to mention an agent" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
              <div className="composer-row">
                <button type="button" className="icon-btn boxed" aria-label="Attach a file" onClick={() => ctx.notify("Attachments: demo only.")}><Paperclip size={13} /></button>
                <button type="button" className="model" onClick={() => ctx.notify("Model selection: demo only.")}>✳ Fable 5 <ChevronDown size={12} /></button>
                <span style={{ flex: 1 }} />
                <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}><ArrowUp size={13} /></button>
              </div>
            </form>
          </div>
          {messages.length === 0 ? (
            <section className="recs" aria-labelledby="recs-h">
              <h3 id="recs-h">Recommended for you</h3>
              {RECS.map(({ icon: Icon, text: t }) => (
                <button key={t} className="rec" onClick={() => setText(t)}><Icon size={14} /> {t}</button>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
