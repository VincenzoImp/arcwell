# Arcwell Product Specification

## Stable v1 contract

Arcwell `0.1.0` requires Node.js `>=24.15.0` and targets the locally audited Pi `0.84.4` API.
The package is currently unpublished. Its exact stable surface is:

```text
arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]
arcwell doctor [--json]
arcwell uninstall [--yes]
```

The npm package is not published. With an npm version that supports GitHub shorthands, bootstrap
the exact release with `npx github:VincenzoImp/arcwell#v0.1.0 setup`; Pi resources use
`pi install git:github.com/VincenzoImp/arcwell@v0.1.0`. Generate and inspect input with `setup
--dry-run --write-manifest arcwell.json`, then apply headlessly with `setup --manifest arcwell.json
--yes` through the same exact `npx` source. Non-TTY mutation requires both manifest and
confirmation flags. Dry run and manifest output perform no install, Pi settings mutation, model
call, or network access. A TTY dry run without a manifest collects wizard choices without an apply
confirmation before rendering/writing the selected manifest; non-TTY dry run uses deterministic
defaults.

The only profile is `core`. The default posture is `guarded`. Effects, secrets, and redaction
protections default on and can each be disabled. `host` requires all three to be false. Core module
defaults are LSP, context sidecar, todo, questionnaire, plan mode, and lazy MCP on; web, subagents,
and autonomous workflows off. Every module is independently boolean. Wizard output warns that web
and MCP may use network access and configured credentials, and that subagents and autonomous
workflows invoke additional paid model calls when selected and used.
`providerGuidance.claudeSubscription` defaults on but creates no package/auth operation.

Setup installs exact Pi package sources, merges only a marked block in
`$PI_CODING_AGENT_DIR/AGENTS.md`, and writes bounded non-secret config/ownership under
`$PI_CODING_AGENT_DIR/arcwell/`. Arcwell uses Pi's `getAgentDir()` when the documented environment
variable is unset. Pi's documented package-list installed path is required. Setup health and doctor
verify the selected Arcwell package has exact `package.json` name/version, a regular
`dist/extensions/arcwell-protections.js`, and a loadable extension module without registering it.
Filtered selected packages remain errors. Setup refuses mutation when an active global known
catalog package is deselected and unowned; owned deselected packages remain removable during
reconfiguration. Doctor reports that unowned/unselected state as unhealthy. Doctor otherwise checks
Pi version, exact package state, config, protections, agreement digest, and ownership without
reading credentials. Idempotent setup is required. Uninstall removes only package sources recorded
as Arcwell-installed, marked content, owned files, and an empty Arcwell directory created by setup.
It preserves Pi, credentials, sessions, trust, pre-existing packages, and unrelated bytes. Missing
managed agreement content is treated as modified and preserves recovery state. TTY uninstall asks
for confirmation; `--yes` skips it and is required for non-TTY mutation. A failed setup uses bounded
compensation; a recoverable uninstall failure retains ownership where possible. Recovery is
`arcwell doctor --json`, correction of the reported cause, and an exact setup retry or
`arcwell uninstall --yes`. Stable v1 has no rollback command.

Arcwell delegates Claude authentication to Pi's native `/login` and never inspects auth state.
Users must deliberately select the intended Anthropic method: subscription login and API-key access
are different billing paths, and an API key or another provider can incur separate API charges.
Arcwell cannot verify account, quota, plan, or billing destination.

Installing npm/Pi packages runs code with user permissions. Users must inspect and pin the tarball,
integrity, dependency tree, native resources, `LICENSE`, and `NOTICE`. Arcwell's effects and secret
matching are command-text/tool-result guardrails, not a sandbox, complete shell enforcement,
malware defense, or full authorization boundary. Dynamic variables, substitutions, generated or
encoded commands, and existing scripts can evade matching; stronger enforcement requires excluded
OS isolation.

Stable v1 explicitly excludes coding preferences, nopeek, confirm-destructive, background tasks,
dynamic workflow execution, web UI, Git checkpoints, notifications, Herdr, OS isolation, candidate
integration, workspace rollback, Arcwell presets, Full/Custom profiles, an Arcwell DAG/scheduler,
custom session ledgers, databases, queues, release automation, and unauthorized CI creation.
Experimental commands do not enlarge this stable contract.

Local tests use fake Pi clients and repository-local scratch directories. A real-package Pi smoke
passed on macOS; Linux and Windows evidence remains pending and release-gated. No cross-platform
support claim follows from injected adapters or the macOS result alone.

## Legacy Experimental appendix

Everything below describes the separate `arcwell experimental` design. Its manifest and workflow
schemas are not accepted by stable setup and do not define v1 completion.

### Product concept

**Arcwell** is a reproducible, batteries-included environment for Pi.

Arcwell distributes and maintains the intelligence of the harness—working agreements,
skills, agents, prompts, workflow graphs, integrations, and execution policy—not merely an
installer.

The product principle is:

> Simple by default, powerful by design.

No useful capability is removed merely to simplify the interface. Arcwell uses progressive
disclosure: quick setup, guided profiles, and complete declarative control share one engine.

## Historical Experimental surfaces

The legacy proposal included additional top-level lifecycle commands, but they are not commands in
the stable contract above. Implemented legacy behavior is namespaced, for example:

```text
arcwell experimental init [--profile core|full] [--posture host|guarded|isolated]
arcwell experimental capabilities
arcwell experimental explain --manifest arcwell.json
arcwell experimental plan --manifest arcwell.json
```

Experimental plan is read-only and deterministic. Its manifest is not setup input. Proposed legacy
`apply` and `rollback` surfaces do not exist as stable commands.

## Manifest

The manifest is versioned, committable, and free of secrets and machine paths. It separates:

- **profile**: capability selection (`core`, `full`, or custom);
- **posture**: execution boundary (`host`, `guarded`, or `isolated`);
- **intelligence**: skill packs and curated/user workflow graphs;
- **modules**: Claude Code, MCP, Herdr, sandbox, and future optional integrations.

Exact dependency pins live in Arcwell's tested catalog. A reproducible apply never resolves
`latest`; catalog updates arrive as reviewed, tested changes.

## Progressive disclosure

1. **Quick setup** asks a small number of goal-oriented questions.
2. **Guided profiles** expose Core, Full, Team/Herdr, and Security-focused choices.
3. **Advanced mode** exposes every module, workflow, model policy, and execution backend.
4. `arcwell experimental capabilities` shows installed, enabled, available, and unsupported items.
5. `arcwell experimental explain` shows effective prompts, skills, tools, provenance, ownership, and
   conflicts before installation.

Errors must name the failed capability, why it matters, and the next safe action.

## Intelligence layer

### Working agreement

A short global agreement contains only durable invariants: precedence, authorization,
secrets, evidence, delegation limits, and remote effects. Procedures belong in skills.

### Curated skill packs

Arcwell adapts useful external ideas into coherent Arcwell packs rather than copying an
entire corpus unchanged.

Every skill declares:

- trigger and non-trigger scenarios;
- required tools and capabilities;
- side effects and authorization requirements;
- input and output contract;
- provenance and version;
- token budget;
- static checks and behavioral evaluations.

Initial packs:

- **core**: review, debugging, verification, scope control, hardened web research;
- **engineering**: brainstorming, planning, TDD, implementation, worktree and review flows;
- **security**: threat review, secret handling, dependency and boundary checks;
- **release**: release preparation and remote operations, always opt-in.

### Agents

The initial roles are `scout`, `planner`, `worker`, and `reviewer`. An agent exists only when
it has a distinct contract: tool allowlist, side effects, output schema, budget, model policy,
and delegation rights.

### Prompt composition

Prompt templates are aliases or small one-shot templates, not workflow engines hidden in
prose. Arcwell composes the working agreement, active skill descriptions, selected agent
contract, and workflow-node instructions, then detects conflicts and reports the effective
result through `arcwell experimental explain`.

## Workflow graphs

The first executable probe is intentionally not a generic runner: `arcwell experimental run plan` runs a
fixed `scout → planner` sequence through two isolated, in-memory Pi SDK sessions. It disables
project resource discovery, exposes only project-bounded read/list tools plus one typed
submission tool per role, and passes a structured artifact rather than concatenated prose.
Pi credentials are resolved through Pi's read-only loader and cloned into one ephemeral runtime
shared by both nodes; settings and model catalogs remain in memory. This validates the
contracts before Arcwell generalizes them into a DAG. The next static vertical validates and
explains the curated `feature` graph without executing it: deterministic waves, at most six
parallel workers, isolated write workspaces, explicit integration, review, verification, and
two user gates.

Arcwell currently ships the static `feature` graph contract. The roadmap adds curated graphs for:

- `plan`;
- `feature`;
- `bugfix`;
- `review`;
- `audit`;
- `research`;
- opt-in `release`.

User-authored declarative graphs can be schema-checked and semantically validated, but are not
executed yet. The planned runner is a bounded DAG over Pi's existing primitives, not a general
workflow platform; it will use the same validated node, artifact, workspace, retry, concurrency,
and gate contracts proven by the static planner. `arcwell experimental run feature` already executes the
read-only scout and planner nodes, converts plan steps into dependency-bearing task partitions,
and emits a graph-digested checkpoint blocked at `approve-plan`. Optional persistence uses Pi
custom session entries, binds the emitted entry and digest to a bounded relevant-file snapshot,
and requires explicit approval on resume. Resume emits the deterministic isolated-worker dispatch
preview. A separate explicit command can execute one dependency-free task in an Arcwell-owned
workspace using read/list and an approved-file-only atomic write tool. It records a bounded changeset
but performs no shell execution, deletion, integration, fan-out, or project mutation.

Supported concepts:

- `needs` dependencies and parallel branches;
- agent, verification, artifact, and user-gate nodes;
- explicit conditions;
- bounded retry/review cycles;
- abort and resume;
- structured artifacts instead of unbounded `{previous}` concatenation;
- state stored in Pi session entries and large output stored in the context sidecar.

There is no separate database, scheduler, queue, or team coordination service in 1.0.

## Execution backends

### Subagent

The default backend for short, isolated, headless work. It inherits the active posture and
never reads untrusted project agents.

### Herdr

Herdr is a first-class optional backend for persistent and observable graph nodes. Arcwell:

- detects a compatible Herdr version;
- requests approval before `herdr integration install pi`;
- delegates ownership of Herdr's Pi extension to Herdr;
- uses Herdr's JSON CLI/socket identifiers instead of predicting panes;
- maps `working`, `blocked`, `idle`, and `done` into workflow state;
- never sends keys to approve a blocked remote or destructive action;
- falls back only when the graph explicitly permits it.

Enabling Herdr makes that backend available; it never changes Arcwell's global default.
Backend selection is explicit per persistent node. Workflows remain usable without Herdr.

## Providers and integrations

### Claude Code subscription

Arcwell replaces the incompatible legacy adapter with an `@earendil-works/*` compatible,
lazy adapter. It performs no Claude version or authentication probe during Pi startup. The
first actual use performs capability checks without exposing credentials and respects the
active toolset and posture. Tests use a fake Claude executable and cover unavailable,
unauthenticated, cancelled, and successful paths.

### MCP

MCP is available in Core but lazy. Global configuration uses Pi's agent directory; project
configuration follows Pi project trust. Arcwell never commits MCP environment secrets.

## Execution postures

- **host**: normal host execution; authorization policy still applies where selected;
- **guarded**: effects guard, secret-read policy, project trust, and explicit approvals;
- **isolated**: guarded plus a required fail-closed OS sandbox.

Capability profile and posture are independent. A Full profile may run guarded; a small Core
profile may run isolated.

## Lifecycle and ownership

Apply is transactional:

1. acquire an installation lock;
2. validate manifest, catalog, platform, and dependencies;
3. render into staging;
4. calculate and display the plan;
5. back up owned paths;
6. atomically activate staged content;
7. run semantic verification;
8. roll back automatically on failure.

Arcwell records ownership per path or settings section. Unknown user files and package
sections survive. Delegated files are removed through their owner (for example Herdr), not
by blind deletion. Manifest, ownership record, and backups contain no credentials.

## Historical platform target

The legacy design targeted macOS, Linux, and Windows with per-module prerequisites and fallback
behavior. That target is not validation evidence: only the macOS real-package smoke has passed;
Linux and Windows remain release-gated.

## Accessibility

The wizard supports keyboard-only operation, plain-language questions, non-color output,
stable focus order, `--no-color`, and a complete headless equivalent. Essential information
is never encoded only by color or animation.

## Evaluation and release gates

- TypeScript strict build and deterministic unit/integration tests;
- manifest and catalog mutation tests;
- install failure injection at every lifecycle stage;
- Windows, macOS, and Linux CI;
- real Pi compatibility tests;
- skill trigger/non-trigger scenarios and prompt token budgets;
- workflow failure, gate, abort, and resume scenarios;
- fake Claude and fake Herdr contract suites;
- a small private release evaluation against real models, with no credentials in CI output.

## 1.0 acceptance criteria

- Quick setup produces a valid portable manifest and a useful Core environment.
- Full exposes all supported capabilities without forcing eager startup costs.
- `plan` performs no writes and is byte-deterministic for the same manifest/catalog.
- Interrupted or failed apply leaves either the old installation or the fully verified new
  installation—never a partial state.
- Every useful `pi-setup` capability has a documented keep, replace, or migrate destination.
- Curated and user-authored graphs validate, run, gate, abort, and resume.
- Herdr-backed nodes persist while non-Herdr workflows remain functional.
- Guarded and isolated postures cannot be bypassed by Arcwell's own subagents.
- No manifest, log, backup, diagnostic, or test output exposes a secret.

## Explicit non-goals for 1.0

- a hosted control plane;
- a general-purpose workflow scheduler;
- automatic approval of remote effects;
- a separate coordination database;
- mandatory Herdr, Claude, MCP, sandbox, telemetry, or community marketplace;
- dynamic unbounded graphs generated and executed without validation.
