import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Blocks, Copy, ExternalLink, Search, Workflow } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import Flex from "@/components/ui/flex";
import BlueprintReveal from "@/components/ui/blueprint-reveal";
import { copyText } from "@/utils/utils.clipboard";
import catalogService from "@/services/catalog-library";
import type { CatalogEntry } from "@/services/catalog-library";
type Domain = "frontend" | "backend";

const DOMAIN_LABEL: Record<Domain, string> = {
  frontend: "Frontend",
  backend: "Backend & Data",
};

/** Deterministic, from the skill's own front-matter name — never fabricated. */
function domainOf(entry: CatalogEntry): Domain {
  return entry.name.startsWith("frontend") ? "frontend" : "backend";
}

/**
 * Every skill this repository actually publishes, read straight from
 * `contributors/*\/libraries/skills/*\/SKILL.md` through the same catalogue
 * the Libraries canvas uses — nothing here is sample data.
 */
function useAllSkills(): CatalogEntry[] {
  return useMemo(() => {
    const contributors: (string | null)[] = [
      null,
      ...catalogService.contributors("library"),
    ];
    return contributors
      .flatMap((contributor) =>
        catalogService.listEntriesByCategory("skills", contributor),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);
}

export default function SkillsRoute() {
  const allSkills = useAllSkills();
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<"all" | Domain>("all");

  const packs = useMemo(() => {
    const byDomain = new Map<Domain, CatalogEntry[]>();
    for (const skill of allSkills) {
      const domain = domainOf(skill);
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), skill]);
    }
    return [...byDomain.entries()] as [Domain, CatalogEntry[]][];
  }, [allSkills]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return allSkills.filter((skill) => {
      if (domainFilter !== "all" && domainOf(skill) !== domainFilter)
        return false;
      if (!term) return true;
      return (
        skill.name.toLowerCase().includes(term) ||
        skill.description.toLowerCase().includes(term)
      );
    });
  }, [allSkills, domainFilter, query]);

  const addAll = async (skills: CatalogEntry[], packLabel: string) => {
    const lines = skills.map(
      (s) =>
        `${catalogService.usage(s).invocations[0] ?? `/${s.name}`}  — ${s.description}`,
    );
    const ok = await copyText(lines.join("\n"));
    if (ok) {
      toast.success(`${packLabel} copied`, {
        description: `${skills.length} skill invocation${skills.length === 1 ? "" : "s"} on your clipboard.`,
      });
    }
  };

  return (
    <section
      aria-labelledby="skills-title"
      className="mx-auto w-full max-w-6xl px-6 pt-10 pb-20"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            id="skills-title"
            className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground"
          >
            <Blocks aria-hidden="true" className="size-6 text-primary" />
            Skills
          </h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {allSkills.length} skill{allSkills.length === 1 ? "" : "s"} · live
            from contributors/*/libraries/skills
          </p>
        </div>

        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-lg border border-input bg-background py-1.5 pr-3 pl-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Starter packs: real domain buckets, "Add all" copies each skill's
          real invocation + description to the clipboard. */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {packs.map(([domain, skills], index) => (
          <BlueprintReveal
            key={domain}
            delay={index * 0.12}
            label={`${skills.length} skill${skills.length === 1 ? "" : "s"}`}
          >
            <div className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {DOMAIN_LABEL[domain]}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {skills.map((s) => s.name).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void addAll(skills, DOMAIN_LABEL[domain])}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 font-mono text-[11px] font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                >
                  <Copy aria-hidden="true" className="size-3" />
                  Add all
                </button>
              </div>
            </div>
          </BlueprintReveal>
        ))}
      </div>

      {/* Domain filter, using the beui Tabs component (segment variant). */}
      <div className="mt-8 flex items-center justify-between">
        <h3 className="font-mono text-xs font-semibold tracking-wider text-foreground uppercase">
          Individual skills · {visible.length}
        </h3>
        <Tabs
          value={domainFilter}
          onValueChange={(v) => setDomainFilter(v as "all" | Domain)}
          variant="segment"
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="frontend">Frontend</TabsTrigger>
            <TabsTrigger value="backend">Backend</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <BlueprintReveal
        delay={0.1}
        className="mt-3"
        label={`${visible.length} rows`}
      >
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
          {visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No skill matches "{query}".
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 font-mono text-[10px] text-muted-foreground uppercase">
                  <th className="px-4 py-2 font-semibold">Name</th>
                  <th className="px-4 py-2 font-semibold">Description</th>
                  <th className="px-4 py-2 font-semibold">Domain</th>
                  <th className="px-4 py-2 font-semibold">Length</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visible.map((skill) => (
                  <tr key={skill.slug} className="align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold whitespace-nowrap text-foreground">
                      {skill.name}
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-muted-foreground">
                      {skill.description}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
                        {DOMAIN_LABEL[domainOf(skill)]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                      {skill.lineCount} ln
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Flex className="justify-end gap-3">
                        <Link
                          to={`/skills/${skill.slug}`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-primary hover:underline"
                        >
                          Graph
                          <Workflow aria-hidden="true" className="size-3" />
                        </Link>
                        <Link
                          to={`/library?node=${skill.slug}`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-primary hover:underline"
                        >
                          Open
                          <ExternalLink aria-hidden="true" className="size-3" />
                        </Link>
                      </Flex>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </BlueprintReveal>
    </section>
  );
}
