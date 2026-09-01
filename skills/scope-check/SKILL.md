---
name: scope-check
description: Use before writing infrastructure — a runner, a queue, a state store, a policy engine, a framework — or when a plan reaches its third revision. Checks that the solution is proportionate, that the platform does not already ship it, and that something runnable exists. Takes precedence over any general brainstorming or planning routine.
---

# Scope check

Run this before building, not after. It takes two minutes and its whole purpose is to
stop work that should not start.

## 1. What will the user be able to run, and when?

Name the command. If you cannot name one the user could run against what exists right
now, the direction is wrong — not the estimate, the direction.

Write it down: `<command>` produces `<observable result>`.

If the honest answer is "nothing yet, first I need to build X", ask what the smallest
version of X is that makes the command work, and build that instead.

## 2. Does the platform already do this?

Read the documentation of the tool you are extending **before** writing a component.
Not the README — the reference docs for the specific capability.

Most "missing" infrastructure already ships. Durable state, resumption, retry, session
identity, structured output, isolation, permissions: these are exactly the things a
mature tool has already solved and a builder is most tempted to rewrite.

Concrete check: grep the docs for the nouns in your design. If you are about to build a
"job ledger", search for *session*, *state*, *persist*, *resume*, *id*. If you are about
to build a "policy engine", search for *hook*, *permission*, *block*, *approve*.

## 3. Is the size proportionate?

State the problem in one sentence, then the solution in one sentence. Compare them.

- One user, one machine, one process at a time → no leases, no fencing tokens, no
  transactional ledger. A lock file and a JSON file.
- Reversible local work → no ceremony, no cryptographic provenance, no sealed evidence.
  Tests and a review.
- A tool you will use yourself → no plugin architecture, no configuration schema, no
  extension points. A function.

Machinery to *prove* the work was done correctly is only worth it when someone who was
not there has to trust it. For your own tooling, it is pure cost.

## 4. Is specification outrunning code?

If a plan, spec or design document is growing faster than the code it describes, that is
not thoroughness — it is a signal that the scope exceeds what one person can hold.

Hard triggers, any one of which means shrink rather than revise:

- the plan's prose — excluding code blocks and commands — outgrows the code it will produce
- you are on the third revision and the new problems are still structural, not detail
- you cannot explain what it builds in five sentences

The response is to cut the scope, not to write another revision. Ship the part that has
a runnable command, then decide whether the rest is still needed. It usually is not.

## 5. Content or machinery?

Ask what fraction of the planned work is *instructions, conventions and knowledge*
versus *code that enforces them*. Content usually delivers more per line. A working
agreement, a good prompt, a well-written skill: these change every future session. A
policy engine changes nothing until it is correct, complete and trusted.

Build the machinery only for the rules that must hold whether or not anyone cooperates.

## Reporting

If this check says stop, say so in two sentences with the specific trigger, propose the
smaller thing, and let the user decide. Do not build the large version quietly while
mentioning the concern in passing.
