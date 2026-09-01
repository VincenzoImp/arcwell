# Contributing

Read [`CONTEXT.md`](../CONTEXT.md) first: it carries the vocabulary and the boundaries, and
this document assumes both.

## The three levels of verification

All three are required, and the last one is not optional convenience — it is the only level
that catches what the others structurally cannot.

```bash
npm test              # unit and integration against fake Pi clients
npm run test:prepare  # a clean copy through npm install --omit=dev, prepare, and the loader
npm run test:packages # real Pi, real packages, isolated scratch environment
npm run check:upstream # extensions/upstream against Pi's own examples
npm run check         # npm test + check:upstream
```

`test:packages` is what found that two catalog packages registered tools Arcwell already
registered, which makes Pi load neither. No amount of unit testing would have shown it.
`test:prepare` is what proves the Git-source install path works, including that the upstream
TypeScript extensions load without a build of their own.

`npm test` alone is not "the tests passed". It covers 138 of them and neither smoke.

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
