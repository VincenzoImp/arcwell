# Dependencies

## The catalog

Four external packages. A package earns a place by saving work Arcwell would otherwise have
to do; anything Arcwell can carry itself, it carries.

| Capability | Exact source | Why it is not internal |
|---|---|---|
| LSP | `npm:@spences10/pi-lsp@0.0.46` | An entire protocol: server lifecycle, diagnostics, navigation |
| Context sidecar | `npm:@spences10/pi-context@0.1.16` | Non-trivial truncation and retrieval logic for oversized tool output |
| MCP | `npm:@spences10/pi-mcp@0.0.60` | A protocol client with server lifecycle; Arcwell configures no servers |
| Redaction | `npm:@spences10/pi-redact@0.0.15` | A credential-pattern dictionary, which ages badly when self-written |

Each is an exact `npm:` source, owns exactly one capability, is removable by source identity,
and is omitted when its manifest switch is false.

## What used to be here

Six packages were removed once Arcwell shipped the capability itself. This is not a
preference: installing them alongside registers the same tool twice, and Pi then loads
neither — `Tool "todo" conflicts with ...`. The real-package smoke catches it, and
`INTERNAL_CAPABILITIES` in `src/setup/catalog.ts` records each pairing so it cannot return.

| Superseded package | Now provided by |
|---|---|
| `@juicesharp/rpiv-todo` | `extensions/upstream/todo.ts` |
| `@juicesharp/rpiv-ask-user-question` | `extensions/upstream/questionnaire.ts` |
| `@narumitw/pi-plan-mode` | `extensions/upstream/plan-mode/` |
| `pi-subagents` | `extensions/upstream/subagent/` plus the four agent definitions |
| `pi-web-access` | the `web` skill and its `search.sh` / `fetch.sh` |
| `@narumitw/pi-goal` | nothing — autonomous goal execution is out of scope; `/autonomous` is instructions, not an engine |

## Rejected candidates

| Candidate | Reason |
|---|---|
| `@spences10/pi-nopeek` | Overlaps Arcwell's protected-path policy |
| `@spences10/pi-confirm-destructive` | Overlaps the effects-approval policy |
| Coding-preferences package | Overlaps the working agreement |
| Alternate LSP, MCP or subagent providers | Duplicate capability ownership |
| Background tasks, dynamic workflows, web UI, Git checkpoints, notifications | Out of scope |

## npm dependencies

Arcwell targets Node `>=24.15.0` and the locally audited Pi 0.84.4 API.

| | |
|---|---|
| `peerDependencies` | `@earendil-works/pi-coding-agent: "*"` |
| `dependencies` | `typescript@6.0.3`, `@types/node@26.4.0` |
| `devDependencies` | `typescript-language-server@6.0.0` |

**Why the Pi API is a peer.** `docs/packages.md` requires importers of Pi's bundled core
packages to declare them as peers and not bundle them; a bundled copy would give an extension
different module instances from the Pi runtime that loads it. An earlier revision kept it as a
runtime dependency because the standalone CLI executed Pi APIs outside a Pi host through the
experimental commands. Those commands are gone, and the `--omit=dev` prepare smoke confirms
npm resolves the peer for the Git-source install path.

**Why the compiler is a runtime dependency.** npm runs `prepare: npm run build` for Git
dependencies even under `npm install --omit=dev`, so the compiler and its types must be
present at that moment. This is a build-time exception, not a runtime import.

`ajv` and `typebox` were removed with the experimental layer. `test/package-smoke-helpers.test.ts`
asserts that none of Pi's core packages, nor `ajv`, can drift back into `dependencies`.

## Provenance

The protection and memory extensions import only Node built-ins and the public
`@earendil-works/pi-coding-agent` API. `extensions/upstream/` is redistributed MIT work from
Pi's own examples, shipped as TypeScript and loaded by Pi's runtime rather than compiled here,
which is what lets it stay byte-identical to upstream. `NOTICE` records every file and its
modifications.

Claude authentication remains entirely under Pi's `/login`; Arcwell inspects no credentials
and no auth state.

## Verification

Three levels, all required:

- `npm test` — unit and integration against fake Pi clients.
- `npm run test:prepare` — a clean copied checkout through `npm install --omit=dev`, the
  `prepare` build, and `DefaultResourceLoader`.
- `npm run test:packages` — the repository-local Pi 0.84.4 CLI installing Arcwell and all four
  catalog sources into an isolated scratch environment, then reloading resources and auditing
  every installed manifest for licenses and install lifecycle scripts.

The last run found 12 extensions, 13 skills and 3 prompts with no diagnostics, MIT /
Apache-2.0 / BSD / ISC metadata across installed dependencies, no `preinstall`, `install` or
`postinstall` declarations, and zero vulnerabilities from `npm audit --omit=dev`.

Passed on macOS. Linux and Windows evidence remains pending the checked-in CI jobs; no
cross-platform claim follows from the macOS result alone.
