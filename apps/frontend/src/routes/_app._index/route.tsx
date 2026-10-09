import type { ReactNode } from "react";
import { Boxes, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { useModelProxyStatus } from "@/features/agent-builder/state/integration-queries";
import { setStoredReturnPath } from "@/utils/utils.return-path";

import CopyBlock from "@/components/copy-block";
import Flex from "@/components/ui/flex";
import { GITHUB_REPOSITORY_URL } from "@/services/catalog";

const CONTRIBUTION_TREE = `contributors/
├── default/                  # system (read-only)
│   └── tools/
│       ├── gateway/
│       ├── opencode/
│       └── omp/
└── <your-github-login>/       # your contributions
    └── tools/
        └── <tool-name>/
            └── README.md`;

interface WhitepaperSectionProps {
  children: ReactNode;
  index: string;
  title: string;
}

function WhitepaperSection({ children, index, title }: WhitepaperSectionProps) {
  return (
    <section className="space-y-4">
      <p className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {index}
      </p>

      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>

      {children}
    </section>
  );
}

export default function HomeRoute() {
  return (
    <article
      aria-labelledby="whitepaper-title"
      className="mx-auto w-full max-w-4xl space-y-12 px-6 pt-12 pb-24 text-left"
    >
      <header className="space-y-4 border-b border-border pb-10">
        <p className="flex items-center gap-2 font-mono text-xs font-medium tracking-wider text-primary uppercase">
          <Boxes aria-hidden="true" className="size-4" />
          MemWal
        </p>

        <h1
          id="whitepaper-title"
          className="font-bold tracking-tight text-balance text-3xl/tight sm:text-4xl"
        >
          Your next chat should remember your project.
        </h1>

        <p className="max-w-3xl text-muted-foreground text-base/relaxed">
          Explore ideas, make decisions, and continue where you left off—with relevant project context saved through Walrus Memory.
        </p>

        <HomeActions />
      </header>

      <section id="how-it-works" className="space-y-6">
        <WhitepaperSection
          index="01. How MemWal works"
          title="Connect a model, keep project context, start a new chat"
        >
          <div className="space-y-4 text-muted-foreground text-sm/relaxed">
            <p>
              MemWal organizes agent exploration around projects. Each project has its own persistent Walrus Memory namespace (<code>project/&lt;id&gt;</code>), so decisions and recalled facts stay with the project they belong to.
            </p>
            <p>
              <strong>1. Connect your model through ZRoute:</strong> Credentials and an OpenAI-compatible endpoint configure model access in one place.
            </p>
            <p>
              <strong>2. Connect project memory on Walrus:</strong> Context is stored on Walrus and shared across that project’s conversations. Each chat retains its own transcript.
            </p>
            <p>
              <strong>3. Chat with persistent recall:</strong> Start fresh conversations without repeating background details.
            </p>

            <div className="rounded-lg border border-border/80 bg-muted/20 p-4 text-xs/relaxed">
              <p className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
                Illustrative example (LaunchLens)
              </p>
              <p className="mt-1.5 text-muted-foreground">
                This walkthrough is an illustrative example of project memory behavior, not a live model reply or on-chain transaction receipt:
              </p>
              <p className="mt-2 text-foreground/90">
                A founder records that LaunchLens is built for solo SaaS founders, the team consists of two engineers, and the launch window is six weeks. In a later chat evaluating roadmap tradeoffs, the model recalls those saved constraints automatically—eliminating repetitive re-briefing.
              </p>
            </div>

            <Flex className="flex-wrap items-center gap-3 pt-2">
              <Link
                to="/builder/integrations?connect=model"
                onClick={() => setStoredReturnPath("/builder/integrations?connect=model")}
                className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium tracking-tight text-primary-foreground shadow-xs transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              >
                Connect model
              </Link>
            </Flex>
          </div>
        </WhitepaperSection>
      </section>

      <footer className="border-t border-border pt-8 mt-12">
        <details className="group space-y-4">
          <summary className="cursor-pointer text-xs font-medium tracking-wider text-muted-foreground hover:text-foreground uppercase transition-colors">
            For contributors: tool development and repository guidelines
          </summary>
          <div className="mt-4 space-y-4 text-muted-foreground text-sm/relaxed border-t border-border/50 pt-4">
            <p>
              Contribute a tool through a pull request. Each contributor owns a
              folder named after their GitHub username, with tool documentation
              written in Markdown.
            </p>

            <CopyBlock source={CONTRIBUTION_TREE} />

            <p>
              <strong className="font-semibold text-foreground">
                The default folder belongs to the system.
              </strong>{" "}
              It is read-only for contributors: do not edit, rename or delete
              anything under <code>contributors/default/</code>. Add your own
              username folder instead and keep your contributions inside it.
            </p>

            <ol className="list-decimal space-y-2 pl-5 marker:font-mono marker:text-muted-foreground">
              <li>Fork the repository and branch from dev.</li>
              <li>
                Create{" "}
                <code className="break-all font-mono text-xs">
                  contributors/&lt;your-github-login&gt;/tools/&lt;tool-name&gt;/
                </code>{" "}
                and add a <code>README.md</code> describing your tool.
              </li>
              <li>
                Open a pull request into dev with a description of the change and
                the checks you ran.
              </li>
            </ol>

            <a
              href={GITHUB_REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium tracking-tight text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            >
              Contribute on GitHub
              <ExternalLink aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </details>
      </footer>
    </article>
  );
}

function HomeActions() {
  const proxy = useModelProxyStatus();
  const ready = proxy.data?.status === "ready";
  const label = proxy.isLoading ? "Checking workspace…" : ready ? "Continue to workspace" : "Get started";
  const to = ready ? "/builder/chat" : "/builder/integrations?connect=model";
  return (
    <Flex className="flex-wrap items-center gap-3 pt-1">
      <Link
        to={to}
        onClick={() => {
          if (!ready) setStoredReturnPath("/builder/integrations?connect=model");
        }}
        className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium tracking-tight text-primary-foreground shadow-xs transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        {label}
      </Link>
      <a href="#how-it-works" className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium tracking-tight text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden">
        See how it works
      </a>
    </Flex>
  );
}
