---
description: Make a small, understood change end to end — read, change, verify, report — with no plan and no ledger
argument-hint: "<the small change>"
---
Make this change: $@

The condition for this route is checkable, not a size estimate: **you understand the change,
and its blast radius is visible in one file.** If reading shows that neither holds — the
change reaches further than expected, or the reason for the current behaviour is not
obvious — stop and say so. Then use `/autonomous` instead.

1. Read the code you are about to change, and the code that calls it.
2. Make the smallest coherent change, in the style already there.
3. Run the command that would prove the change wrong if it were wrong. Read the output.
4. Report what you changed and what the command said.

No worklog, no plan, no review round. Ceremony out of proportion to the work is a defect of
its own, and this route exists because most changes are small.
