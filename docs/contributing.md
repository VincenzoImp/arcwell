# Contributing

Read [`CONTEXT.md`](../CONTEXT.md) first: it carries the vocabulary and the boundaries, and
this document assumes both.

## The levels of verification

Each level catches a class of defect the ones before it structurally cannot, so `npm test`
alone is not "the tests passed" — it is 138 of them and none of the smokes.

```bash
npm test                          # unit and integration against fake Pi clients
npm run check:upstream            # extensions/upstream against the installed Pi's examples
npm run test:prepare              # a clean copy through npm install --omit=dev and the loader
npm run test:packages             # real Pi, real catalog packages, isolated scratch environment
npm run test:git-source -- <ref>  # a pushed ref through Pi's Git transport
npm run test:lifecycle -- <ref>   # setup, doctor, uninstall against a real Pi
npm run check                     # the first two, for the edit-run loop
```

What each has caught that nothing else would have:

- **`test:packages`** — two catalog packages registering tools Arcwell already registered, which
  makes Pi load neither. No unit test sees a collision between two real manifests.
- **`check:upstream`** — `subagent/index.ts` left at Pi 0.84.2 while the package targeted
  0.84.4, missing an `isProjectTrusted` check upstream had added.
- **`test:prepare`** — that npm runs `prepare` under `--omit=dev` for Git sources, which is why
  `typescript` is a runtime dependency rather than a dev one.
- **`test:git-source`** — the transport itself: a pushed ref resolving, installing, and loading
  with its version intact, and the `files` whitelist carrying everything setup and
  `pi-subagents` read at runtime.
- **`test:lifecycle`** — `setup` against a real `pi install`, then `doctor`, then `uninstall`.
  `setup-scratch.test.ts` runs the same cycle against fake clients and `pi-package-smoke.mjs`
  never calls setup, so without this the first command a user runs was covered only by
  simulation.

The last two install Arcwell from `ARCWELL_PACKAGE_SOURCE` rather than from your checkout, so
they need a ref that exists on the remote. CI runs `test:git-source` on `main` and on tags, and
`test:lifecycle` on tags.

## Where a change goes

| you are adding | it goes in |
|---|---|
| a procedure the model should follow on a trigger | a skill |
| a rule that always applies | the working agreement — and it must be worth its always-loaded cost |
| behaviour that must hold whether or not the model cooperates | an extension |
| a chain of agents | a prompt template |
| a capability an external package already provides well | the catalog, not our code |

The last row is the one most often got wrong. Before writing an extension, check whether Pi
ships an example (`node_modules/@earendil-works/pi-coding-agent/examples/extensions/`, 79 of
them) or whether a maintained package covers it. Two decisions in this repository were reversed
for skipping that check.

## Writing a skill

The house style, from `writing-for-agents`:

- **The description is a context pointer.** It decides when the skill loads, so front-load the
  trigger and give one trigger per branch. `Use when …` then `Skip it when …`.
- **Open with the failure the skill prevents**, not with what it is. The reader needs to know
  what goes wrong without it.
- **Steps, then reference.** Numbered actions where order matters; flat rules where it does not.
- **Completion criteria that are checkable.** "Every modified model accounted for" forces work;
  "understanding reached" invites stopping early.
- **State the positive.** A prohibition drags the forbidden behaviour into context and makes it
  more available, not less.
- **Say when it does not apply.** That line is what keeps the route a map instead of rails.

Then prune twice:

- **No-ops** — an instruction the model already obeys by default pays load to say nothing.
  Delete the whole sentence rather than trimming it.
- **Cache** — a document restating `package.json` or `--help` is a copy that goes stale. Cache
  only what cannot be looked up: the unwritten convention, the reason behind a choice.

A colon followed by a space inside an unquoted YAML `description` parses as a nested mapping
and Pi drops the skill silently. `test/package-resources.test.ts` asserts the loader's
diagnostics so the cause is named rather than inferred from a gap.

## Touching extensions/upstream

Don't, unless `NOTICE` records why. Those files are redistributed from Pi's examples and stay
byte-identical so their provenance means something. `check:upstream` compares them against the
installed Pi, ignoring the provenance header, and knows about the one intended change.

When Pi updates and the check fails: read each difference, then either adopt upstream's version
or record the change in `NOTICE` and in `INTENDED_CHANGES` in `scripts/check-upstream.mjs`.

## Tests assert exact lists

Adding a skill fails `package-resources.test.ts` and the two smokes, on purpose. Deriving the
expectation from `package.json` would make the test agree with the code by construction and
verify nothing.

Update the written-out lists; do not make them dynamic.

## Commits

The reason, not the diff. What constraint shaped the change, what you verified, and — when a
previous decision is being reversed — what the earlier reasoning got wrong. Several commits in
this repository exist to record exactly that.
