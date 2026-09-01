---
name: code-review
description: Use when reviewing a diff, a pull request, a commit, or code just written, and when asked to check, audit or verify an implementation before it is integrated. Produces findings classified by severity, each with a concrete failure scenario, and deletes findings that cannot be made to fail. Also use before claiming a change is complete. Takes precedence over any general review routine.
---

# Code review

A review that produces a list of impressions is worse than no review, because it buys
confidence without earning it. Every finding here carries a failure scenario or it is
deleted.

## The one question

For each thing you want to flag: **what specific input or state makes this go wrong, and
what exactly goes wrong?**

If you cannot answer with concrete values, you have a preference, not a finding. Say it
as a preference in one line, or drop it.

Format each finding as:

```
SEVERITY  file:line
  <one sentence: what is wrong>
  <failure: specific inputs/state → specific wrong outcome>
```

## Two axes, kept apart

A change can satisfy one and fail the other:

- **Spec** — does it do what was asked, all of it, and nothing else?
- **Standards** — does it follow the conventions of this codebase?

Code that follows every convention while implementing the wrong thing passes Standards and
fails Spec. Code that does exactly what the issue asked while breaking the project's
patterns does the reverse.

When the diff is large enough to warrant it, run the two as parallel subagents so neither
colours the other, and report them under separate headings. **Do not merge or rerank the
findings across axes** — collapsing them is what lets a clean Standards report bury a
missing requirement.

Give the Spec reviewer the originating spec and the diff; give the Standards reviewer the
project's documented conventions and the diff. Neither gets your session history.

## Severity

- **Critical** — data loss, credential exposure, a security boundary that does not hold,
  a correctness bug on a normal path, or a step that cannot run as written.
- **Important** — a wrong result on an edge case, a missing rollback, a resource leak, a
  contract that two parts of the system disagree about, a check that cannot fail.
- **Minor** — naming, structure, duplication, a comment that will mislead the next reader.

Do not inflate. A long Critical list trains the reader to skim, and the one that mattered
is lost among them.

## What to look for first

1. **Invariants declared but not enforced.** The comment or doc says X is guaranteed;
   find the code that guarantees it. This is the most common serious defect and the
   hardest to see, because the claim reads as evidence.
2. **Tests that cannot fail.** For each test, ask what single-byte change to the
   implementation would make it red. If the answer is none, it is decoration. Common
   shapes: asserting a value against itself, a counter captured at fixture time, a regex
   that matches the test's own source, a check that runs after an earlier check already
   made the case impossible.
3. **Error paths.** What happens on failure, partial write, timeout, or concurrent
   access? Silent fallback to a default is the dangerous one, because everything looks
   fine.
4. **The boundary between "verified" and "assumed".** Which claims in the change
   description were actually measured?
5. **Scope.** Does the diff do what it says, and only that?

## Structural smells

Where the project documents no convention, these still apply — as labelled heuristics
("possible feature envy"), never as violations. **A documented project standard overrides
any of them**, and anything a linter already enforces is not worth a finding.

Each reads *what it is* → *what to do*:

- **Mysterious name** — a name that does not reveal what it does or holds → rename it; if
  no honest name comes, the design is murky.
- **Duplicated code** — the same logic shape in more than one hunk → extract, call from both.
- **Feature envy** — a method reaching into another object's data more than its own → move
  it onto the data it envies.
- **Data clumps** — the same fields always travelling together → they are a type; make it.
- **Primitive obsession** — a string or number standing in for a domain concept → give the
  concept its own small type.
- **Repeated switches** — the same cascade on the same type in several places → polymorphism,
  or one shared map.
- **Shotgun surgery** — one logical change forcing scattered edits → gather what changes
  together.
- **Divergent change** — one module edited for unrelated reasons → split by reason.
- **Speculative generality** — parameters and hooks for needs the spec does not have →
  delete; inline back until a real need appears.
- **Message chains** — `a.b().c().d()` the caller should not depend on → hide the walk
  behind one method.
- **Middle man** — a unit that mostly delegates onward → cut it, call the real target.
- **Refused bequest** — an implementer ignoring most of what it inherits → composition
  instead.

## Verify before reporting

Try to disprove your own findings before writing them down. For anything you would call
Critical, either reproduce it or state plainly that you did not.

Prefer running something over reading: a probe, a mutation, a one-line script. Reading
tells you what the code appears to do; running tells you what it does. When you plant a
defect to check a test catches it, restore the original bytes and confirm the restore.

## Reporting

Lead with the verdict in one paragraph: is this safe to integrate, and what is the single
most important thing. Then the findings, most severe first. Then the exact counts.

A clean review is a legitimate outcome — but only if you genuinely tried to construct a
failure and could not. Say which parts you exercised and which you only read.
