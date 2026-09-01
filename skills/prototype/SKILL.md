---
name: prototype
description: Use when the open question is how something should look or behave, and words keep going in circles — a layout, an interaction, an interface shape, a data model nobody can picture. Builds a rough artifact to react to, then throws it away. Skip it when the disagreement is about facts, which research settles, or about scope, which the user settles.
---

# Prototype

The failure this prevents: three rounds of prose about how something should behave, when
twenty minutes of a rough version would have settled it. Some questions are cheaper to answer
by building than by describing — and describing them longer produces confidence, not agreement.

The opposite failure, which is worse: the prototype becomes the implementation. It was built
to be reacted to, not to be kept, and it carries none of the care that shipping requires.

## When it is the right move

The question is **how should this look or behave**, and:

- two people picture different things from the same sentence, or
- you cannot tell whether an interface is awkward until you use it, or
- the shape of the data only becomes obvious once something reads it.

If the disagreement is about a fact — what the API returns, what the library does — that is
`research`. If it is about how much to build, that is `scope-check`.

## Build the smallest thing that provokes a reaction

Cheap and concrete beats complete. An outline, a stub that returns fixed data, a screen with
no logic behind it, three lines of the interface as it would be called.

Say out loud that it is a prototype, and what it is missing: no error handling, no persistence,
values hardcoded. Otherwise the first question is "is this done?" instead of "is this right?".

**Never wire it into the real thing.** A prototype that touches production paths stops being
free to throw away, and that freedom is the whole point.

## Get the reaction, then decide

Put it in front of whoever holds the question and ask what is wrong with it. "Wrong" pulls
harder than "what do you think": people correct a concrete thing readily and approve a vague
one out of politeness.

Then one of three things happens, and all three are successes:

- **it is roughly right** — record the decision and rebuild it properly, test first
- **it is wrong in a way you can now name** — that name is what you lacked; it may be worth
  one more prototype, rarely two
- **it turns out the question was different** — the most valuable result, and the one that
  looks like failure

## Done

The question is answered and the artifact is deleted, or kept only where the project already
keeps throwaway work and marked as such. What survives is the decision and its reason, written
where decisions live — not the code.
