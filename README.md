# Arcwell

A batteries-included environment for [Pi](https://github.com/earendil-works/pi): a working
agreement, fifteen skills, a planning subagent, prompt chains and a set of extensions, installed
reproducibly from one portable manifest and removable without residue.

```bash
npx github:VincenzoImp/arcwell#v0.6.0 setup --dry-run --write-manifest arcwell.json
# read arcwell.json and the plan, then:
npx github:VincenzoImp/arcwell#v0.6.0 setup --manifest arcwell.json --yes
```

Three commands: `setup`, `doctor`, `uninstall`. Requires Node `>=24.15.0` and Pi `0.84.4`.

## The idea

Most agent setups are a pile of instructions. This one is a route the agent can follow, plus a
set of limits it cannot talk past.

```
grill → research → plan → implement → review → fix ─┐
  ↑         ↑                  ↑                    │
  └─────────┴──────────────────┴────────────────────┘
        skip, revisit, or repeat any leg
```

`/autonomous` runs the whole route and repeats review until it comes back clean, bounded at
three rounds. **The route is a map, not rails**: every skill opens with the condition under
which it does not apply, and `/quick` exists because most changes are small. Ceremony out of
proportion to the work is treated as a defect of its own.

For work larger than one session, `/goal` adds what the model cannot ignore: continuation from
the idle boundary, a token budget, a no-progress guard, evidence required before completion,
and survival across compaction.

## What it installs

| | |
|---|---|
| **Working agreement** | Precedence, evidence, communication, code style, competence gate, discretion — merged as one marked block into your `AGENTS.md`, never overwriting it, and inherited by the subagents Arcwell dispatches |
| **Skills** | `scope-check` `code-review` `debug` `web` `grilling` `research` `planning` `tdd` `implementing` `delegating` `verification` `domain-modeling` `handoff` `prototype` `version-control` — only descriptions sit in context; bodies load on demand |
| **Subagents** | `pi-subagents` brings twelve, with background and parallel dispatch. Arcwell adds `planner`, which reads the scout's `context.md` and writes the `plan.md` the worker reads — the handoff is files, not prose. The four it dispatches are set to inherit the working agreement, which none of them does by default |
| **Prompts** | `/autonomous` `/quick` `/implement` `/implement-and-review` `/scout-and-plan` |
| **Memory** | A worklog per session, re-injected after compaction — Pi summarises what was said and cannot touch what was never said. `/lesson` records what is worth not repeating |
| **Protections** | An effects guard that fails closed without a UI, and secret-path blocking. Both on by default |
| **Postures** | `/preset research\|plan\|implement\|review\|fast\|max` withdraw `write`, `edit` and `bash` from the model's schema |

## Configuration

The only profile is `core`; the default posture is `guarded`.

| switch | default | effect |
|---|---:|---|
| `protections.effects` | on | confirm recognised remote effects; fail closed without a UI |
| `protections.secrets` | on | block recognised protected paths and private-key material |
| `protections.redaction` | on | select `@spences10/pi-redact` |
| `modules.lsp` | on | `@spences10/pi-lsp` — diagnostics and navigation |
| `modules.context` | on | `@spences10/pi-context` — large-output sidecar |
| `modules.mcp` | on | `@spences10/pi-mcp` — lazy MCP; Arcwell configures no servers |
| `modules.subagents` | on | `pi-subagents` — delegation, background and parallel runs |
| `modules.goal` | on | `@narumitw/pi-goal` — session goals with budgets and evidence |
| `modules.sandbox` | on | OS-level containment for `bash` — `sandbox-exec` on macOS, `bubblewrap` on Linux. The guards catch mistakes; this is the boundary |
| `modules.claudeCli` | **off** | `pi-claude-cli` — routes Anthropic through the Claude CLI, for a subscription login. Installing it is half the job: set `defaultProvider` to `pi-claude-cli` too, and `doctor` warns for either half |

**One module, one external package.** A package earns its place by saving work Arcwell would
otherwise have to do — a whole LSP protocol, an MCP client's server lifecycle, a credential
dictionary that ages badly when self-written.

Everything Arcwell ships itself — the todo overlay, structured questions, plan mode, the six
postures, tool discipline, the `web` skill, the memory extension — is disabled with `pi config`,
which handles every skill, prompt and extension individually, globally or per project.
Mirroring that here would give two answers to one question.

`posture: host` is valid only with all three protections off, so turning everything off stays a
statement rather than a drift.

## Local models

Arcwell does not manage providers. For Ollama, llama.cpp or vLLM, write
`~/.pi/agent/models.json` once:

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "qwen3-coder:30b", "contextWindow": 131072, "maxTokens": 32768 }]
    }
  }
}
```

Pi resolves `$VAR` inside `apiKey` and headers but **not** inside `baseUrl`, which has to be a
literal URL.

## Claude authentication

Pi's native `/login` owns it; Arcwell never reads or reports authentication state. Choose the
method deliberately: a Claude subscription login and an Anthropic API key are different billing
paths, and third-party harness usage may draw on extra usage rather than on a plan. Verify in
your provider settings before relying on it.

`modules.claudeCli` installs the adapter that routes Anthropic through the Claude CLI, which is
what puts a subscription login on the plan rather than on per-token billing. It is off by
default because it is right for one provider and pointless for the others, and Arcwell does not
know which you use.

Installing it is only half the job — **it routes nothing until you select it**:

```jsonc
// ~/.pi/agent/settings.json
{ "defaultProvider": "pi-claude-cli", "defaultModel": "claude-opus-4-5" }
```

The provider is named after the package, not after `claude`. `doctor` reads the configured
provider — configuration, not credentials — and warns for either half: the adapter missing
while the provider is `anthropic`, or the adapter present while the provider points elsewhere.

Setup, doctor, uninstall and dry run never call a model.

## What the guards are, and are not

Effects and secret-path matching inspect command text and supported tool results. They catch
mistakes, and only mistakes: dynamic variables, substitutions, generated commands and
pre-existing scripts all evade static matching.

`modules.sandbox` is what turns that into a boundary, using
[`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) —
`sandbox-exec` on macOS, `bubblewrap` on Linux, configured through
`~/.pi/agent/extensions/sandbox.json` or `<project>/.pi/sandbox.json`. On Linux it needs
`bwrap`, `socat` and `rg` on the host; `doctor` warns when they are missing rather than
pretending the containment is there.

Order matters and is asserted by a test: the effects guard loads first, because `user_bash`
handlers are first-wins and the guard returns nothing for a command it allows. Reversed, the
sandbox would answer every command and the guard would stop running.

Installing any Pi package runs code with your permissions. Inspect the source, `package.json`,
dependency tree, `LICENSE` and `NOTICE` before installing — including this one.

## Uninstall

```bash
arcwell doctor --json     # what the current state is
arcwell uninstall --yes
```

Removes only exact package sources it recorded as installed, its marked agreement block,
managed files that still match byte-for-byte what it wrote, and the one settings key it added
(`subagents.agentOverrides.<agent>.inheritGlobalContext`) — and that only when setup, rather
than you, wrote it. A file you have since edited is kept and reported: Arcwell does not delete
work it did not write. Pi, credentials, sessions, trust state, pre-existing packages, every
other settings key and unrelated bytes are untouched.

## Documentation

| | |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | vocabulary, boundaries, and the reasoning behind the shape |
| [`docs/specification.md`](docs/specification.md) | the exact contract: ownership, digests, compensation |
| [`docs/dependencies.md`](docs/dependencies.md) | what is installed and why, and what was rejected |
| [`docs/contributing.md`](docs/contributing.md) | how to change it, and what each level of verification catches |
| [`CHANGELOG.md`](CHANGELOG.md) | what moved between versions |

## Status

Not published to npm; installation uses the pinned GitHub ref. The full cycle — install from
the tag, `setup`, `doctor`, every resource loading with all seven packages present, then
`uninstall` — passes against a real Pi on Linux and macOS, in CI, on every tag.

**The three commands do not run on Windows.** They invoke `pi` from `PATH` with `shell: false`,
and npm installs it there as a `.cmd` shim, which Node will not spawn that way. Everything
Arcwell *installs* works on Windows — Pi loads the extensions, skills, prompts and agents, and
the package smokes pass there — but composing the environment has to be done from Linux or
macOS, or by running Pi's own `pi install` commands directly.

MIT. `NOTICE` records the redistributed MIT work from Pi's own examples.
