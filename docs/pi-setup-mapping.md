# Pi Setup Mapping and Reuse Verdict

## Scope and evidence

This mapping began as the Task 0 reuse gate and now records the local Task 7 package/lifecycle
result for Arcwell 0.1.0. Node.js `>=24.15.0` is required. The exact stable commands are
`arcwell setup [--manifest <file>] [--yes] [--dry-run] [--write-manifest <file>]`,
`arcwell doctor [--json]`, and `arcwell uninstall [--yes]`. Dry run produces an exact portable plan
without network access, installation, Pi settings changes, or model calls. On a TTY, dry run
without a manifest collects wizard choices without apply confirmation; non-TTY dry run keeps
stable defaults. Non-TTY setup mutation requires `--manifest <file> --yes`.

The audit used the locally pinned Pi 0.84.4 public package, extension, skill, prompt-template,
`DefaultResourceLoader`, settings, and package-filter APIs. The implementation uses native Pi
resource discovery and only public extension hooks. Setup delegates exact package install/remove to
Pi, merges one marked working-agreement block, and stores bounded ownership/config; it does not copy
the previous `pi-setup` architecture or edit Pi settings directly.

## Behavior mapping

| Behavior | User value | Native Pi primitive | Candidate owner | v1 decision | Regression scenario |
|---|---|---|---|---|---|
| One package exposes instructions, skills, prompts, and protections | One coherent entry point | `package.json#pi`, package discovery | Arcwell package | Keep | `DefaultResourceLoader` misses or leaks a project resource |
| Language diagnostics | Fast code feedback | Pi extension package | `@spences10/pi-lsp@0.0.46` | Accept as sole owner | Disabled LSP still appears in the package plan |
| Large-output context sidecar | Keeps oversized output usable | Pi extension package | `@spences10/pi-context@0.1.16` | Accept as sole owner | Context is duplicated by another owner |
| Session todo overlay | Visible bounded work tracking | Pi extension package | `@juicesharp/rpiv-todo@2.8.0` | Accept as sole owner | Todo package remains selected when false |
| Structured questions | Explicit user choices | Pi extension/UI package | `@juicesharp/rpiv-ask-user-question@2.8.0` | Accept as sole owner | Questionnaire package is omitted by the default |
| Read-only planning mode | Separates planning from mutation | Pi extension/tool controls | `@narumitw/pi-plan-mode@0.56.0` | Accept as sole owner | A second plan-mode provider is selected |
| Lazy MCP access | Integrations stay dormant until used | Pi extension/tool loading | `@spences10/pi-mcp@0.0.60` | Accept as sole owner | MCP is eagerly duplicated by an adapter |
| Web access | Optional current-information lookup | Filterable Pi package | `pi-web-access@0.27.0` | Accept, default off | Default dry run selects a networked package |
| Subagents | Optional bounded delegation | Filterable Pi package | `pi-subagents@0.61.0` | Accept, default off | Default dry run selects child-agent execution |
| Autonomous workflows | Optional package-owned goal flow | Filterable Pi package | `@narumitw/pi-goal@0.54.4` | Accept, default off | A second workflow provider overlaps it |
| Effects approval | Prevent accidental remote effects | Public `tool_call` block/confirm hook and `ctx.hasUI` | Arcwell thin extension | Accept minimal implementation | Headless recognized effect executes without approval |
| Protected secret paths/private keys | Keep protected material out of model context | Public `tool_call` block and `tool_result` replacement hooks | Arcwell thin extension | Accept minimal implementation | `.env` read or private-key marker reaches model context |
| Credential redaction | Deterministic redaction on supported surfaces | Pi extension package | `@spences10/pi-redact@0.0.15` | Accept as sole owner | Arcwell adds a competing credential classifier |
| Claude subscription guidance | Reuse native authentication | Pi `/login` | Pi | Keep native; guidance only | Arcwell reads auth state or creates package operations |
| Portable manifest and deterministic plan | Review exact effects before mutation | Arcwell lifecycle CLI over Pi package sources | Arcwell setup layer | Keep small | Output contains a home directory or unpinned source |
| Disable resources | Every capability can be omitted | Pi package filtering/composition | Pi + Arcwell manifest | Keep | A false module still loads/selects its owner |
| Setup and idempotent retry | Reproducible local composition | Pi exact package install plus bounded Arcwell files | Arcwell lifecycle + Pi | Keep | Second setup changes packages or bytes |
| Health diagnosis | Explain effective local state without credentials | Pi version/list installed path and native resource/config checks | Arcwell doctor | Keep | Missing/filtered/invalid Arcwell package is reported healthy |
| Ownership-safe uninstall | Restore pre-Arcwell state | Pi exact remove plus marked-block removal | Arcwell lifecycle + Pi | Keep | Pre-existing package/file is removed or created directory remains |
| Packed stable resource loading | Avoid ephemeral `npx` paths and source-tree assumptions | npm tarball + `DefaultResourceLoader` | npm + Pi | Keep | Extracted package misses compiled extension/skills/prompts |
| Old workflows | Preserve existing experiments without defining v1 | CLI namespace | Arcwell `experimental` | Keep, non-public v1 | `arcwell init` remains a stable top-level command |

## Protection boundary

- Effects and protected-secret handling are independently controlled by the global bounded file `$PI_CODING_AGENT_DIR/arcwell/config.json`.
- In headless modes, a recognized effect fails closed. Interactive execution requires an affirmative Pi confirmation.
- Secret path protection covers built-in path-bearing read/search calls for `.env*`, `.envrc`, `.ssh`, common credential files, `*.tfvars`, and common private-key paths. Exact private-key PEM markers in tool results are replaced before model context.
- Credential-pattern redaction is not implemented by Arcwell. `@spences10/pi-redact@0.0.15` owns that classifier and is selected only when redaction is enabled.
- Project configuration is not read by the Arcwell protection extension and therefore cannot weaken global selection.
- Effects and secret-command scanning inspect recognizable command text and supported tool results only. They are mistake-catching guardrails, not a sandbox, complete shell enforcement, malware defense, or full authorization boundary; dynamic variables, substitutions, encoded/generated commands, existing scripts, and dependency code require OS isolation, which Arcwell excludes.
- Claude authentication remains Pi-native through `/login`. Subscription login and API-key use are distinct billing paths; API keys or other providers may create separate charges. Arcwell reads no auth or billing state.
- Wizard output warns that web and MCP may use network access/configured credentials and that subagents and autonomous workflows invoke additional paid model calls when selected and used.

## Rejected scope

Coding preferences, nopeek, and confirm-destructive are rejected because they overlap Arcwell's
working agreement or approved policy boundary. Also excluded are background tasks, dynamic workflow
execution, web UI, Git checkpoints, notifications, Herdr, OS isolation, candidate integration,
workspace rollback, Arcwell presets, Full/Custom profiles, an Arcwell DAG/scheduler, custom session
ledgers, databases, queues, release automation, and CI without an authorized repository. No
replacement scheduler, state machine, sandbox, UI server, checkpoint runtime, or notification
adapter will be built for stable v1.

## Package, recovery, and release gate

After separately authorized publication, exact bootstrap is
`npm install --global arcwell@0.1.0`; avoid `latest` and ephemeral `npx`. Npm/Pi packages run code
with user permissions, so inspect and pin tarball integrity, `package.json`, dependencies, native
resources, `LICENSE`, and `NOTICE`. Local audit is
`npm pack --dry-run --json --cache .npm-cache`. The whitelist includes compiled CLI/extension,
content, exact native skills/prompts, docs, license, and notice; it excludes tests, temp/cache/home
paths, and source artifacts.

For recovery, preserve `$PI_CODING_AGENT_DIR/arcwell/ownership.json`, run `arcwell doctor --json`, correct
the reported cause, then retry `arcwell setup --manifest arcwell.json --yes` or run
`arcwell uninstall --yes`. Setup and doctor validate Arcwell's installed package metadata and
protection extension. Setup refuses active unowned known packages for deselected capabilities;
doctor reports them as unhealthy. Uninstall does not remove credentials, sessions, trust, Pi,
pre-existing packages, or unrelated files. Missing managed agreement content preserves recovery
state. TTY uninstall confirms unless `--yes` is supplied. Stable v1 has no rollback command.

**Approved locally, not platform-certified.** Pi owns discovery, filtering, package identity, UI,
sessions, authentication, and package operations. Arcwell adds content, exact composition, strict
portable configuration, deterministic dry run, bounded lifecycle ownership, and two small
protections. Fake-client scratch tests cover setup twice, doctor, uninstall, and exact filesystem
restoration. Packed resources are tested from a stable extracted directory without real Pi state or
models. A real-package Pi smoke passed on macOS; Linux and Windows validation remains pending and
release-gated. Publication and CI execution remain separately authorized.
