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
