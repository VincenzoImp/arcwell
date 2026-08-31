---
name: code-review
description: Review code changes before integration, focusing on reproducible correctness, security, compatibility, and test failures.
---

# Code Review

Read the requested diff and its surrounding contracts. For every proposed finding, name a concrete input or state and the resulting failure. Drop preferences that have no failure scenario.

Report findings in severity order with file and line references. Check invariants, error paths, tests that cannot fail, accidental secret exposure, scope creep, and compatibility. If practical, reproduce serious findings without mutating remote state. State which areas were executed and which were only read.
