---
name: delegating
description: Use when dispatching work to subagents — one task to an implementer, a diff to a reviewer, a lookup to a researcher. Covers what a dispatch carries, how artifacts move, and what to do with each status that comes back. Skip it when you are doing the work yourself; delegation costs context and coordination, and small work does not repay it.
---

# Delegating

The failure this prevents: paying for a subagent and getting back a claim you cannot check.
A subagent is useful because it works in a context you construct — which is also why its
report is a claim about work rather than the work itself.

## A dispatch carries the task, not the session

Everything pasted into a dispatch stays resident in your context for the rest of the
session and is re-read on every later turn. A real dispatch reached 42k characters, of
which 99% was accumulated history from earlier tasks.

A subagent needs: where its task fits in one line, its own requirements, the interfaces it
touches, your resolution of any ambiguity you spotted, and where to write its report.
Nothing else. It never inherits your history.

## Move artifacts as files

Write the brief to a file and name the path. Have the report written to a file and read it
when it lands. Hand the reviewer a diff file, not a pasted diff.

The output then never enters your context at all, and the subagent reads it in one call
instead of reconstructing it with a dozen commands.

## Record BASE before dispatching

Capture the commit you are starting from, before the subagent makes any. Reviews and diffs
use that value.

`HEAD~1` is wrong here: a task that produced three commits reviews only the last one, and
the review comes back clean because it never saw the rest.

## Choosing the model

Use the least capable model that can hold the task, and say which one explicitly — an
omitted model inherits yours, usually the most expensive.

But **turn count beats token price**. The cheapest models take two or three times the turns
on multi-step work, which costs more in wall-clock and context than the token difference
saves. A mid-tier model is the floor for reviewers and for implementers working from prose.
Reserve the cheapest tier for transcription: a task whose plan text already contains the
code to write, or a single-file mechanical fix.

## What comes back

| status | what to do |
|---|---|
| **DONE** | generate the diff from the recorded BASE and dispatch the review |
| **DONE_WITH_CONCERNS** | read the concerns first. Correctness or scope concerns get resolved before review; observations get noted and carried forward |
| **NEEDS_CONTEXT** | supply what was missing and re-dispatch |
| **BLOCKED** | something must change: more context, a more capable model, a smaller task, or a correction to the plan. Re-dispatching the same task to the same model unchanged repeats the failure |

## Ask for data, not prose

A review that comes back as paragraphs has to be re-read and interpreted before it can drive a
fix, and that interpretation is where findings get softened or lost. Dispatch reviews with an
`outputSchema` so the findings arrive as fields — severity, file, line, failure scenario — and
set `acceptance: "attested"` so a child that finishes without a structured report is marked
`claimed` rather than accepted.

The same applies to any child whose result feeds a decision. Prose is for the human reading
along; the next step should consume data.

## Reviewing what comes back

Read the diff. The report tells you what the subagent believes it did.

Never tell a reviewer what to overlook. If your dispatch contains "do not flag", "don't
treat X as a defect", "at most Minor", or "the plan chose this" — stop: you are
pre-judging, and usually to spare yourself a review round. Let the finding be raised and
adjudicate it after.

The reviewer's attention lens is the constraints you hand it, copied verbatim from the spec:
exact values, exact formats, the stated relationships between parts. That is what the
constraints block is for — the review method itself belongs in the reviewer's own
definition.

When a reviewer reports something it could not verify from the diff — a requirement living
in unchanged code, or spanning tasks — resolve it yourself. You hold the cross-task context
it lacks. A real gap goes back as a failed review.

## Fixing

Dispatch fixes for findings that block; record the rest and hand that list to the final
review, which can then triage what must be fixed before merge. A roll-up nobody reads is a
silent discard.

For a final review's findings, dispatch **one** fixer with the complete list. One fixer per
finding means each rebuilds context and re-runs suites; a real session's final fix wave
cost more than all its tasks combined.

Every fix dispatch carries the same contract: re-run the tests covering the change and
report the command and its output. Name the covering tests — a one-line fix does not need
the whole suite.

## Progress survives compaction; your memory does not

Conversation memory is lost at compaction. Controllers that lost their place have
re-dispatched entire completed task sequences — the most expensive failure this skill
knows about.

Write each completed task to the worklog as it completes, with the commit range. After a
compaction or a resume, trust the worklog and `git log` over your own recollection.
