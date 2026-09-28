import type { ReactNode } from "react";
import { GitPullRequest, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import Flex from "@/components/ui/flex";
import { Input } from "@/components/ui/input";
import { GITHUB_REPOSITORY_URL } from "@/services/catalog";

interface CatalogCanvasToolbarProps {
  searchPlaceholder: string;
  menu?: ReactNode;
  documentCount: number;
  collectionCount: number;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

/** Search and catalogue-wide actions, without duplicating collection nodes. */
export default function CatalogCanvasToolbar({
  menu,
  searchPlaceholder,
  documentCount,
  collectionCount,
  searchQuery,
  onSearchQueryChange,
}: CatalogCanvasToolbarProps) {
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
              placeholder={searchPlaceholder}
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
            <strong className="text-foreground">{documentCount}</strong>{" "}
            documents
            {" · "}
            <strong className="text-foreground">{collectionCount}</strong>{" "}
            collections
          </p>
        </div>

        <Flex className="flex-wrap items-center gap-2">
          {menu}

          <Button asChild className="h-10 px-3">
            <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
              <GitPullRequest aria-hidden="true" />
              Contribute
            </a>
          </Button>
        </Flex>
      </Flex>
    </header>
  );
}
