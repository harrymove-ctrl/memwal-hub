import { useParams } from "react-router";

import CatalogCanvas from "@/components/catalog-canvas";
import CatalogCanvasMenu from "@/components/catalog-canvas/catalog-canvas-menu";
import { SolaceFieldShader } from "@/components/solace-field-shader";

export default function LibraryRoute() {
  // `/library` reads the shared catalogue; `/library/synasapmob` reads that
  // workspace's own. Absent means shared, which is why the parameter is
  // optional rather than a second route with a duplicated canvas.
  const { contributor = null } = useParams();

  return (
    <div className="relative min-h-full">
      {/* Ambient cellular field behind the catalogue. Fixed and inert so it
          costs nothing to interaction; low intensity + the paper-tinted
          palette keep it a texture, not a light show. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-60"
      >
        <SolaceFieldShader
          variant="cellular"
          intensity={0.75}
          speed={0.9}
          scale={1.2}
          colors={{
            background: "#faf7f3",
            primary: "#aabdf0",
            secondary: "#dfd6c8",
            highlight: "#e7ddff",
          }}
        />
      </div>

      <div className="relative">
        <CatalogCanvas
          section="library"
          contributor={contributor}
          searchPlaceholder={
            contributor
              ? `Search @${contributor}'s workspace...`
              : "Search collections and files..."
          }
          menu={
            <CatalogCanvasMenu contributor={contributor} section="library" />
          }
        />
      </div>
    </div>
  );
}
