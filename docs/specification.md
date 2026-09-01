# Arcwell Product Specification

## Stable v1 contract

Arcwell `0.5.1` requires Node.js `>=24.15.0` and targets the locally audited Pi `0.84.4` API.
The package is currently unpublished. Its exact stable surface is:

```text
arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]
arcwell doctor [--json]
arcwell uninstall [--yes]
```

The npm package is not published. With an npm version that supports GitHub shorthands, bootstrap
the exact release with `npx github:VincenzoImp/arcwell#v0.5.1 setup`; Pi resources use
`pi install git:github.com/VincenzoImp/arcwell@v0.5.1`. Generate and inspect input with `setup
--dry-run --write-manifest arcwell.json`, then apply headlessly with `setup --manifest arcwell.json
--yes` through the same exact `npx` source. Non-TTY mutation requires both manifest and
confirmation flags. Dry run and manifest output perform no install, Pi settings mutation, model
call, or network access. A TTY dry run without a manifest collects wizard choices without an apply
confirmation before rendering/writing the selected manifest; non-TTY dry run uses deterministic
defaults.

The only profile is `core`. The default posture is `guarded`. Effects, secrets, and redaction
protections default on and can each be disabled. `host` requires all three to be false. The
modules are LSP, context sidecar, and lazy MCP, all on by default and independently boolean;
each is a switch over one external package that owns a capability Arcwell does not implement.
Capabilities Arcwell ships itself — the todo overlay, structured questions, plan mode, the four
subagents, the tool postures, tool discipline, and the web skill — are not manifest switches
and are disabled through `pi config`. Wizard output warns that the web skill and configured MCP
servers use network access and configured credentials when invoked, and that subagents invoke
additional paid model calls when used.
`providerGuidance.claudeSubscription` defaults on but creates no package/auth operation.

Setup also installs whole managed files into the agent directory: the four subagent
definitions under `agents/`, because Pi's package manifest has no `agents` key and the subagent
extension reads them from there, and `presets.json`. Each is recorded with the digest of what
was written and whether the path existed first. Uninstall removes only files that still match
byte-for-byte and that setup created; a modified or pre-existing file is kept and reported.

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

