---
description: Worker implements, reviewer reviews, worker applies feedback
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "worker" agent to implement: $@
2. Write `git diff` to a file, then use the "reviewer" agent to review the implementation,
   passing {previous} and that path. The reviewer reads but does not run git, so it sees the
   change only if you hand it over
3. Finally, use the "worker" agent to apply the feedback from the review (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}.

After the final step, read the complete diff and run the project's tests. Report the
command output verbatim; if you ran nothing, say so.

