---
name: debug
description: Use when something fails, behaves unexpectedly, produces a wrong result, or worked before and does not now. Requires a reproduction that fails before the fix and passes after, and rejects a vanished symptom as proof of cause. Takes precedence over any general debugging routine.
---

# Debug

The failure mode this exists to prevent: changing something plausible, watching the
symptom disappear, and calling it fixed. That is how a bug becomes intermittent instead
of solved.

## 1. Reproduce it, exactly

Get to one command that fails, reliably. Write it down.

If you cannot reproduce it, that is the whole task for now — say so rather than fixing
speculatively. An unreproducible bug plus a plausible change equals two bugs.

For intermittent failures: run the command in a loop and record the failure rate. "Fails
3 times in 50" is a fact; "sometimes fails" is not.

## 2. Read the actual error

The whole message, the whole stack, the exit code. Not the first line.

Then find the exact source line that produced it. The message is a claim about what went
wrong; the code is what actually went wrong. They differ more often than you expect —
error strings are copied, wrapped and reused.

## 3. Bisect the distance between working and broken

You are looking for the smallest gap between something that works and something that
does not.

- Worked before? `git log` the relevant paths; `git bisect` if the range is wide.
- Works elsewhere? Diff the two environments: versions, config, env vars, cwd, permissions.
- Works with different input? Shrink the input until one more step makes it pass.

Each step should halve the space. If a step does not eliminate half the possibilities,
choose a different step.

**When the system has several components** — CI to build to signing, API to service to
database — bisecting by guesswork is slow because the failure is reported by whichever
component noticed, not the one at fault. Instrument the joins instead: at each boundary,
record what went in and what came out, then run once. One run tells you which hop lost the
value, and the search collapses to that component.

## 4. Prove the cause before fixing it

State the cause as a claim that could be wrong: *"X fails because Y."*

Then test that claim directly — with a probe, a log line, a one-off script that exercises
Y alone. Confirm it, or discard it and go back to step 3.

Two shortcuts that look like proof and are not:
- the symptom disappeared after a change (many changes make symptoms disappear)
- the explanation is plausible and fits (so do several wrong explanations)

## 5. Write the failing test first

Before the fix: a test that fails **for this reason**, and that you have watched fail.
Run it and read the failure message — if it is not the failure you expect, the test is
testing something else.

Then fix, and watch it pass. A fix without a red-then-green cycle is a fix you cannot
distinguish from a coincidence.

## 6. Three failed fixes means the architecture, not the hypothesis

Count them. When each fix works and reveals a new problem somewhere else — a different
shared state, a different coupling — you are not failing to find the cause. You are finding
that the shape is wrong.

At the third one, stop fixing and say so. Name the pattern the failures share and what
changing it would cost. A fourth fix on this path buys another symptom.

## 7. Check the neighbourhood

The same mistake is rarely alone. Search for the pattern you just fixed: the same call
without the same guard, the same missing check, the same wrong assumption. Fix or report
each one.

## Reporting

Say what the cause was, what evidence established it, and what the fix changes. If you
did not manage to prove the cause and fixed a likely candidate instead, say that plainly
— it is useful information, and hiding it is what turns a bug into folklore.
