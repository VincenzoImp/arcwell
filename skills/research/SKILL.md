---
name: research
description: Use when the work depends on something you do not command — an unfamiliar library, a protocol, an API's real behaviour, a version's actual changes — whether the gap appears before you start or halfway through implementing. Reads primary sources, traces every claim to the source that owns it, and leaves cited findings behind. Skip it when you can already state how the thing behaves and why.
---

# Research

The failure this prevents: applying a half-remembered API and discovering at runtime that
the shape changed two versions ago. Confidence is not knowledge, and the gap between them
is invisible from the inside.

The second failure, quieter: stopping at a blog post that summarises the docs. A summary
carries the author's misunderstanding forward as if it were fact.

## Primary sources only

Follow every claim to the source that owns it:

| you need | read |
|---|---|
| how a library behaves | its source, then its reference docs — not its README |
| what a version changed | the changelog and the diff, not a migration guide about it |
| what an API returns | the spec, or a real call you make and record |
| what the platform provides | the reference docs for that capability, not the tutorial |

`node_modules` is a primary source, and usually the nearest one. So is `--help`. So is a
one-line probe you run yourself.

## Mid-task, not only up front

This applies again the moment an unknown surfaces during implementation. The pull to guess
is strongest there, because stopping feels like losing momentum — but a wrong guess written
into code costs more than the minutes it saved.

## Delegate the reading

Reading burns context you need for the work. Dispatch a subagent with the question and the
sources to consult; keep working on what does not depend on the answer.

## Leave the findings behind

Write what you learned to one file, each claim carrying the source that settled it: a path
and line, a URL, a command and its output. Put it where the project already keeps such
notes; if there is no convention, say where you put it.

State which source settled each question in your report. "The docs say" is not checkable;
`node_modules/x/dist/y.d.ts:42` is.
