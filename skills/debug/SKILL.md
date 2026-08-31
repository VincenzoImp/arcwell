---
name: debug
description: Diagnose failing tests or unexpected behavior by reproducing the symptom, isolating the cause, and proving the smallest fix.
---

# Debug

Reproduce the reported failure first and record the exact command and output. Trace data and control flow from the failing boundary instead of guessing. Form one testable hypothesis at a time, use the smallest diagnostic probe, and reject hypotheses contradicted by evidence.

Add or identify a regression test that fails for the defect. Fix the root cause with the smallest coherent change, then run the regression test and relevant broader checks. A vanished symptom without a passing regression test is not proof.
