# Context

What a newcomer — human or agent — cannot get by reading the code.

## Vocabulary

**Capability** — something the environment can do. It is provided either by an external package
(then it has a **module** switch) or by Arcwell itself (then it does not).

**Module** — a manifest switch over exactly one external package. `modules.lsp` decides whether
Arcwell asks Pi to install `@spences10/pi-lsp`. It is not a general on/off: everything Arcwell
ships is disabled with `pi config`.

**Protection** — a guard that changes what the agent is allowed to do: `effects`, `secrets`,
`redaction`. Distinct from a module, because turning one off changes safety rather than
inventory.

**Managed resource** — a whole file Arcwell writes into the agent directory, recorded with a
digest and whether the path existed first. Distinct from the **working agreement**, which is a
marked block merged into a file the user also owns.

**Ownership** — `arcwell/ownership.json`: what Arcwell installed, what it wrote, and what was
already there. It is what makes uninstall exact rather than approximate.

**Posture** — `guarded` (the default) or `host`. `host` is only valid with every protection
off; it exists to make "I turned everything off" a deliberate statement rather than a drift.

**Upstream** — `extensions/upstream/`, redistributed from Pi's own examples. Not ours to
improve: changes there are drift unless `NOTICE` records them.

## Boundaries

| area | owns | may not |
|---|---|---|
| `src/setup/` | the lifecycle: manifest, plan, apply, doctor, uninstall, ownership | know anything about skills or prompt content |
| `extensions/` | Arcwell's own runtime behaviour: protections, memory | reach into `src/setup` beyond `agent-dir`, `config`, `atomic-file`, `types` |
| `extensions/upstream/` | nothing — it is redistributed | be edited without a `NOTICE` entry and a `check:upstream` exception |
| `skills/`, `agents/`, `prompts/` | what the model reads | assume an extension is loaded; they must degrade to prose |
| `content/` | what setup installs | contain anything machine-specific |

Arcwell never writes `settings.json`. It asks Pi to install exact sources and lets Pi own that
file. Everything else it writes lives under `arcwell/` or is a named managed resource.

## Unwritten conventions

- **Tests assert exact lists, not shapes.** `deepEqual` against a written-out array, so adding
  a skill fails a test on purpose. Deriving the expectation from the source would make the test
  tautological.
- **Every `.ts` under `extensions/upstream/` carries its provenance in its own header**, so a
  copy that leaves this repository still says where it came from.
- **Comments explain why.** The code says what. A comment restating the line below it is
  deleted rather than reworded.
- **A failing verification is reported with its output**, in the same breath as the claim it
  qualifies. This is in the working agreement because it is the rule most easily broken while
  believing it is being followed.
- **Three levels of test, all required**: `npm test` (fake Pi clients), `test:prepare` (clean
  `--omit=dev` install and build), `test:packages` (real Pi, real packages). The last one has
  caught what the first two structurally cannot — tool collisions between packages.

## Why

**Why `@earendil-works/pi-coding-agent` is a peer, not a dependency.** Pi bundles its core
packages; a second copy would hand extensions different module instances from the runtime
loading them. `typescript` and `@types/node` stay runtime dependencies only because npm runs
`prepare` under `--omit=dev` for Git sources.

**Why the upstream extensions are not compiled.** Compiling them produced 60 type errors: they
are written for Pi's runtime, which type-checks nothing, while this project builds with
`strict` and `exactOptionalPropertyTypes`. Fixing them would mean editing someone else's MIT
code and forfeiting byte-identical provenance. Pi loads TypeScript directly, so leaving them
uncompiled costs nothing.

**Why the subagent engine is a package again.** It was internalised once, on a reason that
turned out to be circular. `pi-subagents` brings background runs, which is what makes parallel
agent work and git worktrees possible at all.

**Why `/autonomous` is a prompt and not an extension.** An extension that drives turns would be
a second engine competing for control with `pi-goal`. Machinery is for rules that must hold
whether or not the model cooperates; here the model is the thing executing the loop.

**Why uninstall keeps modified files.** A managed file the user has since edited is theirs, and
deleting it would destroy work Arcwell did not write. It is kept and reported instead.
