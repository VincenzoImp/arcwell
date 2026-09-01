---
name: implementing
description: Use when turning a settled decision into code — writing the task breakdown, or executing one. Sizes tasks so each one is independently reviewable and carries the exact values its implementer needs. Skip the breakdown when the change fits one task; the standards below still apply to that task.
---

# Implementing

The failure this prevents: a plan that reads as complete and cannot be executed. Its steps
say "add appropriate error handling" and "write tests for the above", which means the
decisions were deferred, not made — and they surface again during implementation, where
they are more expensive.

## Task size

A task is the smallest unit that carries its own test cycle and is worth a reviewer's gate.

The test for a boundary: **could a reviewer reject this task while approving its
neighbour?** If not, they are one task. Fold setup, configuration, scaffolding and
documentation into the task whose deliverable needs them; splitting them out produces
tasks that cannot be judged alone.

Each task ends with something independently testable.

## What a task carries

```markdown
### Task N: <name>

**Files:** create / modify (with line ranges) / test

**Interfaces:**
- Consumes: <what it uses from earlier tasks — exact signatures>
- Produces: <what later tasks rely on — exact names, parameter and return types>

- [ ] Step: <one action>
```

The **Interfaces** block exists because an implementer sees only its own task. It cannot
read the neighbouring ones, so the names and types it must match have to arrive with the
task or be invented — and invented ones will not match.

Steps are one action each: write the failing test, run it and watch it fail, write the
minimal implementation, run it green, commit.

## No placeholders

These are plan failures, not shorthand:

- "TBD", "TODO", "implement later", "fill in details"
- "add appropriate error handling", "handle edge cases", "add validation"
- "write tests for the above", with no test
- "similar to Task N" — repeat it; tasks are read out of order
- a step that says what to do without showing how, where the how is code
- a reference to a type, function or file that no task defines

Every exact value — a magic string, a threshold, a signature, a test case — appears in the
task, not in the prose around it.

## Global constraints

Requirements that bind every task (version floors, naming rules, platform limits) go once
at the top, with exact values copied verbatim. Every task's requirements implicitly include
them; restating them per task is how they drift.

## While implementing

Follow the code standard in the working agreement: the style already in the codebase first,
the smallest coherent change, nothing left behind.

Run typechecking and the tests covering your change as you go; the full suite once at the
end. Record what you did in the worklog as you do it, not afterwards from memory.

When the task turns out to be wrong — the interface does not exist, the approach cannot
work, the requirement contradicts another — stop and say so. Implementing around a broken
task produces code that has to be removed later.

## Self-review before handing over

Read the plan against the spec once with fresh eyes:

1. **Coverage** — can you point at the task that implements each requirement?
2. **Placeholders** — search for the patterns above.
3. **Type consistency** — does a name defined in Task 3 still have that name in Task 7?

Fix what you find inline; there is no second pass.
