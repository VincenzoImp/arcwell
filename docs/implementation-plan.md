# Experimental Arcwell Legacy Implementation Plan

> This plan describes the legacy Experimental manifest and workflow path. It does not define
> the stable v1 setup schema; see `docs/arcwell-v1-plan.md` for canonical setup behavior.

Each phase must produce a runnable vertical. Behavioral changes begin with a failing test,
and no phase is called complete without fresh build, test, diagnostics, and diff review.

## Phase 0 — Legacy safety baseline

Prepare `pi-setup` 2.1.1 without publishing it:

- correct sandbox policy path, project trust, fail-closed behavior, subagent inheritance,
  effects guarding, completion detection, and transactional reinstall;
- move coding preferences to the settings section the package reads;
- correct MCP paths;
- selectively own exact package pins while preserving user packages;
- fix preset resume/tombstones, notifications, checkpoints, and effects classification;
- remove the incompatible Claude adapter from fresh legacy installs;
- add red/green regressions and update migration documentation.

Release, push, archive, and remote repository actions remain separately authorized effects.

## Phase 1 — Read-only planner (0.1)

Deliver:

- strict TypeScript package and CLI;
- versioned manifest parser;
- deterministic catalog and operation plan;
- `arcwell experimental plan --manifest ...` in human and JSON formats;
- no-write and portability tests;
- `capabilities` and `explain` read-only commands;
- Experimental manifest JSON Schema generated from the legacy TypeScript model.

Exit evidence: same input produces byte-identical JSON across repeated runs and no filesystem
mutation occurs outside compiler/test artifacts.

## Phase 1.5 — Fixed autonomous planning probe

Before building a generic graph runner, deliver one runnable `arcwell experimental run plan` vertical:

- isolated in-memory Pi SDK sessions for `scout` and `planner`;
- no project extension, skill, prompt, theme, or context-file discovery;
- project-bounded read/list tools and sensitive-file blocking;
- typed submission tools and repository-relative structured artifacts;
- explicit abort, contract failure, disposal, and sanitized error behavior;
- one JSON document on stdout with bounded progress on stderr;
- subagent remains the default; enabling Herdr only makes it available for explicit nodes.

This probe must remain read-only. It proves the agent and artifact contracts without adding a
DAG engine, state database, queue, retry loop, or Herdr dependency.

## Phase 2 — Transactional core lifecycle (0.2)

Deliver one shared engine for wizard and headless commands:

- platform/target discovery kept outside the portable manifest;
- lock and stale-lock handling;
- staged rendering and semantic diff;
- ownership ledger by file and JSON section;
- backup, atomic activation, post-activation verification, and rollback;
- `apply`, `diff`, `doctor`, `rollback`, and `uninstall`;
- failure injection before and after every mutation boundary.

Start with Core files only: working agreement, settings sections, agents, and one skill.

## Phase 3 — Intelligence packs (0.3)

Deliver:

- skill/agent/prompt contract schemas;
- Core and Engineering packs adapted from the audited setup;
- provenance, version, token budget, and required-tool validation;
- prompt composer and conflict diagnostics;
- `arcwell experimental explain` output for effective agreement, tools, skills, and ownership;
- static and scenario evaluation harness.

No third-party skill is shipped unchanged merely for coverage.

## Phase 4 — Workflow DAG (0.4)

Start with a non-executing graph contract probe:

- strict node vocabulary and JSON Schema for agents, verification, and user gates;
- maximum 32 nodes, concurrency 8, retries 2, and worker fan-out bounded by concurrency;
- write access only in isolated workspaces;
- cycle, dependency, unknown-field, and platform-portable identifier validation;
- deterministic capacity-aware execution waves;
- read-only `workflow validate --file ...` for user-authored graphs;
- real `run feature` preparation through scout, planner, dependency-aware task partitions, and the mandatory approval gate;
- opt-in Pi custom-entry checkpoint persistence with exact entry/digest and relevant-file snapshot binding;
- explicit approval resume producing a deterministic isolated-worker dispatch preview;
- one explicit Pi-backed root-task worker with approved-file-only atomic writes and no integration;
- curated `feature` graph with six-worker fan-out, integration, review, verification, and acceptance.

Then deliver a bounded graph runner over Pi primitives:

- graph schema and validator;
- node dependencies and parallel branches;
- agent, verification, artifact, and user-gate nodes;
- explicit conditions and bounded cycles;
- Pi session-entry state and context-sidecar artifacts;
- status, abort, and resume commands;
- curated `plan`, `feature`, `bugfix`, `review`, `audit`, and `research` graphs;
- compatibility aliases for legacy workflow prompts.

Do not add a database, queue, scheduler, or dynamic unbounded planner.

## Phase 5 — Herdr backend (0.5)

Deliver:

- capability/version detection without installation side effects;
- explicit module plan and delegated ownership;
- official `herdr integration install pi`/uninstall lifecycle;
- persistent agent-node backend using Herdr JSON identifiers;
- lifecycle-state mapping and blocked-user gates;
- explicit per-node fallback policy;
- fake-Herdr contract tests and one opt-in real integration suite;
- macOS, Linux, and Windows coverage.

Arcwell never auto-answers a Herdr pane's approval UI.

## Phase 6 — Lazy integrations and wizard (0.6)

Deliver:

- compatible lazy Claude Code subscription adapter with fake CLI tests;
- lazy MCP module using correct global/project trust semantics;
- accessible Experimental wizard producing the legacy manifest;
- Core, Full, Team/Herdr, and Security-focused guided choices;
- keyboard-only, no-color, screen-reader-friendly, and headless parity tests.

No provider/auth probe is permitted during ordinary Pi startup.

## Phase 7 — Postures and migration (0.7)

Deliver:

- host, guarded, and isolated posture contracts;
- fail-closed sandbox module and posture inheritance by subagents/backends;
- platform capability diagnostics;
- `arcwell migrate pi-setup` read-only analysis followed by explicit apply;
- keep/replace/deprecate matrix for every legacy capability;
- migration rollback and coexistence tests.

## Phase 8 — Stabilization (0.8–1.0)

- publish prereleases only after separate authorization;
- test real Pi on macOS, Linux, and Windows;
- test clean install, upgrade, interrupted apply, rollback, uninstall, and migration;
- run skill/workflow evaluation matrix and token-budget checks;
- audit package contents, licenses, provenance, and secret exposure;
- produce signed checksums and release notes;
- promote to 1.0 only when all specification acceptance criteria have fresh evidence.

## Immediate next tasks

1. Complete the Phase 1 catalog model and add `capabilities`.
2. Add `explain` and JSON Schema generation.
3. Define operation ownership/effect metadata needed by Phase 2 without performing writes.
4. Add Windows path and newline fixtures to the planner.
5. Review the Phase 1 diff before beginning lifecycle mutations.
