import {
  BadgeCheck,
  BookOpen,
  Files,
  GitPullRequest,
  Network,
  Plug,
  Sparkles,
  Tags,
  type LucideIcon,
} from "lucide-react";

import Center from "@/components/ui/center";
import Flex from "@/components/ui/flex";
import BlueprintReveal from "@/components/ui/blueprint-reveal";
import catalogService, { type CatalogCollection } from "@/services/catalog";

const collectionIcons: Record<string, LucideIcon> = {
  documents: BookOpen,
  evidences: BadgeCheck,
  github: GitPullRequest,
  gateway: Network,
  mcp: Plug,
  skills: Sparkles,
  tags: Tags,
  templates: Files,
};

/**
 * One distinct tint per functional collection, after Outglow Studio's
 * per-type badge system (agent-builder-ui-one.vercel.app/#/skills): each
 * card's icon chip carries its own hue rather than a single repeated
 * indigo, so a reader tells collections apart by colour before reading a
 * label. Every pair is a `-600`/`-500` ink on a `-50`/`900` tint — AA on
 * both themes since the app is `.dark`-scoped rather than OS-driven.
 */
const collectionTints: Record<
  string,
  { chip: string; icon: string; hoverTitle: string; hoverBorder: string }
> = {
  documents: {
    chip: "border-cyan-200 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950",
    icon: "text-cyan-600 dark:text-cyan-400",
    hoverTitle: "group-hover:text-cyan-600 dark:group-hover:text-cyan-400",
    hoverBorder: "hover:border-cyan-300 dark:hover:border-cyan-700",
  },
  evidences: {
    chip: "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950",
    icon: "text-emerald-600 dark:text-emerald-400",
    hoverTitle:
      "group-hover:text-emerald-600 dark:group-hover:text-emerald-400",
    hoverBorder: "hover:border-emerald-300 dark:hover:border-emerald-700",
  },
  github: {
    chip: "border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950",
    icon: "text-violet-600 dark:text-violet-400",
    hoverTitle: "group-hover:text-violet-600 dark:group-hover:text-violet-400",
    hoverBorder: "hover:border-violet-300 dark:hover:border-violet-700",
  },
  gateway: {
    chip: "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950",
    icon: "text-sky-600 dark:text-sky-400",
    hoverTitle: "group-hover:text-sky-600 dark:group-hover:text-sky-400",
    hoverBorder: "hover:border-sky-300 dark:hover:border-sky-700",
  },
  mcp: {
    chip: "border-fuchsia-200 bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-fuchsia-950",
    icon: "text-fuchsia-600 dark:text-fuchsia-400",
    hoverTitle:
      "group-hover:text-fuchsia-600 dark:group-hover:text-fuchsia-400",
    hoverBorder: "hover:border-fuchsia-300 dark:hover:border-fuchsia-700",
  },
  skills: {
    chip: "border-primary/25 bg-primary/10",
    icon: "text-primary",
    hoverTitle: "group-hover:text-primary",
    hoverBorder: "hover:border-primary/40",
  },
  tags: {
    chip: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950",
    icon: "text-amber-600 dark:text-amber-400",
    hoverTitle: "group-hover:text-amber-600 dark:group-hover:text-amber-400",
    hoverBorder: "hover:border-amber-300 dark:hover:border-amber-700",
  },
  templates: {
    chip: "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950",
    icon: "text-rose-600 dark:text-rose-400",
    hoverTitle: "group-hover:text-rose-600 dark:group-hover:text-rose-400",
    hoverBorder: "hover:border-rose-300 dark:hover:border-rose-700",
  },
};

const defaultTint = collectionTints.skills;

interface CatalogCanvasCollectionCardProps {
  collection: CatalogCollection;
  onSelect: (collection: CatalogCollection) => void;
  /** Entrance stagger index, fed to BlueprintReveal's delay. */
  index?: number;
}

/** One functional domain, regardless of how many source folders feed it. */
export default function CatalogCanvasCollectionCard({
  collection,
  onSelect,
  index = 0,
}: CatalogCanvasCollectionCardProps) {
  const CollectionIcon = collectionIcons[collection.id] ?? Files;
  const fileCount = catalogService.collectionFiles(collection).length;
  const tint = collectionTints[collection.id] ?? defaultTint;

  return (
    <li>
      <BlueprintReveal
        delay={Math.min(index, 7) * 0.06}
        label={`${fileCount} files`}
      >
        <button
          type="button"
          onClick={() => onSelect(collection)}
          className={`group flex w-full flex-col rounded-xl border border-border/70 bg-card p-4 text-left shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden ${tint.hoverBorder}`}
        >
          <Flex className="items-start justify-between">
            <Center
              className={`size-10 rounded-xl border shadow-xs ${tint.chip} ${tint.icon}`}
            >
              <CollectionIcon aria-hidden="true" className="size-5" />
            </Center>

            <p className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[11px] font-semibold text-muted-foreground">
              {fileCount} files
            </p>
          </Flex>

          <h3
            className={`mt-4 text-sm font-bold tracking-tight text-foreground transition-colors ${tint.hoverTitle}`}
          >
            {collection.label.toUpperCase()}
          </h3>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {collection.summary}
          </p>
        </button>
      </BlueprintReveal>
    </li>
  );
}
