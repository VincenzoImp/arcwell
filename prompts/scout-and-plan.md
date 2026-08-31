---
description: Inspect a project read-only and produce a bounded implementation plan
argument-hint: "<goal>"
---

Scout the project read-only for this goal: $@

Identify the smallest relevant files, existing primitives, contracts, tests, and concrete risks. Do not modify files, invoke models recursively, access secrets, or perform network or remote effects. Produce a dependency-ordered plan with file paths, a failing-test step for each behavior change, and exact verification commands. Mark assumptions and decisions that require user approval.
