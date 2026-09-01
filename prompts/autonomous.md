---
description: Run the full loop on a task — grill, research, plan, implement, review, fix — repeating review until it passes
argument-hint: "<what to build>"
---
Take this work from where it is to done, without stopping to ask permission between legs: $@

Open the worklog first (`/worklog`) and keep it current as you go. It is what survives
compaction, so a decision that lives only in the conversation is a decision you will lose.

**For work larger than one session, run this under `/goal`.** The two are different layers:
this prompt is the method, which you follow; `/goal` is the limits, which you cannot talk your
way past. It continues from the settled idle boundary, survives compaction and forks, stops on
a token budget or after repeated runs with no progress, and requires evidence before
`goal_complete` is accepted. Without it a long run can drift or declare itself finished; with
it alone you would keep going without a method.

## The route

Each leg has a condition. When the condition is absent, say so in one line and move on —
the route is a map, not a gate.

1. **Grill** — when the requirements are not settled. Ask the whole frontier in one round,
   numbered, each with your recommendation. Skip when the change is understood and its blast
   radius is visible in one file.
2. **Research** — when the work touches something you do not command. Primary sources; a
   subagent reads while you continue on what does not depend on the answer. Skip when you can
   already state how the thing behaves and why.
3. **Plan** — when the route is not visible from here. Skip when charting would surface
   nothing you could not already state.
4. **Implement** — the smallest coherent change, the style already in the codebase, a failing
   test first for each behaviour change. Record what you did in the worklog as you do it.
5. **Review** — dispatch the `reviewer` agent against `git diff` from the commit you recorded
   before starting, never `HEAD~1`. It sees the change, not a description of it. Hand it the
   spec's binding constraints verbatim, and never tell it what to overlook.
6. **Fix** — dispatch one worker with the complete list of findings that block. Then review
   again.

## The loop closes on evidence, not on effort

Repeat review → fix → review until the review comes back clean. Not until it looks better:
clean.

Three rounds is the ceiling. If the third review still finds blocking issues, stop and report
— three rounds of new problems is a signal about the approach, not about the fixes.

Record each round in the worklog: what was found, what was changed, what the next review said.
After a compaction, that record is how you know which round you are on.

## Before you call it done

Run the verification the claim needs, fresh, and read the output. A subagent reporting success
is a claim about work; the diff is the work. Say what you ran, what came back, and which parts
you exercised versus only read.

If something in the task was wrong or impossible, say that plainly rather than delivering
around it.
