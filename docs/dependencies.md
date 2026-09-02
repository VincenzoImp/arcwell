# Dependencies

## The catalog

Seven external packages. A package earns a place by saving work Arcwell would otherwise have
to do; anything Arcwell can carry itself, it carries.

| Capability | Exact source | Why it is not internal |
|---|---|---|
| LSP | `npm:@spences10/pi-lsp@0.0.46` | An entire protocol: server lifecycle, diagnostics, navigation |
| Context sidecar | `npm:@spences10/pi-context@0.1.16` | Non-trivial truncation and retrieval logic for oversized tool output |
| MCP | `npm:@spences10/pi-mcp@0.0.60` | A protocol client with server lifecycle; Arcwell configures no servers |
| Subagents | `npm:pi-subagents@0.62.0` | Background and parallel child sessions, spawn budgets, worktree anchoring |
| Goal | `npm:@narumitw/pi-goal@0.54.4` | Session goals with token budgets, no-progress guards and evidence before completion |
| Redaction | `npm:@spences10/pi-redact@0.0.15` | A credential-pattern dictionary, which ages badly when self-written |
| Claude CLI | `npm:pi-claude-cli@0.3.1` | Routes Anthropic through the Claude CLI; off by default, see below |

Each is an exact `npm:` source, owns exactly one capability, is removable by source identity,
and is omitted when its manifest switch is false. Each also records the published tarball's
sha512 integrity, so the pin names the bytes that were reviewed rather than only the release
they were reviewed in.

## Who is behind them

Everything here runs with your permissions when it is installed. Measured 2026-09-02:

| Package | Downloads/mo | Stars | Last release | Maintainers |
|---|---:|---:|---|---:|
| `@earendil-works/pi-coding-agent` | 8,312,650 | 100,686 | 2026-08-28 | 3 |
| `pi-subagents` | 362,483 | 3,426 | 2026-09-01 | 1 |
| `@narumitw/pi-goal` | 49,870 | 493 | 2026-08-31 | 1 |
| `@spences10/pi-mcp` | 2,126 | 118 | 2026-08-23 | 1 |
| `@spences10/pi-context` | 1,562 | 118 | 2026-08-23 | 1 |
| `@spences10/pi-redact` | 1,409 | 118 | 2026-08-23 | 1 |
| `@spences10/pi-lsp` | 1,134 | 118 | 2026-08-21 | 1 |
| `pi-claude-cli` | 1,087 | 102 | **2026-03-21** | 1 |
| `@anthropic-ai/sandbox-runtime` | 1,250,081 | — | 2026-09-01 | Anthropic |

Pi and the sandbox runtime are in a different category from the rest. **Everything else is one
person**, and four of the catalog packages sit under 2,500 downloads a month. That is not a
judgement on the code; it is the reason for the exact pins, the integrity hashes, the
`review:upgrade` gate and the sandbox.

`pi-claude-cli` is the cautionary one: unmaintained since March, on the path that decides how
Anthropic bills you, and carrying a bug that silently discarded the entire system prompt for
every session — found here on 2026-09-02, reported as
[rchern/pi-claude-cli#39](https://github.com/rchern/pi-claude-cli/pull/39). `check:updates`
now reports a package with no release for over 120 days, which is what nobody was watching.

**Why the pin stays on the unmaintained original.** `@saccolabs/pi-claude-cli` is the active
continuation — 0.6.0 against 0.3.1, more downloads than the origin, and the same bug fixed two
days earlier and better, distinguishing `--system-prompt-file` from `--append-system-prompt-file`
and naming the temp file per session rather than per process. It was evaluated here and
**rejected on evidence**: in `--print` mode it returns an empty assistant message with zero
tokens and no error. The control that settles it is that the original answers correctly in the
same scratch environment, on the same model, with the same flags — so it is the package and not
the environment. Its observer-mode architecture may simply require the TUI; either way,
adopting a provider that cannot run headless would break every non-interactive use.

Vendoring the fixed adapter was the alternative and was not taken: it would make this repository
the maintainer of a whole provider, which is the opposite of what the catalog is for. Instead
`doctor` reads the installed adapter's own source and **errors** when it hands a path to
`--append-system-prompt`, so the failure is loud rather than silent until the PR lands.

## What breaks without each

| Package | If it stops being maintained |
|---|---|
| `pi-subagents` | Delegation, background and parallel runs; the `planner` agent has no chain to join |
| `@narumitw/pi-goal` | `/goal` limits; `/autonomous` still runs, unbounded |
| `@spences10/pi-lsp` | Diagnostics and navigation; everything else is unaffected |
| `@spences10/pi-context` | Large tool output is no longer offloaded, so it lands in context |
| `@spences10/pi-mcp` | No MCP servers, which Arcwell configures none of anyway |
| `@spences10/pi-redact` | The standalone redaction pass; `pi-context` keeps redacting its own store |
| `pi-claude-cli` | Anthropic goes back to per-token billing, silently |
| `@anthropic-ai/sandbox-runtime` | `bash` stops being contained; the guards still catch mistakes |

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
| `pi-web-access` | the `web` skill and its `search.sh` / `fetch.sh` |

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
| `peerDependencies` | `@earendil-works/pi-coding-agent: "0.84.4"` |
| `dependencies` | `@anthropic-ai/sandbox-runtime@0.0.75`, `typescript@6.0.3`, `@types/node@26.4.0` |
| `devDependencies` | `typescript-language-server@6.0.0` |

**Why the Pi API is a peer.** `docs/packages.md` requires importers of Pi's bundled core
packages to declare them as peers and not bundle them; a bundled copy would give an extension
different module instances from the Pi runtime that loads it. An earlier revision kept it as a
runtime dependency because the standalone CLI executed Pi APIs outside a Pi host through the
experimental commands. Those commands are gone, and the `--omit=dev` prepare smoke confirms
npm resolves the peer for the Git-source install path.

**Why the peer range is exact.** npm installs peer dependencies automatically, so declaring
one does not stop a second copy from existing: a Git install measures 170 MB against a 335 KB
payload, and 141 MB of that is Pi under the package's own `node_modules`. That copy is not
inert — `src/setup/agent-dir.ts`, `extensions/upstream/preset.ts` and
`extensions/upstream/tools.ts` import **values** (`getAgentDir`, `CONFIG_DIR_NAME`,
`DynamicBorder`, `getSettingsListTheme`), and Node resolves those from the nearest
`node_modules`, which is the nested one. A range would let it drift from the host on Pi's next
release, and `DynamicBorder` crossing two module instances of the same class fails at render
time and nowhere earlier. The exact pin turns that into a resolution error at install, and
`doctor`'s `pi.nested` check catches an environment where it happened anyway.

**Why the sandbox runtime is a runtime dependency.** `extensions/upstream/sandbox/index.ts` is
vendored from Pi's examples and loaded by Pi's runtime, so its import has to resolve from the
installed package. It is Apache-2.0 and maintained by Anthropic. `NOTICE` records why it is
pinned ahead of the version the example pins.

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

All of these, and `docs/contributing.md` says what each one alone catches:

- `npm test` — unit and integration against fake Pi clients.
- `npm run test:prepare` — a clean copied checkout through `npm install --omit=dev`, the
  `prepare` build, and `DefaultResourceLoader`.
- `npm run test:packages` — the repository-local Pi 0.84.4 CLI installing Arcwell and every
  catalog source into an isolated scratch environment, then reloading resources and auditing
  every installed manifest for licenses and install lifecycle scripts.
- `npm run test:git-source -- <ref>` and `npm run test:lifecycle -- <ref>` — the published
  payload and the whole `setup`/`doctor`/`uninstall` cycle against a real Pi.
- `npm run check:updates` — drift, republished artifacts and staleness.
- `npm run review:upgrade -- <pkg> <from> <to>` — before a pin moves, never after.

The last run found 15 extensions, 17 skills and 11 prompts with no diagnostics, MIT /
Apache-2.0 / BSD / ISC metadata across installed dependencies, **no `preinstall`, `install` or
`postinstall` declarations in any downloaded package**, and zero vulnerabilities from
`npm audit --omit=dev`. That lifecycle-script assertion is the one that would stop a dependency
running code the moment it is fetched.

Green on Linux, macOS and Windows in CI, with the full lifecycle exercised on Linux and macOS
on every tag.
