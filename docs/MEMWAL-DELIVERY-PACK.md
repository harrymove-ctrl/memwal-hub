# MemWal product and implementation pack

Prepared 8 October 2026. Documentation only; application source was not modified for this request.

## Start here

1. [Full copy-ready implementation prompt](specs/memwal-master-implementation-prompt.md)
2. [Current behavior and interaction audit](specs/builder-interaction-audit.md)
3. [Architecture, scope and submission specification](specs/memwal-conversations-submission.md)

## Product requirements

| PRD | Scope |
| --- | --- |
| [01 — Projects and conversations](prds/01-projects-and-conversations.md) | Real New chat, IDs, history, switching, refresh and authorization |
| [02 — Project memory and runtime](prds/02-project-memory-and-runtime.md) | Relevant cross-chat recall, corrections, model switching and isolation |
| [03 — Demo and submission](prds/03-demo-and-submission.md) | Recording script, evidence matrix, article and form preparation |
| [04 — Agent builder and canvas](prds/04-agent-builder-and-canvas.md) | Create agent, useful inspectors, persisted revisions and real runtime wiring |

## Main finding

The current builder combines local demo configuration, a scripted run service, fixture tools and a separate API-backed Chat path. New agent explicitly displays an unavailable notice. Canvas editing does not establish that the real model executes that configuration.

The proposed release joins these paths: project → persistent agent configuration → conversation → relevant Walrus recall → real model → reviewed memory write. The development harness remains a development workflow unless a separate runtime adapter is implemented.

## Evidence collected

- Read the active builder/runtime paths and related architecture, auth, API and memory code; full coverage limits are in the audit.
- Opened Research Companion in a separate local browser tab, reproduced New agent's demo notice and inspected/cancelled the local-only editor.
- Type checking passed.
- Four targeted frontend test files passed: 34 tests.
- No authenticated live model call, Mainnet write, full build or full test-suite verification was performed.

## Implementation handoff

Documentation checkout: `/Users/harryphan/orca/memwal-hub`.

Last verified running frontend checkout: `/Users/harryphan/orca/workspaces/memwal-hub/branch/apps/frontend`.

Review the latest state before implementing because the running checkout contains ongoing work. All proposed APIs, PRD behaviors and future capabilities in this pack remain requirements until implemented and tested.
