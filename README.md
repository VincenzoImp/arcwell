# Arcwell

Arcwell is a reproducible, batteries-included environment for Pi. Version `0.1.0` is distributed
from its pinned GitHub source; the npm package is not published. Its commands are `setup`,
`doctor`, and `uninstall`.

It installs a working agreement, thirteen skills, four subagents, prompt chains and a set of
extensions, then composes the rest from exact package sources through Pi.

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

## What it installs

A working agreement that applies in every project, thirteen skills, four subagents, five
prompt templates, and eight extensions.

The skills describe a route — grill, research, plan, implement, review, fix — and `/autonomous`
runs it end to end, repeating review until it comes back clean, bounded at three rounds. The
route is a map, not rails: every skill opens with the condition under which it does not apply,
and `/quick` exists because most changes are small. Ceremony out of proportion to the work is
a defect of its own.

| | |
|---|---|
| **Working agreement** | Precedence, evidence, communication, code style, competence gate, discretion. Merged as one marked block into your `AGENTS.md`, never overwriting it. |
| **Skills** | `scope-check` `code-review` `debug` `web` `grilling` `research` `planning` `tdd` `implementing` `delegating` `verification` `domain-modeling` `handoff`. Only descriptions sit in context; the body loads on demand. |
| **Subagents** | `scout` `planner` `worker` `reviewer`, installed to `<agentDir>/agents` because Pi's package manifest has no `agents` key. The reviewer reads the diff, never a description of it. |
| **Prompts** | `/autonomous` `/quick` `/implement` `/implement-and-review` `/scout-and-plan` |
| **Memory** | A worklog per session that survives compaction: Pi summarises what was said, and cannot touch what was never said. `/lesson` records what is worth not repeating. |
| **Protections** | An effects guard that fails closed without a UI, and secret-path blocking. Both stay on by default. |
| **Postures** | `/preset research\|plan\|implement\|review\|fast\|max` withdraw `write`, `edit` and `bash` from the model's schema. |

## Defaults and selectable modules

The only stable profile is `core`; the default posture is `guarded`.

| Manifest switch | Default | Behavior |
|---|---:|---|
| `protections.effects` | On | Confirm recognized remote effects; fail closed without UI |
| `protections.secrets` | On | Block recognized protected paths/private-key material |
| `protections.redaction` | On | Select `@spences10/pi-redact@0.0.15` |
| `modules.lsp` | On | `@spences10/pi-lsp@0.0.46` — LSP diagnostics and navigation |
| `modules.context` | On | `@spences10/pi-context@0.1.16` — large-output sidecar |
| `modules.mcp` | On | `@spences10/pi-mcp@0.0.60` — lazy MCP; Arcwell configures no servers |
| `providerGuidance.claudeSubscription` | On | Guidance only; no package or auth operation |

A module is a switch over an external package, and only four packages remain: each owns a
capability Arcwell would otherwise have to implement — a whole LSP protocol, retrieval logic
for oversized output, an MCP client's server lifecycle, and a credential dictionary that ages
badly when self-written.

Everything else ships inside Arcwell and needs no switch: the todo overlay, structured
questions, read-only plan mode, the four subagents, six tool postures, tool discipline, and
the `web` skill. Disable one of those with `pi config`, not with the manifest. Installing the
packages they replace would register the same tool twice, and Pi then loads neither.

Every protection and module accepts `true` or `false`. `host` is valid only when all
protections are false. Disabled protections produce setup and doctor warnings. The `web` skill
and configured MCP servers use network access and configured credentials when invoked;
subagents invoke additional paid model calls when used.

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

## Explicitly excluded from stable v1

Arcwell does not provide coding-preference packages, nopeek, confirm-destructive, background
tasks, autonomous goal execution, dynamic workflow execution, web UI, Git checkpoints,
notifications, Herdr, OS-level isolation, candidate integration, workspace rollback,
Full/Custom profiles, a DAG/scheduler, custom session ledgers, databases, queues, release
automation, or CI created without an authorized repository. Optional packages may expose their
own behavior, but Arcwell does not add stronger integration semantics around it.

Autonomous goal execution is excluded deliberately rather than for lack of effort: the
`/autonomous` loop is instructions the model follows, not a turn-driving engine. A second
engine competing for control of the turn is what `@narumitw/pi-goal` would have added, and the
working agreement's rule decides it — machinery is for what must hold whether or not the model
cooperates, and the model is the thing running this loop.

## Guardrail limits

Arcwell's effects and secret-command scanning inspect recognizable command text and supported tool
results. They help catch mistakes, but are not a sandbox, complete shell enforcement, malware
protection, or an authorization system. Dynamic variables, substitutions, generated or encoded
commands, and previously written scripts can evade static matching. Third-party packages and
project processes retain host permissions. Enforcing a stronger boundary requires OS isolation;
Arcwell v1 intentionally excludes it.

Power is exposed through progressive disclosure rather than removed for simplicity.
[`docs/specification.md`](docs/specification.md) carries the full contract.

## Status

Implemented:

- strict TypeScript build with exact dependency pins;
- schema-versioned setup manifest, deterministic portable generation, and a dry run that
  reaches neither the network nor a model;
- the setup wizard, bounded lifecycle ownership, doctor, and ownership-safe uninstall with
  compensation on failure;
- exact package filtering and Git-source distribution checks;
- the working agreement, thirteen skills, four subagents, prompt chains, six tool postures,
  tool discipline, and the effects and secret-path protections;
- fake-client scratch coverage for setup, doctor, uninstall, and filesystem restoration.

npm publication, MCP server management, and release automation remain absent.
