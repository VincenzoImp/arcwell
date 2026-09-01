# Dependency Audit Verdict

## Audit constraints

This records the approved Task 0 catalog for Arcwell 0.1.0 and Pi 0.84.4. Local verification covers Pi's public package/resource/filter/hook APIs and catalog invariants. Exact npm registry metadata was fetched for every accepted pin: all ten report MIT licenses, Pi resource manifests, repository provenance, integrity digests, and no direct `preinstall`, `install`, or `postinstall` script. The `@spences10/*` packages require Node `>=24.15.0`, which is therefore Arcwell's minimum.

A fresh real-package smoke passed on macOS with Node 26.4.0 and npm 11.17.0. It invoked the repository-local Pi 0.84.4 CLI, installed Arcwell's local path and all ten exact accepted sources into an isolated repository-local scratch environment, reloaded them with `SettingsManager` and `DefaultResourceLoader`, and found 11 extensions, 4 skills, and 9 prompts without extension or resource diagnostics. It recursively inspected the local Arcwell manifest and 158 installed dependency/package manifests, found MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC metadata, found no `preinstall`, `install`, or `postinstall` declarations, and completed production `npm audit --omit=dev` checks for both the repository and isolated Pi npm root with zero vulnerabilities. The scratch directory was removed after the run.

Every accepted source is an exact `npm:` source, has one capability owner, is removable by source identity, and is omitted when its manifest switch is false. Arcwell does not vendor or duplicate package classifiers.

## Accepted catalog

| Capability | Exact source | Default | Activation and side effects | Protected surfaces/configuration | Platform and lifecycle verdict |
|---|---|---:|---|---|---|
| LSP | `npm:@spences10/pi-lsp@0.0.46` | On | Extension-owned diagnostics; may start language servers when applicable | Package-owned configuration | Accepted sole owner; disable by module filter, uninstall by exact source; Windows claim remains release-gated |
| Context sidecar | `npm:@spences10/pi-context@0.1.16` | On | Handles large outputs; local file/process behavior remains package-owned | Tool output surfaces | Accepted sole owner; removable/disableable; release platform smoke required |
| Todo | `npm:@juicesharp/rpiv-todo@2.8.0` | On | Session UI/tool behavior | Package-owned session state | Accepted sole owner; removable/disableable; release platform smoke required |
| Questionnaire | `npm:@juicesharp/rpiv-ask-user-question@2.8.0` | On | Interactive UI when invoked | Pi UI | Accepted sole owner; headless package behavior remains package-owned |
| Plan mode | `npm:@narumitw/pi-plan-mode@0.56.0` | On | Tool selection/read-only planning behavior | Pi tool activation | Accepted sole owner; removable/disableable |
| MCP | `npm:@spences10/pi-mcp@0.0.60` | On | Package-owned lazy MCP behavior; configured servers may create network/process effects | MCP configuration | Accepted sole owner; Arcwell creates no server configuration in Tasks 0–2 |
| Web | `npm:pi-web-access@0.27.0` | Off | Network only when selected/invoked | Package-owned web tool results | Accepted optional sole owner; no network used by Arcwell tests |
| Subagents | `npm:pi-subagents@0.61.0` | Off | Child-agent/model activity only when selected/invoked | Package-owned sessions/tools | Accepted optional sole owner; Arcwell adds no orchestration layer |
| Autonomous workflows | `npm:@narumitw/pi-goal@0.54.4` | Off | Package-owned autonomous workflow behavior | Package-owned state and tools | Accepted optional sole owner; no Arcwell integration semantics |
| Redaction | `npm:@spences10/pi-redact@0.0.15` | On | Deterministic package hook behavior | Package-supported tool/session outputs | Accepted sole classifier; omitted when redaction is false |

Registry metadata confirms the exact versions, MIT licenses, declared Pi resources, repositories, dependency sets, and integrity records. The real macOS smoke confirms current installation and resource loading, but does not establish the behavior of every extension after invocation. Linux and Windows evidence remains pending the checked-in CI jobs.

## Rejected candidates and capabilities

| Candidate/capability | Verdict | Reason |
|---|---|---|
| `@spences10/pi-nopeek` | Reject | Overlaps the approved Arcwell protected-path policy boundary |
| `@spences10/pi-confirm-destructive` | Reject | Overlaps the approved effects-approval policy boundary |
| Coding-preferences package | Reject | Overlaps Arcwell's concise `AGENTS.md` working agreement |
| Alternate LSP, MCP, subagent, and goal providers | Reject | Would create duplicate capability ownership |
| Background tasks | Reject | Durable task machinery and process effects exceed v1 scope |
| Dynamic workflows | Reject | Overlaps the selected optional goal owner and adds orchestration machinery |
| Web UI | Reject | Listener/server surface is outside v1 |
| Git checkpoint | Reject | Repository mutation and recovery semantics are outside v1 |
| Notifications | Reject | Desktop/platform integration is outside v1 |

## Native Pi dependencies

Arcwell targets Node `>=24.15.0` and the locally audited Pi 0.84.4 API. The package manifest declares only native Pi extension, skill, and prompt resource paths. The protection extension imports only Node built-ins and the public `@earendil-works/pi-coding-agent` API. Claude authentication remains entirely under Pi's `/login`; Arcwell does not inspect credentials or auth state.

Pi package guidance normally puts bundled Pi APIs in `peerDependencies`. Arcwell deliberately keeps `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `typebox` as exact runtime dependencies because the same package also ships the standalone `arcwell` CLI, whose experimental commands import and execute those APIs outside a Pi host. This is a hybrid package exception, not peer-only guidance being overlooked; splitting the CLI and Pi resources into separate packages is deferred until it can preserve standalone CLI behavior.

Git installation is also a build-time exception: npm runs Arcwell's `prepare: npm run build` even under Pi's production-only `npm install --omit=dev`. Because the current TypeScript project compiles `src` and `test`, exact `typescript@6.0.3`, `@types/node@26.4.0`, and `ajv@8.20.0` pins are production dependencies required by that compile. `typescript-language-server@6.0.0` is not needed by the build and remains development-only.

## Package payload and installation security

Arcwell requires Node.js `>=24.15.0`. Its npm metadata uses an explicit files whitelist: compiled
CLI/runtime JavaScript under `dist/src`, the compiled protection extension under `dist/extensions`,
exact skills/prompts/content, Markdown documentation, `README.md`, `LICENSE`, and `NOTICE`. It
excludes tests, TypeScript source, declarations/source maps, `node_modules`, caches, scratch paths,
and home-directory paths. The Arcwell package is MIT-licensed; separately installed dependencies
and Pi packages retain their own licenses and notices and are not bundled into the tarball.

`npm pack --dry-run --json --cache .npm-cache` is the canonical local payload audit. Tests also
create a temporary package, extract it under repository-local `.tmp-tests`, and use
`DefaultResourceLoader` from that stable directory without changing Pi settings or invoking a
model. The prepare regression copies the working tree without Git metadata or build/install output,
uses an isolated home and empty npm cache, runs `npm install --omit=dev`, verifies the generated
`dist`, CLI bin, and extension, and then discovers the package resources with the checkout's
installed `DefaultResourceLoader`. This is prepare-build evidence, not Git transport evidence. The
explicit networked `npm run test:git-source -- <ref>` smoke invokes repository-local Pi 0.84.4 to
install the remote source in credential-isolated scratch state. Use `main` after a main push for
transport evidence and a pushed version tag for release-tag evidence; neither substitutes for the
other.
Arcwell is not published to npm. Exact bootstrap is
`npx github:VincenzoImp/arcwell#v0.1.0 setup`; setup requests Arcwell's exact Git source and exact
third-party `npm:` sources through Pi. Equivalent HTTPS, `git:https://`, SSH URL, and prefixed
`git:git@github.com:` forms of the Arcwell repository at `v0.1.0` satisfy setup and doctor without
being claimed as Arcwell-installed; `www.github.com` normalizes to `github.com`, while raw
`git@github.com:...` without `git:` is local to Pi and is not equivalent. A different ref fails
before mutation. Arcwell's disclosed
`prepare: npm run build` compiles a Git checkout before use. Uninstall removes only an exact source
recorded as owned and refuses changed, additional, or duplicate same-identity user entries before
invoking Pi's identity-wide package removal, including exact source-string duplicates represented
by both string and filtered-object settings entries.

Npm and Pi packages execute code with the user's permissions. A release consumer must inspect and
pin tarball integrity, native resources, the dependency tree, and third-party licenses/notices.
The ten direct Pi package versions are exact, but their transitive ranges are resolved afresh by
npm; the observed license set and audit result are evidence for one resolution, not a permanent
transitive lock or a substitute for attribution review. The only observed missing package-level
license field was `@spences10/pi-settings@0.0.3`. The smoke accepts that exact exception only after
checking its bundled MIT `LICENSE`, README statement that it is shared `my-pi` infrastructure, and
that every installed parent declaring it has `github.com/spences10/my-pi` repository provenance.
Any version or provenance change fails the smoke and requires renewed review.

Arcwell's static effects/secret guards do not sandbox dependency code, dynamic shell construction,
or existing scripts. Optional web, subagent, autonomous-workflow, configured MCP, and model use can
create network/process/model costs or effects owned by those packages.

Claude remains native Pi guidance: use `/login` and choose the intended authentication method.
Subscription login and API-key use are distinct billing paths; API keys or other providers can
incur separate charges. Arcwell does not inspect the account, credentials, quota, or billing state.

## Release gates

The GitHub Actions `Checks` workflow runs `npm ci`, `npm test`, the real-package smoke, and
`npm pack --dry-run --json` on Node 24.15.0 for Ubuntu, macOS, and Windows. The checked-in workflow
is configuration, not execution evidence; platform support should be claimed only after all three
jobs pass. Real setup idempotency, doctor, protection-toggle, uninstall, exact tarball contents,
transitive attribution, and maintenance status still need fresh release evidence. Npm publication
remains separately authorized and is not performed by these checks.

## Verdict

**Catalog and macOS package composition accepted.** Tests reject unversioned sources, duplicate
ownership, declared conflicts, removed module keys, false module selections, and unintended npm
payload files. The fresh macOS smoke verifies current installation, loading, metadata inspection,
and zero-vulnerability production audits for the repository and isolated Pi npm root. Linux/Windows CI results and a fresh
third-party tarball/transitive-attribution review remain release gates.
