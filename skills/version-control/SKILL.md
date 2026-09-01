---
name: version-control
description: Use when work needs to be recorded, shared or picked up by someone else — starting a branch, writing a commit, opening a pull request or an issue, or reading what the remote already says. Skip it for a change you are still exploring and have not decided to keep.
---

# Version control

The failure this prevents: work that exists only as files on one machine. A change nobody can
review, a decision nobody can find six months later, a branch whose purpose died with the
session that made it.

Everything here is craft, not permission. **Push, merge, opening or merging a pull request, and
publishing still need an explicit instruction for that specific action** — the working
agreement decides that, and nothing in this skill widens it.

## Branch

One branch per unit of work, named for what it does: `feat/owned-environment`,
`fix/compaction-restore`. Never commit to `main` or a shared branch.

Start from a clean tree. Uncommitted changes from something else end up in your diff, and the
review then covers work nobody asked for.

## Commit

The diff already says what changed. The message says **why**, and what a reader would otherwise
have to reconstruct:

- the reason the change exists, in the first line, in the imperative
- the constraint or discovery that shaped it — especially if the obvious approach was wrong
- what you verified, when the verification is not obvious from the diff

A commit that says "update file" costs the next reader a `git log -p` and a guess. One that
says "reject a 0.1.0 manifest rather than migrating it: modules dropped from nine keys to
three" costs them nothing.

Commit when a piece stands on its own — tests green, one coherent change. Not when you stop
for the day.

## Pull request

The PR carries what a reviewer needs and cannot get from the diff:

- what the change does, and the decision behind it
- **the verification you actually ran**, with its output — not "tests pass"
- what you did not do, and why: the scope you deliberately left out
- anything you could not verify

`gh pr create` writes it; `gh pr view` and `gh pr checks` read the state back without leaving
the terminal.

## Issue

Open one when work outlives the session: a defect you found but are not fixing now, a decision
that needs someone else, a follow-up the current change makes possible. An issue is where the
worklog goes when it stops being yours alone.

`gh issue create` opens it, `gh issue list` finds what is already known — check that before
writing a duplicate.

## Reading the remote

Before starting, and before claiming anything about the remote state:

| question | command |
|---|---|
| what is on the branch | `git log --oneline <base>..HEAD` |
| what CI says | `gh run list --branch <branch>` |
| what the PR looks like now | `gh pr view --json state,statusCheckRollup` |
| what is already reported | `gh issue list --search "<terms>"` |

CI output is evidence. A green local suite and a red pipeline mean the pipeline knows
something you do not — usually a platform you did not run on.

## Done

The work is on a branch, each commit explains itself, and anything that outlives this session
is written where the next person will look — not in the conversation.
