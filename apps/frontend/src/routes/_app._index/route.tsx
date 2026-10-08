import type { ReactNode } from "react";
import { Boxes, ExternalLink, Users, Wrench } from "lucide-react";
import { Link } from "react-router";

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

        <Flex className="flex-wrap items-center gap-3 pt-1">
          <Link
            to="/builder/integrations"
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium tracking-tight text-primary-foreground shadow-xs transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            Get started
          </Link>
          <Link
            to="/builder/chat"
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium tracking-tight text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            See how it works
          </Link>
        </Flex>
      </header>

      <WhitepaperSection
        index="01. How MemWal works"
        title="Connect a model, keep project context, start a new chat"
      >
        <div className="space-y-4 text-muted-foreground text-sm/relaxed">
          <p>1. Connect your model through ZRoute. A model connection is credentials and an endpoint, not an assistant.</p>
          <p>2. Save useful project context in Walrus Memory. That memory is shared across the project’s conversations. Each chat still has its own transcript.</p>
          <p>3. Start a new conversation without repeating the same background. The example below is illustrative, not a live model reply or a Mainnet receipt.</p>
          <p>
            Example: a founder saves that LaunchLens is for solo SaaS founders, the team has two engineers, and the release window is six weeks. A later chat asks what to prioritize. The saved constraints are the context, not the previous transcript.
          </p>
          <Flex className="flex-wrap items-center gap-3 pt-1">
            <Link
              to="/builder/integrations"
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium tracking-tight text-primary-foreground shadow-xs transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            >
              Connect model
            </Link>
            <Link
              to="/agents"
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium tracking-tight text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
            >
              <Users aria-hidden="true" className="size-3.5" />
              Provider accounts
            </Link>
          </Flex>
        </div>
      </WhitepaperSection>

      <WhitepaperSection
        index="02. How to contribute"
        title="Useful tools grow through contributions"
      >
        <div className="space-y-4 text-muted-foreground text-sm/relaxed">
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

          <ol className="list-decimal space-y-4 pl-5 marker:font-mono marker:text-muted-foreground">
            <li>Fork the repository and branch from dev.</li>

            <li>
              Create{" "}
              <code className="break-all font-mono text-xs">
                contributors/&lt;your-github-login&gt;/tools/&lt;tool-name&gt;/
              </code>{" "}
              and add a <code>README.md</code> describing your tool. You can
              update tools inside your own contributor folder.
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
      </WhitepaperSection>
    </article>
  );
}
