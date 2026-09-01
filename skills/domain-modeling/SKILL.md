---
name: domain-modeling
description: Use when the project's own language is unclear or contested — a term meaning two things, a boundary nobody can state, a convention that exists only in people's heads — and when writing or correcting a CONTEXT.md or an architecture decision record. Skip it when you only need to read the existing vocabulary; that is a habit, not a session.
---

# Domain modeling

The failure this prevents: two parts of a system using one word for different things, which
reads as agreement until something breaks at the join. The second failure: "follow the
existing conventions" as an instruction nobody can act on, because the conventions were
never written down.

## CONTEXT.md

One file at the project root, holding what a newcomer — human or agent — cannot get by
reading the code:

```markdown
## Vocabulary
<term>: <what it means here, and what it is not>

## Boundaries
<module>: <what it owns, what it may not reach for>

## Unwritten conventions
<the rule that is followed everywhere and stated nowhere>

## Why
<the decision a reader would otherwise reverse, and what it cost to make>
```

It is a glossary and a map, not a spec. Implementation details, task lists and design
scratch belong elsewhere; anything the code already says belongs in the code.

Create it when the first term is worth writing down, not before. Update it the moment a
term is settled — batching these loses them.

## Sharpening the language

**Challenge a term against the glossary.** When a word is used against its recorded
meaning, say so at once: "the glossary has *cancellation* as X, and you seem to mean Y —
which is it?"

**Split an overloaded word.** "You say *account*: do you mean the customer or the login?
Those have different lifetimes."

**Check the code agrees.** When someone states how the system behaves, verify it against
the source. A contradiction is the most valuable thing this skill finds: "the code cancels
whole orders; you described partial cancellation — which is true?"

**Probe with scenarios.** Invent the specific case that forces the boundary between two
concepts to be stated precisely.

## Vocabulary for structure

When the discussion is about where code should sit, use these words exactly. Substituting
"component", "service" or "boundary" is how the discussion loses precision.

- **Module** — anything with an interface and an implementation. Scale-agnostic: a
  function, a class, a package.
- **Interface** — everything a caller must know to use it correctly. Not just the type
  signature: invariants, ordering, error modes, required configuration.
- **Depth** — behaviour available per unit of interface learned. A **deep** module puts a
  lot behind a little; a **shallow** one has an interface nearly as complex as its body.
- **Seam** — the place where behaviour can be altered without editing in that place. Where
  the interface lives, which is its own decision.
- **Leverage** and **locality** — what depth buys: one implementation paying back across
  many call sites, and change concentrating in one place instead of spreading.

Two tests worth applying:

- **Deletion.** Imagine the module gone. If complexity vanishes, it was a pass-through. If
  it reappears across its callers, it earned its place.
- **Seam reality.** One adapter is a hypothetical seam; two are a real one. Do not build a
  seam until something varies across it.

## Decision records

Offer one only when all three hold:

1. **Hard to reverse** — changing it later costs something real.
2. **Surprising without context** — a future reader will ask why it was done this way.
3. **A real trade-off** — there were genuine alternatives and one was chosen for reasons.

Miss any one and the record is noise that ages into a wrong description of the system.
State the decision, the alternatives, and what made the difference — the reasoning is the
part a reader cannot reconstruct.

## Done

Each term in the glossary has one meaning and no rival. The conventions written down are
the ones actually followed — a stated convention the code contradicts is worse than none,
because it will be trusted.
