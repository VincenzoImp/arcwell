# Arcwell

A batteries-included environment for [Pi](https://github.com/earendil-works/pi): a working
agreement, fifteen skills, four subagents, prompt chains and a set of extensions, installed
reproducibly from one portable manifest and removable without residue.

```bash
npx github:VincenzoImp/arcwell#v0.3.2 setup --dry-run --write-manifest arcwell.json
# read arcwell.json and the plan, then:
npx github:VincenzoImp/arcwell#v0.3.2 setup --manifest arcwell.json --yes
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
| **Working agreement** | Precedence, evidence, communication, code style, competence gate, discretion — merged as one marked block into your `AGENTS.md`, never overwriting it |
| **Skills** | `scope-check` `code-review` `debug` `web` `grilling` `research` `planning` `tdd` `implementing` `delegating` `verification` `domain-modeling` `handoff` `prototype` `version-control` — only descriptions sit in context; bodies load on demand |
| **Subagents** | `scout` `planner` `worker` `reviewer`, running on `pi-subagents` with background and parallel dispatch. The reviewer reads the diff, never a description of it |
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

Setup, doctor, uninstall and dry run never call a model.

## What the guards are, and are not

Effects and secret-path matching inspect command text and supported tool results. They catch
mistakes; they are not a sandbox, complete shell enforcement, or an authorization boundary.
Dynamic variables, substitutions, generated commands and pre-existing scripts can evade static
matching. Stronger enforcement needs OS isolation, which Arcwell does not provide.

Installing any Pi package runs code with your permissions. Inspect the source, `package.json`,
dependency tree, `LICENSE` and `NOTICE` before installing — including this one.

## Uninstall

```bash
arcwell doctor --json     # what the current state is
arcwell uninstall --yes
```

Removes only exact package sources it recorded as installed, its marked agreement block, and
managed files that still match byte-for-byte what it wrote. A file you have since edited is
kept and reported: Arcwell does not delete work it did not write. Pi, credentials, sessions,
trust state, pre-existing packages and unrelated bytes are untouched.

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
`uninstall` — passes against a real Pi on Linux, macOS and Windows, in CI, on every tag.

One test is skipped on Windows: forcing a filesystem cleanup failure needs POSIX permission
semantics. Everything else runs everywhere.

MIT. `NOTICE` records the redistributed MIT work from Pi's own examples.
