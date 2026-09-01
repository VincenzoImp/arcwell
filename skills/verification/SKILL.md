---
name: verification
description: Use before any claim that work is done, fixed, passing, or ready — and before committing, opening a PR, or moving to the next task. Turns a claim into evidence by naming the command that proves it and running it fresh. Applies to every claim, including the small ones.
---

# Verification

The failure this prevents: a status report that is true of the code you meant to write. The
gap between intention and result is invisible from where you are standing, which is exactly
why it needs a command rather than a judgement.

This is not about honesty. It is about a class of error you cannot detect by thinking
harder.

## The gate

Before stating any status:

1. **Name** the command that would prove the claim false if it were false.
2. **Run** it, in full, now. Not a subset, not a remembered run from earlier.
3. **Read** the output: the exit code, the counts, the last line.
4. **Compare** it to the claim. If they disagree, the output wins.
5. **State** the claim with the evidence attached.

A run from before your last edit is not evidence. Neither is a run of a narrower command.

## What each claim actually requires

| claim | requires | does not establish it |
|---|---|---|
| tests pass | the suite's own output, zero failures | a previous run, a subset, "should pass" |
| the build works | the build command, exit 0 | the linter passing |
| the linter is clean | its output, zero errors | a partial check extrapolated |
| the bug is fixed | the original symptom's reproduction, now passing | the code changed and it looks right |
| the regression test works | red with the fix reverted, green with it restored | it passes once |
| a subagent did the work | the diff it produced, read by you | its report saying success |
| the requirements are met | each one checked against the change | the tests passing |

The last two are the ones that bite. **A subagent's report is a claim about work, not the
work** — read the diff. And a green suite says the tests pass, not that the thing you were
asked for exists.

## Proving a regression test

A test that passes after the fix might pass without it. To know:

```
run it (green) → revert the fix → run it (must be red) → restore → run it (green)
```

Without the middle step you have a test that agrees with the current code, which is not
the same as a test that catches the defect.

## Reporting

Say what you ran and what came back — the command, and the line that carries the verdict.
Say which parts you exercised and which you only read.

When something is unverified, say so in the same breath as the claim it qualifies, not in a
footnote. "Tests pass; I did not exercise the Windows path" is useful. A summary that omits
the second half is not.
