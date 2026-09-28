import { Download, FileText } from "lucide-react";

import Flex from "@/components/ui/flex";
import { type CatalogCollectionFile } from "@/services/catalog-library";
import { downloadText } from "@/utils/utils.download";

interface CatalogCanvasCollectionFilesProps {
  files: CatalogCollectionFile[];
}

/** Every source document in a collection, with direct open and download actions. */
export default function CatalogCanvasCollectionFiles({
  files,
}: CatalogCanvasCollectionFilesProps) {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
      {files.map((file) => (
        <li key={file.path}>
          <Flex className="w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-hidden">
            <FileText
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />

            <div className="min-w-0 flex-1">
              <Flex className="items-start justify-between gap-3">
                <p className="text-sm/normal font-medium text-foreground">
                  {file.title}
                </p>

                <button
                  type="button"
                  aria-label={`Download ${file.name}`}
                  className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  onClick={() => downloadText(file.name, file.source)}
                >
                  <Download
                    aria-hidden="true"
                    className="size-5 text-muted-foreground hover:text-primary"
                  />
                </button>
              </Flex>

              <p className="mt-2 line-clamp-3 text-xs/relaxed text-muted-foreground">
                {file.description}
              </p>

              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 block truncate font-mono text-[10px] text-primary underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                {file.path}
              </a>
            </div>
          </Flex>
        </li>
      ))}
    </ul>
  );
}
