import { GitPullRequest, Search, X } from "lucide-react";

import Flex from "@/components/ui/flex";
import { Input } from "@/components/ui/input";
import { GITHUB_REPOSITORY_URL } from "@/services/catalog";

import ToolsCatalogMenu from "./tools-catalog-menu";

interface ToolsCatalogToolbarProps {
  contributor: string | null;
  documentCount: number;
  collectionCount: number;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

/** Search and catalogue-wide actions, without duplicating collection nodes. */
export default function ToolsCatalogToolbar({
  contributor,
  documentCount,
  collectionCount,
  searchQuery,
  onSearchQueryChange,
}: ToolsCatalogToolbarProps) {
  return (
    <header className="border-b border-border/70 bg-card/95 px-5 py-4 backdrop-blur-md">
      <Flex className="w-full flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="lg:max-w-120 w-full space-y-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />

            <Input
              type="search"
              value={searchQuery}
              aria-label="Search the catalogue"
              placeholder={
                contributor
                  ? `Search @${contributor}'s tools...`
                  : "Search tools and installers..."
              }
              onChange={(event) => onSearchQueryChange(event.target.value)}
              className="h-10 w-full rounded-xl bg-muted pr-8 pl-9 text-sm cancelbut"
            />

            {searchQuery ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearchQueryChange("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>

          <p className="font-mono text-xs text-muted-foreground">
            <strong className="text-foreground">{documentCount}</strong> documents
            {" · "}
            <strong className="text-foreground">{collectionCount}</strong>{" "}
            collections
          </p>
        </div>

        <Flex className="items-center gap-2 flex-wrap">
          <ToolsCatalogMenu contributor={contributor} />

          <a
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 font-mono text-sm font-medium text-primary-foreground shadow-xs transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            <GitPullRequest aria-hidden="true" className="size-4" />
            Contribute
          </a>
        </Flex>
      </Flex>
    </header>
  );
}
