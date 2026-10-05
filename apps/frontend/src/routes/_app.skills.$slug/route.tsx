import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  Copy,
  ExternalLink,
  FileCode,
  ListChecks,
  Ruler,
  Tag,
} from "lucide-react";

import GraphConnector from "@/components/skill-graph/graph-connector";
import GraphNode from "@/components/skill-graph/graph-node";
import SkillGraphCanvas from "@/components/skill-graph/skill-graph-canvas";
import { copyText } from "@/utils/utils.clipboard";
import {
  bodyWithoutFrontMatter,
  skillSections,
} from "@/utils/utils.skill-source";
import catalogService from "@/services/catalog-library";

const LEFT_NODES = [
  { key: "frontmatter" as const, y: 40 },
  { key: "domain" as const, y: 210 },
  { key: "usage" as const, y: 340 },
];

const NODE_WIDTH = 300;
const LEFT_X = 40;
const RIGHT_X = 420;
const RIGHT_Y = 40;
const RIGHT_WIDTH = 420;

const INITIAL_POSITIONS = {
  "node-frontmatter": { x: LEFT_X, y: LEFT_NODES[0].y, width: NODE_WIDTH },
  "node-domain": { x: LEFT_X, y: LEFT_NODES[1].y, width: NODE_WIDTH },
  "node-usage": { x: LEFT_X, y: LEFT_NODES[2].y, width: NODE_WIDTH },
  "node-skill": { x: RIGHT_X, y: RIGHT_Y, width: RIGHT_WIDTH },
} as const;

type NodeId = keyof typeof INITIAL_POSITIONS;

export default function SkillGraphRoute() {
  const { slug } = useParams();
  const entry = useMemo(() => catalogService.findBySlug(slug ?? null), [slug]);
  const [copied, setCopied] = useState(false);
  const [readSections, setReadSections] = useState<Set<number>>(new Set());
  const [positions, setPositions] = useState(INITIAL_POSITIONS);
  const [positionSlug, setPositionSlug] = useState(slug);
  if (positionSlug !== slug) {
    setPositionSlug(slug);
    setPositions(INITIAL_POSITIONS);
  }

  function moveNode(id: NodeId, x: number, y: number) {
    setPositions((current) => ({
      ...current,
      [id]: { ...current[id], x, y },
    }));
  }
  if (!entry || entry.category !== "skills") {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No skill matches "{slug}".
        </p>
        <Link
          to="/skills"
          className="mt-3 inline-flex items-center gap-1.5 font-mono text-sm text-primary hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Back to Skills
        </Link>
      </section>
    );
  }

  const usage = catalogService.usage(entry);
  const domain = entry.name.startsWith("frontend")
    ? "Frontend"
    : "Backend & Data";
  const body = bodyWithoutFrontMatter(entry.source);
  const excerpt = body.length > 420 ? `${body.slice(0, 420)}…` : body;
  const sections = skillSections(entry.source);

  const handleCopy = async () => {
    const ok = await copyText(usage.invocations[0] ?? `/${entry.name}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const toggleRead = (index: number) => {
    setReadSections((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const headerAnchor = 22;

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col">
      {/* Top bar, after Outglow's builder header: breadcrumb + real actions. */}
      <div className="flex items-center justify-between border-b border-border/70 bg-card px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Link
            to="/skills"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Skills
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-foreground">{entry.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 font-mono text-xs font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
          >
            <Copy aria-hidden="true" className="size-3.5" />
            {copied ? "Copied" : "Copy invocation"}
          </button>
          <Link
            to={`/library?node=${entry.slug}`}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 active:scale-95"
          >
            Open in Library
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* Two columns, after Outglow's builder: a fixed-width walkthrough rail
          on the left, the node canvas taking the rest. */}
      <div className="flex min-h-0 flex-1">
        {/* Walkthrough: the skill's own `##` sections, in file order — a real
            table of contents an operator checks off while reading, not an
            invented "agent run" trace (there is no agent executing here). */}
        <aside className="flex w-90 shrink-0 flex-col border-r border-border/70 bg-card">
          <div className="border-b border-border/70 px-4 py-3">
            <h2 className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider text-foreground uppercase">
              <ListChecks
                aria-hidden="true"
                className="size-3.5 text-primary"
              />
              Walkthrough
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              This skill's own {sections.length} section
              {sections.length === 1 ? "" : "s"}, read straight from {entry.id}
              .md.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {sections.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">
                This skill has no `##` sections to walk through.
              </p>
            ) : (
              sections.map((section, index) => {
                const read = readSections.has(index);
                return (
                  <button
                    key={section.title}
                    type="button"
                    onClick={() => toggleRead(index)}
                    aria-pressed={read}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      read
                        ? "border-primary/30 bg-primary/5"
                        : "border-border/70 bg-background hover:bg-muted/50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${
                        read
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {read ? (
                        <Check aria-hidden="true" className="size-2.5" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {section.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs/relaxed text-muted-foreground">
                        {section.preview}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-border/70 px-4 py-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              {readSections.size}/{sections.length} sections checked
            </p>
          </div>
        </aside>

        {/* Canvas: the node graph, after Outglow's agent builder. */}
        <div className="min-h-0 flex-1">
          <SkillGraphCanvas
            connectors={
              <>
                {(
                  [
                    ["node-frontmatter", "sky"],
                    ["node-domain", "amber"],
                    ["node-usage", "primary"],
                  ] as const
                ).map(([id, tone]) => (
                  <GraphConnector
                    key={id}
                    fromX={positions[id].x + positions[id].width}
                    fromY={positions[id].y + headerAnchor}
                    toX={positions["node-skill"].x}
                    toY={positions["node-skill"].y + headerAnchor}
                    tone={tone}
                  />
                ))}
              </>
            }
          >
            <GraphNode
              id="node-frontmatter"
              label="Front matter"
              icon={Tag}
              x={positions["node-frontmatter"].x}
              y={positions["node-frontmatter"].y}
              onMove={(x, y) => moveNode("node-frontmatter", x, y)}
            >
              <p className="font-mono text-xs text-foreground">
                name: <span className="text-primary">{entry.name}</span>
              </p>
              <p className="mt-1.5 text-xs/relaxed text-muted-foreground">
                {entry.description}
              </p>
            </GraphNode>

            <GraphNode
              id="node-domain"
              label="Domain"
              icon={Blocks}
              badge={domain}
              x={positions["node-domain"].x}
              y={positions["node-domain"].y}
              onMove={(x, y) => moveNode("node-domain", x, y)}
            >
              <p className="text-xs/relaxed text-muted-foreground">
                Derived from the skill's own front-matter name — no separate tag
                file to drift out of sync.
              </p>
              <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                <Ruler aria-hidden="true" className="size-3" />
                {entry.lineCount} lines
              </p>
            </GraphNode>

            <GraphNode
              id="node-usage"
              label="Usage"
              icon={FileCode}
              x={positions["node-usage"].x}
              y={positions["node-usage"].y}
              onMove={(x, y) => moveNode("node-usage", x, y)}
            >
              <p className="font-mono text-[11px] text-muted-foreground">
                destination
              </p>
              <p className="truncate font-mono text-[11px] text-foreground">
                {usage.destination}
              </p>
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                invocation
              </p>
              <code className="mt-0.5 block rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] text-primary">
                {usage.invocations[0] ?? `/${entry.name}`}
              </code>
            </GraphNode>

            <GraphNode
              id="node-skill"
              label="Skill"
              icon={Blocks}
              badge="Real"
              x={positions["node-skill"].x}
              y={positions["node-skill"].y}
              width={positions["node-skill"].width}
              onMove={(x, y) => moveNode("node-skill", x, y)}
            >
              <h3 className="text-sm font-semibold text-foreground">
                {entry.name}
              </h3>
              <p className="mt-1 text-xs/relaxed text-muted-foreground">
                {entry.description}
              </p>

              <div className="mt-3 border-t border-border/70 pt-3">
                <p className="mb-1 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Instructions
                </p>
                <p className="text-xs/relaxed whitespace-pre-line text-muted-foreground">
                  {excerpt}
                </p>
                <a
                  href={catalogService.documentUrl(entry)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                >
                  View full source
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              </div>
            </GraphNode>
          </SkillGraphCanvas>
        </div>
      </div>
    </section>
  );
}
