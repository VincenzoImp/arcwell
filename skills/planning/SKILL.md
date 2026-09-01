---
name: planning
description: Use when the work is larger than one session can hold and the route to the end is not yet visible — a system to build, a migration to design, a redesign whose shape is still argued. Charts the work as a map of decisions and resolves them one at a time. Skip it when the route is already clear — if charting surfaces nothing you could not already state, you do not need a map.
---

# Planning

The failure this prevents: planning the whole route from where you are standing, when most
of it is not visible yet. A plan written through fog is detailed about the near ground and
wrong about everything past it, and its confidence hides which is which.

Planning here means **finding the way**, not charging at the destination.

## The destination comes first

Name what reaching the end looks like: a spec to hand off, a decision to lock before work
starts, a change made in place. One or two lines.

This is the first act because it fixes the scope. Every later question about whether
something belongs is answered against it.

## The map

One file, owned by the worklog, holding the whole effort at low resolution:

```markdown
## Destination
<what the end looks like>

## Decisions so far
- <question>: <one-line answer> → <where the detail lives>

## Open
- [ ] <question> — blocked by: <question>

## Not yet specified
<in-scope fog: suspected questions too vague to phrase sharply yet>

## Out of scope
- <thing> — <why it sits past the destination>
```

The map is an **index, not a store**. A decision lives in exactly one place; the map gists
it and points. Load the map every session, and zoom into a decision's detail only when the
work in front of you needs it.

## Decisions, not build slices

Each open item is a question whose resolution is a **decision**. "Should the ledger be a
file or a database" is one. "Implement the ledger" is not — that is the building, and it
comes after the way is clear.

Each carries how it gets resolved:

| kind | who | what it is |
|---|---|---|
| research | agent alone | a fact the decision waits on. Dispatch and continue |
| prototype | with the user | a rough artifact to react to, when "how should it behave" is the question |
| grilling | with the user | a conversation. The default |
| task | either | manual work blocking a decision: provisioning access, moving data so its shape is visible |

The ones marked *with the user* resolve only through that exchange. Answering them yourself
and recording the answer as settled defeats the point of asking.

## Fog of war

The map is deliberately incomplete. Beyond the open questions lies work you can tell is
coming but cannot yet pin down, because it hangs on questions still open. That goes in
**Not yet specified**, as loosely as the view allows.

The test for whether something is an open question or fog:

> Can you state the question precisely **now** — not answer it, state it.

If yes it is a question, even if it is blocked and you cannot act on it. If no, it is fog.
Do not pre-slice fog into question-sized pieces: one patch may graduate into several
questions, or none.

Resolving a question clears the fog ahead of it. Whatever became sharp graduates into new
open questions; delete the patch it came from, so it lives in one place.

## Out of scope

Fog gathers only toward the destination. Work past it is not fog — it is out of scope, and
it never graduates. When a question turns out to sit beyond the destination, close it and
leave one line saying why. It stays out of *Decisions so far*, which records the route
actually walked.

## Working the map

Take the first open question that nothing blocks. Resolve it. Record the answer, then
update the map: new questions created, fog graduated, anything the answer invalidated.

Resolve one question per session, research aside. The limit is not ceremony: a session that
resolves four questions has usually stopped thinking about the fourth.

## Done

Nothing is left to decide before someone can go and build the thing. The pull to just do
the work is usually the signal you have reached that edge — hand off rather than carrying
execution into the map.
