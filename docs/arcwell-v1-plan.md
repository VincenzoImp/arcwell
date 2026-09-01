# Arcwell v1 Core Implementation Plan

> This plan is for review before implementation. No Git initialization, commit, push, package publication, or remote operation is authorized.

## Goal

Deliver a native Pi Core package that installs through one small wizard, defaults to guarded behavior, permits every Arcwell protection to be explicitly disabled, verifies itself, and removes only what it owns.

## Product Boundary

Public commands:

```text
arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]
arcwell doctor [--json]
arcwell uninstall [--yes]
```

`setup --dry-run` replaces separate public `init` and `plan` commands. The stable v1 setup manifest is canonical for setup only. Existing manifests and model-backed workflows are legacy Experimental formats available only under `arcwell experimental`; they are not accepted as setup input and do not define v1 completion.

The `0.1.0` release installation uses the exact source `git:github.com/VincenzoImp/arcwell@v0.1.0`; the npm package is not published. The clean-copy development smoke proves the npm `prepare` build without fetching GitHub and is not Git transport evidence. The separate explicit Git-source smoke uses `main` only after a main push for transport evidence and uses a pushed version tag for release-tag evidence.

## Architecture

Arcwell is primarily a Pi package:

```text
arcwell/
├── extensions/          # only capabilities missing from Pi/packages
├── skills/              # native Pi skills
├── prompts/             # native Pi prompt templates
├── content/AGENTS.md    # Arcwell-owned global instruction block
├── src/setup/           # small wizard/lifecycle CLI
└── package.json         # documented `pi` manifest
```

Pi owns package discovery, loading, updates, scope, sessions, provider authentication, and UI primitives. Arcwell owns only profile composition, explicit protection configuration, its marked `AGENTS.md` block, doctor output, and ownership needed for uninstall.

## Stable v1 Setup Defaults and Manifest

```json
{
  "schemaVersion": 1,
  "arcwellVersion": "0.1.0",
  "profile": "core",
  "posture": "guarded",
  "protections": {
    "effects": true,
    "secrets": true,
    "redaction": true
  },
  "providerGuidance": {
    "claudeSubscription": true
  },
  "modules": {
    "lsp": true,
    "context": true,
    "todo": true,
    "questionnaire": true,
    "planMode": true,
    "mcp": true,
    "web": false,
    "subagents": false,
    "autonomousWorkflows": false
  }
}
```

Rules:

- `core` is the only v1 profile.
- `guarded` is the default.
- Every protection may independently be `false`.
- `host` is valid only when all protections are `false`; contradictory manifests are rejected.
- Every disabled protection produces a plan and doctor warning.
- `arcwellVersion` binds the manifest to an exact bundled catalog; a different binary version refuses it unless the user regenerates the manifest.
- Claude uses Pi’s native `/login`; it creates no package operation and Arcwell never inspects auth state.
- Core defaults enable low-friction development modules: LSP, context, todo, questionnaire, plan mode, and lazy MCP.
- The approved opt-in modules are web, subagents, and autonomous workflows.
- Coding preferences, background tasks, dynamic workflows, web UI, Git checkpoint, and notifications are explicitly excluded from v1.
- Enabling a module selects exactly one audited implementation; Arcwell never installs overlapping providers for the same capability.
- Modules remain dormant until invoked or configured when their package supports lazy activation.
- Portable manifests contain no machine path or secret.

## Protection Activation

Arcwell writes a bounded non-secret runtime file at the logical destination `$PI_CODING_AGENT_DIR/arcwell/config.json`:

```json
{
  "schemaVersion": 1,
  "posture": "guarded",
  "protections": {
    "effects": true,
    "secrets": true,
    "redaction": true
  }
}
```

- Arcwell’s own extension reads this file at startup and becomes a no-op when its protection is false.
- External protection packages are installed only when selected and removed on reconfiguration only if Arcwell owns their installation.
- Doctor verifies effective extension/package/config agreement, not only manifest intent.
- Project files cannot override this global configuration.

## Required Behavioral Matrix

| Protection | Enabled behavior | Disabled behavior | No interactive UI |
|---|---|---|---|
| Effects | Recognized push, deploy, publish, release, PR/merge, and equivalent remote effects require explicit approval | Arcwell does not intervene | Fail closed for a recognized effect |
| Secrets | Protected credential paths and private-key material cannot be read into model context | Arcwell does not add path blocking | Fail closed on matched protected paths/material |
| Redaction | Supported tool/session output surfaces redact recognized credentials | Arcwell does not add redaction | Same deterministic redaction |

Effects and secret-command scanning are guardrails over command text, not a sandbox or complete shell enforcement. Static matching cannot reliably interpret commands assembled through dynamic variables, substitutions, generated code, or previously written scripts. Enforcing those cases requires OS isolation, which Arcwell v1 excludes. Tests must invoke the loaded Pi hook/package behavior, not only inspect configuration.

## Capability Tiers

### Core defaults

- LSP and diagnostics;
- large-output context sidecar;
- todo overlay;
- structured questionnaire;
- read-only plan mode;
- lazy MCP adapter;
- native Claude `/login` guidance;
- effects, secret, and redaction protections.

### Available opt-in modules

- web search/fetch;
- subagents and bounded parallel delegation;
- autonomous goal/workflow package.

### Still excluded from v1

Arcwell intentionally excludes coding-preferences packages, nopeek, confirm-destructive, background tasks, dynamic workflows, web UI, Git checkpoint, notifications, Herdr, OS-level isolated posture, candidate integration, workspace rollback, Arcwell-specific presets, Full/Custom profiles, Arcwell-written DAG/scheduler, custom session ledgers, databases, queues, and release automation. These are outside the product rather than deferred v1 commitments. An optional package may expose its own workflow features, but Arcwell will not add integration or stronger semantics around them.

## Task 0: Requirements and Reuse Gate

**Files:** Create `docs/pi-setup-mapping.md`, `docs/dependencies.md`, `test/setup-catalog.test.ts`; create `src/setup/catalog.ts` only after the audit.

1. Convert `pi-setup` behavior into a table: behavior, user value, native Pi primitive, candidate package, v1 decision, regression scenario. Do not copy its architecture.
2. Audit Pi 0.84.4 public APIs and current upstream versions of candidate packages.
3. Evaluate the redaction owner and the Arcwell-local effects and protected-path boundaries; explicitly reject overlapping nopeek and confirm-destructive packages.
4. Use only the approved exact owners for packaged capabilities: `@spences10/pi-lsp@0.0.46`; `@spences10/pi-context@0.1.16`; `@juicesharp/rpiv-todo@2.8.0`; `@juicesharp/rpiv-ask-user-question@2.8.0`; `@narumitw/pi-plan-mode@0.56.0`; `@spences10/pi-mcp@0.0.60`; `pi-web-access@0.27.0`; `pi-subagents@0.61.0`; `@narumitw/pi-goal@0.54.4`; `@spences10/pi-redact@0.0.15`.
5. Record coding preferences, background tasks, dynamic workflows, web UI, Git checkpoint, and notifications as rejected rather than selectable modules.
6. For every candidate verify license, maintenance, Pi compatibility, protected surfaces, side effects, configuration, Windows support, disable/uninstall behavior, package identity, and overlap with other selected modules.
7. Assign exactly one owner per capability and add catalog tests rejecting unversioned sources, duplicate ownership, and conflicting packages.
8. **User gate:** if any selected capability requires substantial custom code or an existing package is not sufficiently aligned, stop and present value, limitations, alternatives, and estimated code before implementation.

**Exit:** A signed-off behavior matrix and exact Core package list. No protection implementation starts before this gate.

## Task 1: First Runnable Native Package

**Files:** Modify `package.json`, `README.md`, `src/cli.ts`; create selected `extensions/`, `skills/`, `prompts/`, `content/AGENTS.md`; create `test/package-resources.test.ts`.

1. First add a failing `DefaultResourceLoader` test for the exact intended resource set.
2. Add `keywords: ["pi-package"]` and explicit `pi.extensions`, `pi.skills`, and `pi.prompts` paths.
3. Port only approved Core content from the personal setup, in English and without machine assumptions.
4. Implement custom extension code only when Task 0 explicitly approved it; use public Pi hooks and factories.
5. Move stable public help to `setup`, `doctor`, and `uninstall`; put old workflow commands under `experimental` without deleting them.
6. Verify `pi -e <stable-package-directory>` loads the exact resources without modifying Pi settings or invoking a model.

7. Add package-filter smoke tests proving every optional module can be omitted and every default module can be disabled without loading its resources.

**Runnable result:** `pi -e <arcwell-package>` exposes Arcwell Core resources for one temporary session; the catalog can compose all audited optional modules without Arcwell reimplementing them.

## Task 2: Manifest, Effective Config, and Dry Run

**Files:** Create `src/setup/types.ts`, `src/setup/manifest.ts`, `src/setup/config.ts`, `src/setup/plan.ts`, `src/setup/cli.ts`; adapt legacy `src/manifest.ts`, `src/planner.ts`, `src/schema.ts`; create `test/setup-manifest.test.ts`, `test/setup-plan.test.ts`, `test/setup-config.test.ts`.

1. Write failing tests for the exact manifest above, unknown fields, wrong Arcwell version, contradictory host settings, individual disabled protections, every supported module toggle, mutually exclusive providers, machine paths, and duplicate JSON properties where applicable.
2. Implement strict parsing and canonical digest generation.
3. Produce deterministic operations containing exact package sources and logical destinations such as `$PI_CODING_AGENT_DIR/AGENTS.md`; portable JSON never contains the expanded home path.
4. Produce one warning per disabled protection and an accurate Claude `/login` note.
5. Define strict 16 KiB runtime config parsing and atomic replacement; reject symlink targets and preserve prior mode.
6. Implement `setup --dry-run` and `--write-manifest` before mutation exists.

**Runnable result:** `arcwell setup --dry-run` interactively shows the exact package/config/agreement effects and warnings but changes nothing.

## Task 3: Minimal Persistent Setup Vertical

**Files:** Create `src/setup/pi-client.ts`, `src/setup/working-agreement.ts`, `src/setup/ownership.ts`, `src/setup/apply.ts`; create corresponding focused tests and `test/setup-scratch.test.ts`.

Minimal interfaces:

```ts
interface PiClient {
  version(signal?: AbortSignal): Promise<string>;
  list(signal?: AbortSignal): Promise<PiPackage[]>;
  install(source: string, signal?: AbortSignal): Promise<void>;
  remove(source: string, signal?: AbortSignal): Promise<void>;
}

interface ArcwellOwnership {
  schemaVersion: 1;
  arcwellVersion: string;
  manifestDigest: string;
  installedPackageSources: string[];
  workingAgreementDigest: string;
}
```

1. Use argument arrays, never shell command strings; bound and sanitize process output; propagate abort.
2. Preflight package identity using Pi’s documented rules. If the same npm package/repository already exists with a different source/version, fail before mutation rather than replacing it.
3. Install exact `git:github.com/VincenzoImp/arcwell@v0.1.0` plus accepted exact npm protection packages.
4. Merge a uniquely marked Arcwell block into `$PI_CODING_AGENT_DIR/AGENTS.md`; preserve unrelated content and file mode; reject malformed markers and symlinks.
5. Write runtime config and ownership atomically. Ownership contains no credentials, environment values, session data, project path, or command output.
6. On setup failure, restore prior Arcwell-owned files and remove only packages newly installed by this invocation. No general transaction journal, leases, fencing, or database.
7. Run an immediate minimal health check.
8. Prove idempotent second setup in a scratch agent directory.

**Runnable result:** `arcwell setup --manifest arcwell.json --yes` persistently installs a guarded Core package in a scratch Pi environment.

**Discussion gate:** if this task exceeds a small compensating sequence and needs a transaction framework, stop and simplify.

## Task 4: Behavioral Protection Tests

**Files:** Create `test/effects-protection.test.ts`, `test/secrets-protection.test.ts`, `test/redaction-protection.test.ts`; modify only the approved package adapters/extensions.

For each protection:

1. Observe a failing test against the real loaded Pi hook/package.
2. Test enabled behavior from the matrix.
3. Test disabled behavior from runtime config.
4. Test `host` behavior.
5. Test no-UI/headless behavior.
6. Test that project configuration cannot weaken global selection.
7. Test false-positive boundaries and document residual limitations.

**Runnable result:** changing each wizard toggle changes observable Pi behavior, not just files or doctor output.

## Task 5: Doctor and Ownership-Safe Uninstall

**Files:** Create `src/setup/doctor.ts`, `src/setup/uninstall.ts`, `test/setup-doctor.test.ts`, `test/setup-uninstall.test.ts`.

Doctor checks only Pi version, exact package identities, native resource discovery, runtime config, protection effectiveness, agreement digest, and ownership consistency. It does not inspect credentials; Claude guidance says to use `/login` if desired.

Uninstall:

1. removes only packages listed as newly installed by Arcwell;
2. removes only the marked agreement block;
3. removes Arcwell config/ownership only after successful verification;
4. never removes Pi, sessions, credentials, trust state, or pre-existing packages;
5. preserves recoverable state and reports exact cleanup failure on partial errors.

Tests cover clean install, warning-only disabled protection, missing package, modified agreement, version conflict, pre-existing package, partial failure, abort, and setup→doctor→uninstall restoration.

**Runnable result:** `arcwell doctor` explains effective posture; `arcwell uninstall --yes` restores the pre-Arcwell scratch state.

## Task 6: Interactive Wizard

**Files:** Create `src/setup/wizard.ts`, `test/setup-wizard.test.ts`, `test/setup-cli.test.ts`; connect `src/setup/cli.ts` to apply.

Questions:

1. Guarded (recommended) or Host.
2. If Guarded: effects on/off, secrets on/off, redaction on/off.
3. Confirm the Core module set: LSP, context, todo, questionnaire, plan mode, and MCP.
4. Optionally open Advanced and select web, subagents, and autonomous workflows.
5. Show exact sources, logical destinations, effects, network/listener/process implications, and warnings.
6. Confirm.

The default path accepts Core with one confirmation; Advanced is progressive disclosure. Defaults enable all protections and Core modules. Input/output is injectable. EOF and SIGINT cancel before the next side effect. Non-TTY mutation requires `--manifest --yes`.

**Runnable result:** `arcwell setup` completes the same path as headless setup with minimal questions and progressive disclosure.

## Task 7: Real Platform and Package Verification

**Files:** Update tests/scripts and documentation; create CI configuration only after repository initialization is separately authorized.

1. Run ordinary unit and scratch tests without credentials, models, network, or real Pi setting mutation.
2. Run `npm pack --dry-run --json` and reject unintended files, home paths, private-key markers, temp artifacts, and unpinned sources.
3. Test the packed artifact and a stable extracted local package.
4. Run real smoke jobs on macOS, Linux, and Windows before claiming support; injected platform adapters alone are insufficient.
5. Verify setup, idempotent setup, doctor, each protection toggle, uninstall, and final filesystem comparison.
6. Document install, dry run, headless use, toggles, Claude `/login` billing caveat, recovery, uninstall, package security warning, and deferred capabilities.

**Runnable result:** a publish-ready tarball has fresh evidence on all three supported operating systems. Push, npm publication, and release still require separate authorization.

## Review and Complexity Gates

Review after Tasks 0, 3, 4, and 7. At every gate:

- report test evidence and source/test line delta;
- identify code duplicating Pi or accepted packages;
- remove findings that have no reproducible failure;
- stop for discussion before any custom security classifier, cross-platform helper runtime, state machine, scheduler, sandbox, or capability expected to exceed roughly 200–300 net source lines.

## Definition of Done

Arcwell v1 is done when a packed exact version supports `setup`, `doctor`, and `uninstall`; default setup is Core/guarded with the audited Core module set; every protection and module can be disabled; every listed opt-in capability can be selected without overlapping providers; behavioral tests prove effective loading and protection behavior; package installation is Pi-native; Claude delegates to `/login`; doctor reports effective state without reading credentials; uninstall removes only Arcwell ownership; and fresh real macOS/Linux/Windows smoke results support the compatibility claim.
