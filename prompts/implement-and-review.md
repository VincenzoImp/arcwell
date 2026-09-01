---
description: Worker implements, reviewer reviews, worker applies feedback
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "worker" agent to implement: $@
2. Then, use the "reviewer" agent to review the implementation, passing both {previous} and the output of `git diff` so the reviewer sees the change rather than a description of it
3. Finally, use the "worker" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.

After the final step, read the complete diff and run the project's tests. Report the
command output verbatim; if you ran nothing, say so.

