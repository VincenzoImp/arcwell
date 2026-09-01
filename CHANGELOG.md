# Changelog

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
