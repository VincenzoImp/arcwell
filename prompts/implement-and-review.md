---
description: Implement an approved change, verify it, and perform a failure-focused review
argument-hint: "<approved task>"
---

Implement the approved task: $@

Use test-driven development: observe a meaningful failing test, make the smallest coherent implementation, and run relevant checks. Then review the final diff for concrete correctness, security, compatibility, and test failure scenarios. Resolve supported findings and report residual risk. Do not perform remote effects or read secret material.
