---
name: grilling
description: Use before building anything whose requirements are not yet settled — a feature described in one sentence, a request with an unstated audience, a plan whose success condition nobody has written down. Interrogates the design as a tree of decisions, one round per frontier, and ends when nothing is left silently assumed. Skip it when the change is understood and its blast radius is visible in one file.
---

# Grilling

The failure this prevents: building the thing that was asked for instead of the thing
that was meant, and discovering the difference at review. The cost of a wrong assumption
grows with every file written on top of it.

## The tree and its frontier

Model the design as a tree: every decision branches into the decisions that hang off it.
The **frontier** is every decision whose prerequisites are already settled — the questions
you can ask now without guessing at answers you have not heard.

Ask the whole frontier in one round. A question whose answer depends on another question
still open belongs to a later round, not this one.

```
❓ **Q1** — **<title>**: <question, with the options if there are any>

➡️ <your recommended answer, and why in one line>

---

❓ **Q2** — **<title>**: <question>

➡️ <your recommended answer>
```

Each round's answers reshape the tree: settled decisions push the frontier outward and
unblock what depended on them. Recompute and ask the next round.

## Facts are yours, decisions are theirs

Anything you could look up, look up. The filesystem, the dependency versions, what the
existing code does, what the library's docs say — dispatch a subagent and find out. Asking
the user for a fact you could have read is the most common way this skill wastes someone's
time.

Do not block on it: a running lookup is an unsettled prerequisite, so only the questions
downstream of it wait. Ask the rest of the frontier now.

The decisions are theirs. Put each one to them with your recommendation attached, and wait.

## Done

The frontier is empty: every branch visited, nothing left silently assumed. State the
shared understanding in a short paragraph and confirm it before any code is written.

If two rounds produce no new branches, the tree is shallower than it looked — say so and
move on rather than manufacturing questions.
