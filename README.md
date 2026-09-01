# Arcwell

Arcwell is a reproducible, batteries-included environment for Pi. Version `0.1.0` is distributed
from its pinned GitHub source; the npm package is not published. Its stable commands are `setup`,
`doctor`, and `uninstall`. Legacy manifests and model-backed workflows remain under
`arcwell experimental` and are not part of the stable setup contract.

## Requirements and release status

- Node.js `>=24.15.0`.
- Pi `0.84.4` for the currently audited lifecycle and package APIs.
- No npm release exists. Installation uses the exact GitHub `v0.1.0` ref instead.
- A real-package Pi smoke passed on macOS. Linux and Windows smoke evidence remains pending; no
  cross-platform support claim follows until both checked-in CI jobs pass.

## Quick start and exact stable commands

When the installed npm version supports GitHub shorthands, the recommended no-npm-release setup is:

```bash
npx github:VincenzoImp/arcwell#v0.1.0 setup --dry-run --write-manifest arcwell.json
# Review arcwell.json and the dry-run output.
npx github:VincenzoImp/arcwell#v0.1.0 setup --manifest arcwell.json --yes
npx github:VincenzoImp/arcwell#v0.1.0 doctor
```

Arcwell is not published to the npm registry: `npx` obtains this exact GitHub ref and npm runs the
package's documented `prepare` build. To install only Arcwell's native Pi resources directly, use
Pi's exact Git source:

```bash
pi install git:github.com/VincenzoImp/arcwell@v0.1.0
```

The stable setup behavior is described below. Interactive setup is `arcwell setup`. A non-TTY mutation requires both `--manifest <file>` and
`--yes`. `--write-manifest <file>` writes the selected portable manifest and exits unless combined
with `--dry-run`; dry run never installs packages, changes Pi settings, invokes a model, or
accesses the network. On a TTY, dry run without `--manifest` collects wizard choices, skips the
apply confirmation, then renders and optionally writes that selected manifest. Non-TTY dry run
keeps deterministic defaults.

```text
arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]
arcwell doctor [--json]
arcwell uninstall [--yes]
```

Setup asks Pi to install `git:github.com/VincenzoImp/arcwell@v0.1.0`; selected third-party
packages remain exact npm sources. Pi-supported HTTPS, `git:https://`, SSH URL, and prefixed
`git:git@github.com:` spellings of that same repository and ref satisfy the selection semantically;
`www.github.com` normalizes to `github.com`. Raw SCP syntax such as
`git@github.com:VincenzoImp/arcwell@v0.1.0` has no Git meaning to Pi 0.84.4 without the `git:` prefix
and is treated as a local source. Setup does not
reinstall or claim ownership of a matching pre-existing source, while another ref for the same
repository fails preflight before mutation. It merges one marked block into
`$PI_CODING_AGENT_DIR/AGENTS.md`
and writes bounded non-secret state under
`$PI_CODING_AGENT_DIR/arcwell/`. When the documented environment variable is unset, Arcwell uses
Pi's `getAgentDir()` default. It does not edit Pi settings directly.

## Defaults and selectable modules

The only stable profile is `core`; the default posture is `guarded`.

| Manifest switch | Default | Behavior |
|---|---:|---|
| `protections.effects` | On | Confirm recognized remote effects; fail closed without UI |
| `protections.secrets` | On | Block recognized protected paths/private-key material |
| `protections.redaction` | On | Select `@spences10/pi-redact@0.0.15` |
| `modules.lsp` | On | LSP diagnostics |
| `modules.context` | On | Large-output context sidecar |
| `modules.todo` | On | Todo overlay |
| `modules.questionnaire` | On | Structured questions |
| `modules.planMode` | On | Read-only plan mode |
| `modules.mcp` | On | Lazy MCP package; Arcwell configures no servers |
| `modules.web` | Off | Network-capable web package |
| `modules.subagents` | Off | Child-agent/model package |
| `modules.autonomousWorkflows` | Off | Package-owned goal workflow |
| `providerGuidance.claudeSubscription` | On | Guidance only; no package or auth operation |

Every protection and module accepts `true` or `false`. `host` is valid only when all protections
are false. Disabled protections produce setup and doctor warnings. Web and configured MCP tools
may use network access and configured credentials. Subagents and autonomous workflows invoke
additional paid model calls when selected and used.

## Claude authentication and billing

Arcwell uses Pi's native `/login` and never reads or reports authentication state. In Pi, run
`/login` and deliberately choose the intended Anthropic/Claude authentication method. A Claude
subscription login and an Anthropic API key are different billing paths; using an API key or
another provider can incur separate API charges. Arcwell cannot determine the account, plan,
quota, or billing destination, so verify them in Pi/provider account settings before model use.
Setup, doctor, uninstall, package tests, and dry run do not need a model.

## Package security warning

Installing an npm package or Pi package executes code with the current user's permissions. Inspect
the exact source/artifact, `package.json`, `LICENSE`, `NOTICE`, native resources, and dependency tree
before installation. Arcwell transparently declares `prepare: npm run build` because npm runs
`prepare` for Git dependencies; it compiles the CLI and Pi extension into `dist` before use.
`typescript@6.0.3`, `@types/node@26.4.0`, and `ajv@8.20.0` are exact production dependencies because
that build compiles both source and tests during `npm install --omit=dev`; only
`typescript-language-server@6.0.0` remains development-only. The real-package smoke rejects install
lifecycle scripts only in downloaded third-party packages, not
Arcwell's disclosed build step. Pin versions and integrity in controlled environments. Setup
installs selected packages through Pi; those separately distributed packages retain their own code,
side effects, licenses, and notices. Setup health and doctor use Pi's documented installed path to
validate Arcwell's `package.json` name/version independently of source type, then require a regular
protection-extension file and loadable extension module. They do not register the extension during
that check.

## Recovery and uninstall

Setup preflights package identity and refuses an active, globally installed known catalog package
when its capability is deselected and Arcwell does not own it. Arcwell-owned deselected packages
are removed during reconfiguration. Setup atomically replaces its bounded files and compensates
files and newly installed packages if setup fails. It is not a general transaction system. Preserve the
error and `$PI_CODING_AGENT_DIR/arcwell/ownership.json`, correct the cause, and retry the exact manifest:

```bash
arcwell doctor --json
arcwell setup --manifest arcwell.json --yes
arcwell uninstall --yes
```

Uninstall removes only exact package sources recorded as installed by Arcwell, the marked working
agreement block, runtime config, ownership, and an empty Arcwell directory that setup created.
Because Pi removal matches a Git repository identity rather than a ref spelling, uninstall refuses
a changed or additional equivalent user source unless the inventory proves the one exact owned
settings source and exactly one user-scope entry for that identity. Duplicate entries are refused
even when their source strings are identical; uninstall never intentionally performs identity-wide
cleanup of user-owned sources. It does not remove Pi, credentials, sessions, trust state, pre-existing packages, unrelated
`AGENTS.md` bytes, or non-Arcwell files. Modified managed content and partial cleanup fail with
recoverable ownership preserved where possible. A missing managed agreement file/block is treated
as modification and preserves recovery state. TTY uninstall asks for confirmation; `--yes` skips
it and remains required for non-TTY uninstall. There is no stable rollback command.

## Local release-readiness checks

The ordinary non-network checks use repository-local scratch/cache paths, fake Pi clients, no
credentials, no models, no real Pi settings, and no publication:

```bash
npm test
npm pack --dry-run --json --cache .npm-cache
```

The separate prepare smoke may fetch npm dependencies into an empty isolated cache, but it does not
fetch an Arcwell Git source:

```bash
npm run test:prepare
```

The prepare smoke copies the working tree without `.git`, `dist`, or `node_modules`, gives npm an
isolated home and empty cache, runs `npm install --omit=dev`, asserts the `prepare`-generated `dist`,
CLI bin, and extension, then loads the native resources with `DefaultResourceLoader`. It proves the
clean-copy prepare path, not Git transport. Tests also pack and extract to a stable `.tmp-tests`
directory and exercise setup twice, doctor, uninstall, and exact filesystem restoration.

Run networked smokes explicitly:

```bash
npm run test:packages
npm run test:git-source -- main
npm run test:git-source -- v0.1.0
```

The Git-source smoke uses repository-local Pi 0.84.4 in an isolated scratch agent directory with an
allowlist-only environment, empty npm/Git configuration, non-interactive Git, and no inherited
checkout token. It asks Pi to install `git:github.com/VincenzoImp/arcwell@<ref>`, reloads resources,
checks the installed path, package name/version, and default extension, then deletes the scratch
state. Use `main` only as a live transport smoke after the tested commit has been pushed to main;
CI therefore runs it only for pushes to `main`, never pull requests. Use the release tag (for
example `v0.1.0`) after that tag is pushed as the tag-release smoke. A main result does not prove a
tag, and the clean-copy prepare smoke proves neither transport case. The real-package Pi smoke has
passed on macOS; Linux and Windows remain open release gates.

## Current Experimental commands

```bash
npm test
node dist/src/cli.js experimental plan --manifest test/fixtures/full.json
node dist/src/cli.js experimental plan --manifest test/fixtures/full.json --json
node dist/src/cli.js experimental explain --manifest test/fixtures/full.json --json
node dist/src/cli.js experimental schema
node dist/src/cli.js experimental capabilities
node dist/src/cli.js experimental workflows
node dist/src/cli.js experimental workflow explain feature --json
node dist/src/cli.js experimental workflow validate --file test/fixtures/workflow.json --json
node dist/src/cli.js experimental workflow schema
node dist/src/cli.js experimental run plan --goal "Propose the next project vertical" --cwd . --json
node dist/src/cli.js experimental run feature --goal "Prepare an approved feature plan" --cwd . --persist --json
# Resume with the emitted ledger.sessionId, checkpointEntryId, and checkpointDigest:
node dist/src/cli.js experimental run feature resume --session <id> --checkpoint <entry> \
  --checkpoint-digest <sha256> --approve-plan --cwd . --json
# Run one root task with the emitted approval ID:
node dist/src/cli.js experimental run feature worker --session <id> --checkpoint <entry> \
  --checkpoint-digest <sha256> --approval <sha256> --task <task-id> --cwd . --json
ARCWELL_REAL_MODEL_TEST=1 npm run test:model  # opt-in credential-consuming smoke test
```

The commands under `experimental` use separate legacy Experimental manifest and workflow
schemas. Those schemas are not stable v1 setup input and are not a second canonical setup format.
Experimental `plan` reports selected intelligence packs, workflows, posture, execution backend,
approvals, and operations; Experimental `explain` adds ownership, provenance, lazy activation,
and guardrails. Both are deterministic and do not modify the target environment.

`run plan` creates two isolated in-memory Pi sessions. `run feature` uses the same safe agents,
turns planner steps into an explicit dependency DAG, emits a graph-bound portable checkpoint,
and stops at `approve-plan`. With `--persist`, the checkpoint and a relevant-file snapshot are
stored as Pi custom session entries. Resume requires the emitted session, entry, digest, and
explicit `--approve-plan`; it records a deterministic logical approval and stops at a read-only
isolated-worker dispatch preview. `run feature worker` can then execute exactly one dependency-free
task in an Arcwell-owned workspace. The Pi worker has read/list plus an atomic write tool restricted
to declared task files—no shell or deletion—and records only a bounded changeset. It never modifies
or integrates into the selected project. The scout and planner can only read
and list inside the selected project; project extensions, skills, prompts, context files,
and likely secret files are blocked. They communicate through validated structured artifacts.
The command clones Pi credentials into an ephemeral in-memory store through Pi's read-only
auth loader, keeps model catalogs and settings in memory, and never writes or prints credential
values. Reads reject paths outside the project, common credential stores, unstable files, and
content matching common secret signatures before it reaches the model. This is defense in depth,
not a substitute for keeping secrets out of repositories. Progress goes to stderr and `--json`
emits one result document on stdout.

## Explicitly excluded from stable v1

Stable v1 does not provide coding-preference packages, nopeek, confirm-destructive, background
tasks, dynamic workflow execution, web UI, Git checkpoints, notifications, Herdr, OS-level
isolation, candidate integration, workspace rollback, Arcwell presets, Full/Custom profiles, an
Arcwell DAG/scheduler, custom session ledgers, databases, queues, release automation, or CI created
without an authorized repository. Optional packages may expose their own behavior, but Arcwell
does not add stronger integration semantics around it.

## Experimental legacy direction

The legacy Experimental design proposed:

- a concise working agreement;
- skill packs, agents, and prompt composition;
- declarative workflow graphs;
- subagent and optional persistent Herdr backends;
- lazy Claude Code and MCP integrations;
- host, guarded, and isolated execution postures;
- transactional apply, rollback, uninstall, migration, and doctor commands.

Experimental `workflow explain feature` statically validates its bounded project workflow and shows
its deterministic execution waves: scout, planner, approval, up to six isolated workers,
integration, review, verification, and final acceptance. `workflow validate` applies the same
strict contract to a user JSON graph, while `workflow schema` supports editors and CI. Neither
command executes write nodes.

## Guardrail limits

Arcwell's effects and secret-command scanning inspect recognizable command text and supported tool
results. They help catch mistakes, but are not a sandbox, complete shell enforcement, malware
protection, or an authorization system. Dynamic variables, substitutions, generated or encoded
commands, and previously written scripts can evade static matching. Third-party packages and
project processes retain host permissions. Enforcing a stronger boundary requires OS isolation;
Arcwell v1 intentionally excludes it.

Power is exposed through progressive disclosure rather than removed for simplicity.
[`docs/specification.md`](docs/specification.md) starts with the stable contract and retains a
clearly marked legacy appendix; [`docs/implementation-plan.md`](docs/implementation-plan.md)
describes the Experimental legacy path.

## Status

Implemented locally:

- strict TypeScript build;
- exact runtime and development dependency pins;
- schema-versioned Experimental manifest validation;
- deterministic portable Experimental Core/guarded and Full manifest generation;
- deterministic portable Experimental planning;
- Experimental JSON Schema and effective configuration explanation;
- capability ownership, provenance, platform, approval, and activation metadata;
- human and JSON CLI output;
- bounded read-only project scout/planner with abort and failure isolation;
- strict multi-agent graph contracts with deterministic concurrency waves and user gates;
- curated feature workflow with bounded six-worker fan-out and isolated write workspaces;
- real read-only feature preparation stopped at a graph-bound user approval checkpoint;
- Pi-native checkpoint persistence, content/project binding, approval resume, and worker dispatch preview;
- one isolated Pi worker for an approved root task, with bounded writes and no project integration;
- no-write, path-boundary, secret-file, and structured-artifact regression tests.

The stable implementation also includes the setup wizard, bounded lifecycle ownership, doctor,
ownership-safe uninstall, compensation, exact package filtering, Git-source distribution checks,
and fake-client scratch coverage. npm publication, generic Experimental DAG execution, Herdr
execution, a Claude adapter, MCP server management, and release automation remain absent.
