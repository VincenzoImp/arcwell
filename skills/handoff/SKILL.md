---
name: handoff
description: Use when work must continue in a session that does not have this one's context — a fresh agent, a colleague, or yourself tomorrow. Writes a document that resumes the work rather than describing it. Skip it when the worklog already holds the state and the next session is the same session after a compaction.
---

# Handoff

The failure this prevents: a summary that reads well and cannot be acted on. The next
session does not need to know what happened; it needs to know what is true now and what to
do next.

## What goes in

- **Where the work stands.** The goal, what is done, what is in progress, what is blocked.
- **Decisions and their reasons.** Especially the ones a fresh reader would otherwise
  reverse, having no idea why the obvious approach was rejected.
- **Exact next steps**, in order, with the commands to run.
- **The skills to reach for**, named. A fresh agent does not know which ones this work uses.
- **What is verified and what is assumed.** Carry the distinction across the boundary; it
  does not survive on its own.

## What stays out

Anything already captured in an artifact. Specs, plans, ADRs, issues, commits, diffs and
the worklog are referenced by path or URL, never restated — a copy goes stale the moment
the original moves, and the next session then has two versions and no way to tell which is
current.

Credentials, keys, tokens and personal data are redacted, including inside pasted output.

## Where it goes

The OS temporary directory, not the workspace. A handoff is scaffolding for a transition,
not a project artifact; committing one leaves the repository carrying somebody's old
context forever.

## Done

The test is mechanical: hand the document to someone with no memory of this session and
they can run the next step without asking a question. If any step needs a fact that lives
only in your context, that fact belongs in the document.
