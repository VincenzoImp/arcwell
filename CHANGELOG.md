# Changelog

## 0.5.1

### Fixed

- **The Claude billing warning missed the case that actually happens.** It fired only when
  `defaultProvider` was literally `anthropic`, and a fresh install leaves that key unset — so a
  subscription login went on being billed per token in silence. It now covers the other half
  too, which is the one that bit first: **installing the adapter changes nothing until the
  provider points at it**. The provider name is `pi-claude-cli`, the package name, not `claude`
  or `claude-cli`.
- The doctor fixtures installed every catalog package including the one that is off by default,
  which is not an environment `setup` can produce.

## 0.5.0

Breaking: ownership gains `subagentOverridesWritten`, so a 0.4.0 ownership file is rejected.
Run `arcwell uninstall --yes` with 0.4.0 before installing this, or re-run `setup`.

**The working agreement was reaching no subagent at all.** Found by running a real dispatch
against a local model rather than by reading: a token placed in `<agentDir>/AGENTS.md` came
back from the parent, and `NONE` from `scout`.

0.4.0 set `inheritProjectContext: true` on `planner` and called the problem fixed. That was the
wrong field. `pi-subagents` splits the two: `inheritProjectContext` covers a *repository's*
`AGENTS.md`, while the operator's file under the Pi agent directory — exactly where Arcwell
merges the agreement — is `inheritGlobalContext`, and it **defaults to false for every builtin**
(`docs/agents.md:240`). So the standing preferences this environment exists to carry were
absent from every delegated turn.

### Added

- `planner` sets `inheritGlobalContext: true`.
- `setup` writes `subagents.agentOverrides.<agent>.inheritGlobalContext` for the four agents its
  prompts dispatch, and `uninstall` removes it. Only that key, only for those agents, and only
  when setup was the one to write it: a value the user already chose is left alone in both
  directions, and unrelated fields on the same agent survive removal.

## 0.4.0

Breaking: `modules` gains `claudeCli`, and three agent files are gone. Regenerate with
`arcwell setup --dry-run --write-manifest arcwell.json`.

This release removes more than it adds. The test it applies: keep only what carries a
preference or a composition, and leave plumbing to whoever maintains it.

### Removed

- **`agents/scout.md`, `agents/worker.md`, `agents/reviewer.md`.** A package agent *shadows* a
  builtin — it does not inherit the fields its frontmatter leaves unset. Resolving the
  discovered config showed ours coming back `inheritProjectContext=false`, `thinking` unset,
  `output` and `defaultReads` empty, while surviving builtins had all of them. So the four ran
  **without the working agreement**, and the scout→worker handoff — declared in frontmatter as
  `output: context.md` and `defaultReads`, never in prompt prose — was broken for the six
  prompts `pi-subagents` ships. The builtins are also larger where it matters: reviewer 740
  words against our 246.

  The reviewer's `bash` was redundant: both dispatching prompts already hand it the diff, and
  the builtin reads rather than runs git. The prompts now say so outright.

### Changed

- **`planner` joins the chain.** It is the one agent with no builtin counterpart, and it now
  declares `inheritProjectContext`, `thinking`, `defaultReads: context.md` and `output:
  plan.md` — which is what `worker` already reads.
- **The peer dependency is pinned exactly.** npm installs peers automatically, so `"*"` did not
  prevent a second copy: a Git install measures 170 MB against a 335 KB payload, 141 MB of it
  Pi inside the package. It is not inert — `agent-dir.ts`, `preset.ts` and `tools.ts` import
  values, and Node resolves those from the nested copy. `doctor` gains `pi.nested` for an
  environment where they diverged anyway.
- **`setup` gates on the Pi version.** It called `piClient.version()` and discarded the result,
  so it installed against any Pi while `doctor` rejected anything but 0.84.4.

### Added

- **`modules.claudeCli`**, off by default — `pi-claude-cli`, which routes Anthropic through the
  Claude CLI. Right for a subscription login, pointless for an API key or another provider, and
  Arcwell does not know which you use. `doctor` reads the configured provider — configuration,
  not credentials — and warns when it is `anthropic` and the module is off, because that path
  is billed per token and nothing else would mention it.
- **`npm run check:updates`** and a weekly CI job: every pin against what the registry
  publishes. Exact pins compose the same environment twice and age without saying so.

### Unchanged, and now on purpose

- **The compaction prompt stays Pi's.** `agent-session.js` passes `customInstructions` to the
  `session_before_compact` hook and then calls the default summariser with its own local
  variable, so an extension can only replace the whole summary at the cost of a model call.
  A house trigger would cover only compactions Arcwell starts; covering Pi's automatic
  threshold means pre-empting it. The worklog already carries the durable state outside the
  summary, which is the stronger mechanism.
- **`extensions/upstream/` stays vendored.** Byte-identical copies of Pi's examples, proved by
  `check:upstream` on every run. Unmodified upstream code is not custom; it is vendored because
  Pi does not load its own examples.

## 0.3.3

`0.3.2` shipped a README claiming the commands work on Windows, written before the lifecycle
smoke proved they do not. The tag stays as published rather than being moved, and this release
carries the corrected text: the claim is in the payload, so only a new version replaces it.

## 0.3.2

Windows had never passed, and behind the first failure were two more. Fixing them let the
lifecycle smoke run there for the first time, which found a fourth: **the three commands cannot
invoke `pi` on Windows at all.** `createPiClient` spawns it from `PATH` with `shell: false`, and
npm installs it there as a `.cmd` shim. Every Windows check that passes spawns
`node <pi>/dist/bundle/cli.js` instead, which is why nothing had caught it.

This is recorded, not fixed: the repair is either a shell path with argument validation or a
dependency, in the code that installs packages, and that is a decision to take deliberately.
The README states the limitation and CI skips the lifecycle step on Windows rather than
reporting a known gap as a build failure.

### Fixed

- **`check:upstream` compared line endings.** A Windows checkout rewrites the redistributed
  sources to CRLF while the copy under `node_modules` keeps LF, so every comparable file
  reported drift. The check defends content, not the separator the working tree happens to use.
- Two test assertions assumed POSIX: a worklog path matched against a regex containing a
  forward slash, and the execute bit on skill scripts, which a Windows working tree does not
  carry for `npm pack` to read. The bit is asserted where it can exist — so a release has to be
  cut on POSIX — and the exact joined path is now compared instead of a suffix.
- `arcwell-memory` reached its context through `unknown` with optional members, so if Pi renamed
  `getSessionFile` the build would stay green and every session would quietly share one
  `ephemeral` worklog. It now uses the real shape, checked at both call sites against
  `ReadonlySessionManager`.

## 0.3.1

Every version bump rejects the previous manifest, patch releases included: `parseSetupManifest`
compares `arcwellVersion` exactly. Regenerate with
`arcwell setup --dry-run --write-manifest arcwell.json`.

### Fixed

- **The dry run described a destination setup does not write.** It announced
  `$PI_CODING_AGENT_DIR/{agents,presets.json}` and "the subagent definitions and presets", left
  over from before `pi-subagents` took the agents into the package. For a tool whose contract is
  that the plan is exact, consent text that names the wrong files is not cosmetic.
- `test:git-source` asserted that exactly one extension loaded — true when Arcwell shipped one,
  and stale for six versions. It now checks the whole published payload: every extension, skill,
  prompt, and the files the `files` whitelist has to carry for setup and `pi-subagents` to work.

### Added

- **`npm run test:lifecycle -- <ref>`** — setup, doctor, resource loading and uninstall against
  a real Pi with real packages. `setup-scratch.test.ts` ran this cycle against fake clients and
  `pi-package-smoke.mjs` never called setup, so the first command every user runs had no
  automated check at all. CI runs it on tag pushes.
- `test:git-source` also runs on tag pushes, not only on `main`.

## 0.3.0

Breaking: `modules` gains `subagents` and `goal`, so a 0.2.0 manifest is rejected. Regenerate
with `arcwell setup --dry-run --write-manifest arcwell.json`.

This release reverses two decisions from 0.2.0. Both were made here, and both failed on
evidence rather than on taste.

### Changed

- **The subagent engine is `pi-subagents` again.** 0.2.0 recorded that the package conflicted
  with the internal copy; the conflict existed *because* it was internalised. `pi-subagents`
  discovers agents from an installed package's own manifest, so the four hand-written agents
  work unchanged on top of it — and it brings background runs, parallel dispatch, declarative
  chains, spawn budgets and git-worktree anchoring, none of which 1034 lines of our own had.
- **`@narumitw/pi-goal` is back.** It was cut as a second engine competing for turn control
  with the review-loop extension, which was then never built. `/autonomous` is the method;
  `/goal` is the limits — token budget, no-progress guard, evidence before completion,
  survival across compaction.
- The agent definitions are no longer managed resources: they ship with the package.
  `presets.json` remains the only file setup writes whole.
- `modules` means one external package, stated in `types.ts`. What Arcwell ships itself is
  disabled with `pi config`.

### Added

- **`version-control`** — branches, commit messages that carry the reason, PRs that carry the
  verification, issues for work that outlives the session, and `gh` for reading remote state.
  It widens no permission: push, merge and PR still need an explicit instruction.
- **`prototype`** — build a rough artifact when words keep circling, then throw it away.
  `planning` named it as a ticket type and it did not exist.
- **`CONTEXT.md`** — the project's own vocabulary and boundaries.
- **`docs/contributing.md`** — how to change this, and why to check for an existing package
  before writing an extension.
- **`npm run check:upstream`** — compares `extensions/upstream/` against the installed Pi's
  examples. On its first run it found `subagent/index.ts` still at Pi 0.84.2 while the package
  targets 0.84.4, missing an `isProjectTrusted` check upstream had added.
- Reviews are dispatched with `outputSchema` and attested acceptance, so findings arrive as
  data instead of prose to be parsed.
- npm metadata: `repository`, `bugs`, `homepage`, `author`.

### Fixed

- `doctor` dereferenced a catalog lookup for every module, assuming each owns a package.
- Local-model configuration is documented in the README; it was dropped in 0.2.0 by inattention
  rather than decision.

## 0.2.0

Breaking. A `0.1.0` manifest is rejected rather than migrated: `parseSetupManifest` fails on
the old `modules` keys, and ownership gained a required field. Regenerate with
`arcwell setup --dry-run --write-manifest arcwell.json`.

### Removed

- **The experimental workflow layer.** `src/workflows`, `src/backends` and the
  `arcwell experimental` command namespace, 1927 lines the README already described as not
  executing. With them went `ajv`, `typebox` and `@earendil-works/pi-ai`.
- **Six catalog packages**, each superseded by a capability Arcwell now ships:
  `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-ask-user-question`, `@narumitw/pi-plan-mode`,
  `pi-subagents` and `pi-web-access`. Installing them alongside registers the same tool twice
  and Pi loads neither.
- **`@narumitw/pi-goal`**, and autonomous goal execution with it. `/autonomous` is
  instructions, not an engine; a second engine competing for turn control is what this
  removes.
- `modules.todo`, `modules.questionnaire`, `modules.planMode`, `modules.web`,
  `modules.subagents` and `modules.autonomousWorkflows`. What ships inside Arcwell is disabled
  with `pi config`, not with the manifest.

### Added

- **Nine skills** — `grilling`, `research`, `planning`, `tdd`, `implementing`, `delegating`,
  `verification`, `domain-modeling`, `handoff` — joining the four carried from pi-setup, which
  are restored at full length. `code-review` gains a two-axis split and Fowler's smell
  baseline; `debug` gains boundary instrumentation and the three-failed-fixes rule.
- **The full working agreement**, 123 → 986 words: the five-level precedence hierarchy, the
  untrusted-input rule, the Evidence section, and four new standards (discretion, competence,
  code, communication).
- **`arcwell-memory`** — a per-session worklog re-injected after compaction, and `/lesson`.
  Pi summarises what was said and cannot touch what was never said, so state kept in a file
  survives intact.
- **Six internalised extensions** from Pi's own examples: subagents, plan mode, questionnaire,
  todo, the six tool postures (`/preset`) and tool discipline. Shipped as TypeScript under
  `extensions/upstream/` and loaded by Pi's runtime, which keeps them byte-identical to
  upstream.
- **Managed resources** — the four subagent definitions and `presets.json`, installed into the
  agent directory because Pi's package manifest has no `agents` key. Each is recorded with a
  digest; uninstall removes only untouched files it created.
- **`/autonomous`** and **`/quick`**, and the four subagent definitions.

### Changed

- `@earendil-works/pi-coding-agent` moves to `peerDependencies`, per `docs/packages.md`. A
  bundled copy would give extensions different module instances from the Pi runtime loading
  them. Runtime dependencies are now `typescript` and `@types/node`, both required because npm
  runs `prepare` under `--omit=dev` for Git sources.
- `ARCWELL_PACKAGE_SOURCE` points at `v0.2.0`.

### Fixed

- Reinstalling recorded Arcwell's own managed files as pre-existing, after which uninstall
  would never remove them.
- Uninstall left the `agents/` directory behind, so the filesystem did not match its
  pre-setup state.
- The build never compiled `extensions/`: `tsconfig` did not include it, and the only reason
  `arcwell-protections.js` existed was a test importing it.
- A colon-space in an unquoted YAML description silently dropped a skill. The resource test
  now asserts the loader's diagnostics.

## 0.1.0

First release: setup, doctor, uninstall, a portable manifest, ownership tracking and the
effects and secret-path protections.
