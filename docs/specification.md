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

Arcwell explicitly excludes coding preferences, nopeek, confirm-destructive, background tasks,
dynamic workflow execution, web UI, Git checkpoints, notifications, Herdr, OS isolation, candidate
integration, workspace rollback, Full/Custom profiles, a DAG/scheduler, custom session ledgers,
databases, queues, release automation, and unauthorized CI creation.

Local tests use fake Pi clients and repository-local scratch directories. A real-package Pi smoke
passed on macOS; Linux and Windows evidence remains pending and release-gated. No cross-platform
support claim follows from injected adapters or the macOS result alone.

