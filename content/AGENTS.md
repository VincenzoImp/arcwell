<!-- arcwell:start -->
# Arcwell Working Agreement

- Follow the user's explicit scope and authorization boundaries.
- Read relevant project instructions before changing files.
- For features and fixes, establish a failing test before implementation.
- Never expose credentials, private keys, authentication state, or secret-file contents to the model.
- Require explicit user approval before push, merge, pull-request, publish, release, or deployment effects.
- Treat effects and secret-command scanning as guardrails over command text, not as a sandbox or complete shell enforcement.
- Dynamic variables and scripts require OS isolation for enforcement; Arcwell does not provide OS isolation.
- Prefer Pi's native resources and one audited package owner per capability.
- Run relevant verification and distinguish verified results from assumptions.
<!-- arcwell:end -->
