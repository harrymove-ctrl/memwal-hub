import { ArrowUpDown, Blocks, BookOpen, Code2, GraduationCap, Lightbulb, Plus, Search, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { OpenSidebarButton, type ShellCtx } from "../App";
import { SKILLS, STARTER_PACKS, type Skill } from "../data/fixtures";
import "./pages.css";

type SortKey = "id" | "type" | "author" | "updated";
const PACK_ICONS = { harness: Blocks, product: Lightbulb, frontend: Code2, backend: Server };

export function SkillsPage({ ctx }: { ctx: ShellCtx }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const rows = useMemo(() => {
    const val = (s: Skill) => (sort.key === "updated" ? s.updatedRank : sort.key === "id" ? s.id : s[sort.key]);
    return SKILLS.filter((s) => `${s.id} ${s.type} ${s.description} ${s.author}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [q, sort]);
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>{label} <ArrowUpDown size={11} /></button>
    </th>
  );
  return (
    <>
      <header className="page-head">
        <OpenSidebarButton ctx={ctx} />
        <div className="crumbs"><GraduationCap size={14} /> <h1>Skills</h1></div>
        <div className="actions"><button className="btn btn-primary" onClick={() => ctx.notify("Creating skills is not available in this demo.")}><Plus size={12} /> Create skill</button></div>
      </header>
      <div className="page-body skills">
        <div className="row-head"><h2>Starter pack</h2><a className="btn" href="/skills"><BookOpen size={12} /> Open catalogue</a></div>
        <div className="packs">
          {STARTER_PACKS.map((p) => {
            const Icon = PACK_ICONS[p.id as keyof typeof PACK_ICONS];
            return (
              <article key={p.id} className="pack">
                <div className="pack-top"><span className="pack-icon"><Icon size={13} /></span><button className="btn" onClick={() => ctx.notify(p.id === "harness" ? "These skills are already published in the Bew Harness catalogue. Nothing is installed from here." : `“${p.name}” — demo only, nothing installed.`)}><Plus size={12} /> Add all</button></div>
                <h3>{p.name}</h3><p>{p.description}</p><span className="hint">{p.meta}</span>
              </article>
            );
          })}
        </div>
        <div className="row-head">
          <h2>Individual skills <span className="count">{rows.length}</span></h2>
          <label className="search-field"><Search size={13} /><input placeholder="Search by name, type, etc..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search skills" /></label>
        </div>
        <div className="table-wrap">
          <table className="skills-table">
            <thead><tr>{th("id", "Name")}<th>Description</th>{th("type", "Type")}<th>Agents</th>{th("author", "Author")}{th("updated", "Updated")}</tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td className="trunc">{s.description}</td>
                  <td><span className="type" data-type={s.type}>{s.type}</span></td>
                  <td className="trunc"><span className="agents">{s.agents.slice(0, 2).join(", ")}</span>{s.agents.length > 2 ? <span className="more">+{s.agents.length - 2}</span> : null}</td>
                  <td><span className="avatar" aria-hidden>{s.author[0]}</span> {s.author}</td>
                  <td>{s.updatedAgo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="empty">No skills match “{q}”.</p> : null}
        </div>
      </div>
    </>
  );
}
