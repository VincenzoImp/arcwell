/**
 * Classifies a shell command by the irreversible remote effect it would cause:
 * a push, a merge, a published release, a deploy.
 *
 * Effects and secret-command scanning inspect command text. They are guardrails against
 * mistakes, not a sandbox or complete shell enforcement. `g=push; git $g` gets through,
 * as can dynamic variables and scripts written before execution. Reliable enforcement for
 * dynamic commands requires OS isolation, which Arcwell v1 intentionally excludes.
 */

export type Effect = "git.push" | "github.write" | "release.publish" | "deploy.execute";

export interface RemoteEffect {
  readonly effect: Effect;
  /** Human-readable action, for the prompt and the refusal message. */
  readonly action: string;
}

/**
 * Remove the body of every heredoc, keeping the line that opens it.
 *
 * A heredoc body is data, not commands. Without this, `cat > RELEASING.md <<'EOF'` followed
 * by `git push origin main` classified as a push: the file was never written, nothing
 * reached a remote, and the refusal said otherwise.
 */
function stripHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    out.push(line);

    // `<<` only opens a heredoc outside quotes and outside a comment. Scanning the raw text
    // made `printf 'cout << "hi"' > demo.cpp` open one, and everything after it — including
    // a `git push` on the next line — was deleted before anything looked at it.
    let quote: '"' | "'" | undefined;
    let opener: RegExpExecArray | null = null;
    const openers: RegExpExecArray[] = [];
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c]!;
      if (quote) { if (ch === quote) quote = undefined; else if (ch === "\\" && quote === '"') c += 1; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "\\") { c += 1; continue; }
      if (ch === "#" && (c === 0 || /\s/.test(line[c - 1]!))) break;
      if (ch === "<" && line[c + 1] === "<") {
        const candidate = /^<<(-?)\s*(?:"([^"]*)"|'([^']*)'|\\([A-Za-z_][^\s<>|;&()]*)|([A-Za-z_][^\s<>|;&"'()]*))/.exec(line.slice(c));
        // Keep looking: `echo $((1<<2)); cat <<EOF` has a shift before the real opener, and
        // a line may open two heredocs. Every opener is collected and their bodies are
        // consumed in the order they were opened, which is what bash does. `<<<` needs no
        // special case: it never yields a delimiter, and an unterminated guess strips
        // nothing anyway.
        if (candidate) { opener = candidate; openers.push(candidate); }
        c += 1;
        continue;
      }
    }
    if (!opener) continue;

    // Find the terminator first. If there is none, this was not a heredoc after all —
    // an unterminated guess would swallow the rest of the command, which is precisely the
    // wrong way to be wrong.
    let close = i;
    let consumed = 0;
    for (const each of openers) {
      const eachDashed = each[1] === "-";
      const eachDelimiter = each[2] ?? each[3] ?? each[4] ?? each[5] ?? "";
      if (eachDelimiter === "") continue;
      const endsEach = (candidate: string) =>
        eachDashed ? candidate.replace(/^\t+/, "") === eachDelimiter : candidate === eachDelimiter;
      let scan = close + 1;
      while (scan < lines.length && !endsEach(lines[scan]!)) scan += 1;
      if (scan >= lines.length) break;
      close = scan;
      consumed += 1;
    }
    // Every body has to be terminated, or this was not a heredoc after all and stripping
    // would swallow real commands.
    if (consumed !== openers.length) continue;
    i = close;
  }
  return out.join("\n");
}

/** Split on `;`, `&&`, `||`, `|` and newlines, ignoring separators inside quotes. */
function segments(command: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  // A backslash-newline is a line continuation: the shell removes it before splitting,
  // so `git \<newline>push` is one command and must be read as one.
  const text = stripHeredocBodies(command.replace(/\\\r?\n/g, ""));

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      current += char;
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && i + 1 < text.length) current += text[i += 1];
      continue;
    }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === "\\" && i + 1 < text.length) { current += char + text[i += 1]; continue; }
    // A comment runs to end of line and is not arguments. `git push origin main # --help`
    // otherwise carried a word that disabled the segment.
    if (char === "#" && (i === 0 || /\s/.test(text[i - 1]!))) {
      while (i < text.length && text[i] !== "\n") i += 1;
      i -= 1;
      continue;
    }
    if (char === "(" || char === ")" || char === "{" || char === "}") {
      out.push(current);
      current = "";
      continue;
    }
    if (char === "&" && text[i + 1] !== "&") {
      // Part of a redirection (`2>&1`, `>&2`, `&>log`) rather than a separator. Splitting
      // there would cut `2>&1 git push` in half and lose the command.
      const previous = text[i - 1];
      if (previous === ">" || previous === "<" || text[i + 1] === ">") { current += char; continue; }
    }
    if (char === "\n" || char === ";" || char === "|" || char === "&") {
      out.push(current);
      current = "";
      if ((char === "|" || char === "&") && text[i + 1] === char) i += 1;
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.filter((segment) => segment.trim() !== "");
}

/** Decode `$'...'`, which spells a word without using its letters. */
function ansiC(text: string, start: number): { value: string; end: number } {
  let value = "";
  let i = start;
  while (i < text.length && text[i] !== "'") {
    if (text[i] === "\\" && i + 1 < text.length) {
      const escape = text[i + 1]!;
      const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", v: "\v", e: "\x1b" };
      if (escape in simple) { value += simple[escape]; i += 2; continue; }
      if (escape === "x") {
        const hex = /^[0-9a-fA-F]{1,2}/.exec(text.slice(i + 2));
        if (hex) { value += String.fromCharCode(parseInt(hex[0], 16)); i += 2 + hex[0].length; continue; }
      }
      const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1));
      if (octal) { value += String.fromCharCode(parseInt(octal[0], 8)); i += 1 + octal[0].length; continue; }
      value += escape;
      i += 2;
      continue;
    }
    value += text[i];
    i += 1;
  }
  return { value, end: i };
}

const REDIRECTION = /^(?:\d*(?:>>|>&|<&|<<<|<<|>|<)|&>>|&>)/;

/** The words of one segment, quotes removed and redirections lifted out. */
function words(segment: string): string[] {
  const out: string[] = [];
  let current = "";
  let started = false;
  let pendingRedirection = false;

  // A redirection target is dropped, not treated as a word. The flag survives the
  // whitespace between the operator and its target, so `< /dev/null git push` keeps `git`
  // in the command position instead of `<`.
  const flush = () => {
    if (started) {
      if (!pendingRedirection) out.push(current);
      pendingRedirection = false;
    }
    current = "";
    started = false;
  };

  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]!;
    if (char === "$" && segment[i + 1] === "'") {
      const decoded = ansiC(segment, i + 2);
      current += decoded.value;
      started = true;
      i = decoded.end;
      continue;
    }
    if (char === "'") {
      const end = segment.indexOf("'", i + 1);
      const stop = end < 0 ? segment.length : end;
      current += segment.slice(i + 1, stop);
      started = true;
      i = stop;
      continue;
    }
    if (char === '"') {
      let cursor = i + 1;
      while (cursor < segment.length && segment[cursor] !== '"') {
        if (segment[cursor] === "\\" && cursor + 1 < segment.length) { current += segment[cursor + 1]; cursor += 2; continue; }
        current += segment[cursor];
        cursor += 1;
      }
      started = true;
      i = cursor;
      continue;
    }
    if (char === "\\" && i + 1 < segment.length) { current += segment[i += 1]; started = true; continue; }
    if (/\s/.test(char)) { flush(); continue; }

    // `> out.txt git push` and `2>&1 git push` both put the redirection first. Dropping the
    // operator and its target keeps `git` in the command position.
    const redirection = REDIRECTION.exec(segment.slice(i));
    if (redirection) {
      if (started && /^\d+$/.test(current)) { current = ""; started = false; }
      flush();
      pendingRedirection = true;
      i += redirection[0].length - 1;
      continue;
    }
    current += char;
    started = true;
  }
  flush();
  return out;
}

/** Shell keywords that introduce a command rather than being one. */
// `time` is deliberately absent: it takes options (`time -p`), so it belongs in the wrapper
// table where those are stripped. Listing it here removed the word and left `-p` as the
// program.
const KEYWORDS = new Set(["if", "then", "elif", "else", "fi", "while", "until", "for", "do",
  "done", "case", "esac", "select", "function", "!", "coproc"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Wrappers that run another program: the real command is further along the line. */
// Object.create(null) rather than a literal: a literal answers for `toString`,
// `constructor`, `__proto__` and every other Object.prototype key, so a program with one of
// those names produced a truthy wrapper with no `valued` and threw a TypeError out of the
// hook, which has no try around it.
const WRAPPER_OPTIONS: Record<string, { valued: readonly string[]; duration?: true }> = Object.assign(Object.create(null), {
  env: { valued: ["-C", "--chdir", "-u", "--unset", "-S", "--split-string"] },
  command: { valued: [] },
  exec: { valued: ["-a"] },
  sudo: { valued: [
    "-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from",
    "-h", "--host", "-r", "--role", "-t", "--type", "-D", "--chdir",
  ] },
  doas: { valued: ["-u", "-C"] },
  nohup: { valued: [] },
  nice: { valued: ["-n"] },
  ionice: { valued: ["-c", "-n", "-p"] },
  stdbuf: { valued: ["-i", "-o", "-e"] },
  setsid: { valued: [] },
  timeout: { valued: ["-s", "--signal", "-k", "--kill-after"], duration: true },
  time: { valued: ["-f", "--format", "-o", "--output"] },
  xargs: { valued: ["-n", "-P", "-I", "-d", "-E", "-s", "-L", "-a"] },
  // `npx vercel deploy` is how a deploy CLI is run when it is not installed globally.
  npx: { valued: ["-p", "--package", "-c", "--call"] },
  bunx: { valued: [] },
});

/** `vercel@latest` is `vercel`: `npx` and friends take a version-pinned package name. */
const stripVersion = (word: string) => {
  const at = word.lastIndexOf("@");
  return at > 0 ? word.slice(0, at) : word;
};
const basename = (word: string) => stripVersion(word.split("/").pop() ?? word);

/** Program name and argv for one segment, with assignments and wrappers peeled off. */
function invocation(segment: string): { program: string; argv: string[]; nestedCommand?: string } {
  let argv = words(segment);
  let nestedCommand: string | undefined;
  for (let guard = 0; guard < 12; guard += 1) {
    while (argv.length > 0 && ASSIGNMENT.test(argv[0]!)) argv = argv.slice(1);
    // `for r in a b; do git push $r; done` splits into `do git push $r`, and without this
    // the program reads as `do`.
    if (argv.length > 0 && KEYWORDS.has(basename(argv[0]!))) {
      const keyword = basename(argv[0]!);
      argv = argv.slice(1);
      // `for NAME in …` and `case WORD in …`: everything up to `in` is the loop variable.
      if (keyword === "for" || keyword === "select" || keyword === "case") {
        const inIndex = argv.indexOf("in");
        argv = inIndex >= 0 ? argv.slice(inIndex + 1) : [];
      }
      continue;
    }
    const program = basename(argv[0] ?? "");
    const wrapper = WRAPPER_OPTIONS[program];
    if (!wrapper) return nestedCommand === undefined
      ? { program, argv }
      : { program, argv, nestedCommand };
    argv = argv.slice(1);
    while (argv.length > 0 && argv[0]!.startsWith("-")) {
      const option = argv[0]!;
      argv = argv.slice(1);
      if (program === "npx" && option.startsWith("--call=")) nestedCommand = option.slice("--call=".length);
      if (wrapper.valued.includes(option) && argv.length > 0) {
        if (program === "npx" && (option === "-c" || option === "--call")) nestedCommand = argv[0];
        argv = argv.slice(1);
      }
    }
    // `timeout 30 cmd` and `timeout 1m cmd` put the duration where the program would be.
    if (wrapper.duration && argv.length > 0 && /^\d+(?:\.\d+)?[smhd]?$/.test(argv[0]!)) argv = argv.slice(1);
  }
  const program = basename(argv[0] ?? "");
  return nestedCommand === undefined
    ? { program, argv }
    : { program, argv, nestedCommand };
}

/** The non-option words after `sub`, with the values of valued options skipped. */
function remainingWords(argv: readonly string[], sub: string | undefined, valued: ReadonlySet<string>): string[] {
  if (sub === undefined) return [];
  const out: string[] = [];
  let i = argv.indexOf(sub) + 1;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token.startsWith("-")) { i += valued.has(token) ? 2 : 1; continue; }
    out.push(token);
    i += 1;
  }
  return out;
}

/**
 * The first non-option word after the program name, so that
 * `git -c alias.p=push -C /tmp push` reads as the `push` subcommand.
 */
function subcommand(argv: readonly string[], valued: ReadonlySet<string>): string | undefined {
  let i = 1;
  while (i < argv.length) {
    const token = argv[i]!;
    if (!token.startsWith("-")) return token;
    i += valued.has(token) ? 2 : 1;
  }
  return undefined;
}

const GIT_VALUED = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const KUBE_VALUED = new Set(["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "--as", "--server"]);
const DOCKER_VALUED = new Set(["--context", "--config", "-H", "--host", "--log-level", "-f", "--file",
  "-p", "--project-name", "--tlscacert", "--tlscert", "--tlskey"]);
/** `gh release list` reads; `gh release create` publishes. Same for workflow and cache. */
const GH_READ_VERBS = new Set(["list", "view", "download", "ls", "watch", "status", "checks",
  "diff", "checkout", "browse", "get", "clone", "show"]);
const GH_VALUED = new Set(["-R", "--repo", "--hostname", "--jq", "-q", "--template", "-t"]);
/** npm/pnpm/yarn/bun flags that take a separate word: monorepo publishing depends on them. */
const PACKAGE_VALUED = new Set(["--filter", "-F", "--workspace", "-w", "--prefix", "-C", "--dir",
  "--registry", "--tag", "--access", "--otp", "--cwd", "--config"]);
const PUBLISHERS = new Set(["npm", "pnpm", "yarn", "bun", "cargo", "gem", "twine", "poetry"]);
/** Flags that make any command print something and change nothing. */
const INFORMATIONAL = new Set(["--version", "--help", "--usage", "-h"]);
/** Flags that make a command describe what it would do instead of doing it. */
const SIMULATED = new Set(["--dry-run", "--dryrun"]);

// `heroku` deploys through `git push heroku`, which the git rule already catches, so it is
// not here: its presence only produced false refusals.
const DEPLOYERS = new Set(["vercel", "netlify", "fly", "flyctl", "railway", "wrangler", "sst", "serverless", "sls", "eb"]);

/** Extract a command passed through a shell or PowerShell command-string wrapper. */
function shellCommand(program: string, argv: readonly string[]): string | undefined {
  const executable = program.toLowerCase();
  if (["sh", "bash", "dash", "zsh", "ksh"].includes(executable)) {
    const at = argv.findIndex((word, index) => index > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
    return at >= 0 ? argv[at + 1] : undefined;
  }
  if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(executable)) {
    const at = argv.findIndex((word, index) => index > 0 && ["-c", "-command"].includes(word.toLowerCase()));
    return at >= 0 ? argv.slice(at + 1).join(" ") : undefined;
  }
  if (executable === "cmd" || executable === "cmd.exe") {
    const at = argv.findIndex((word, index) => index > 0 && word.toLowerCase() === "/c");
    return at >= 0 ? argv.slice(at + 1).join(" ") : undefined;
  }
  return undefined;
}

/** The remote effect this command would cause, or `undefined` if it stays local. */
export function assessRemoteEffect(command: string, depth = 0): RemoteEffect | undefined {
  // A package runner can name another runner; without a bound, a repeated `npm exec` costs
  // seconds and then overflows the stack, inside a hook with no try around it.
  if (depth > 8) return undefined;
  if (typeof command !== "string") return undefined;
  for (const segment of segments(command)) {
    const { program, argv, nestedCommand } = invocation(segment);
    if (nestedCommand) {
      const nestedEffect = assessRemoteEffect(nestedCommand, depth + 1);
      if (nestedEffect) return nestedEffect;
    }
    const wrappedShellCommand = shellCommand(program, argv);
    if (wrappedShellCommand) {
      const nestedEffect = assessRemoteEffect(wrappedShellCommand, depth + 1);
      if (nestedEffect) return nestedEffect;
    }
    if (program === "") continue;

    // A simulation and a request for help reach nothing. Refusing them says, untruthfully,
    // that the command would publish or deploy — and headless there is no prompt to answer,
    // so the only way past is the switch that turns the whole guard off.
    // `helm upgrade --version 1.2.3` pins a chart version; the flag is not a request for
    // helm's own version. Only an invocation that is nothing but informational flags counts.
    const informational = argv.length > 1
      && argv.slice(1).every((w) => INFORMATIONAL.has(w))
      && argv.slice(1).some((w) => w !== "-h");
    // `--dry-run=false` and `--dry-run=0` mean "actually do it", the same as kubectl's
    // `--dry-run=none`, and npm resolves `--dry-run=false` to a real publish.
    const simulated = argv.some((w) => SIMULATED.has(w)
      // kubectl parses this with strconv.ParseBool, so F, f, False and FALSE all mean
      // "really do it" — as does `none`. Anything else is a simulation.
      || (w.startsWith("--dry-run=") && !["none", "false", "f", "0"].includes(w.slice(10).toLowerCase())));
    if (informational || simulated
      || argv.includes("--help") || argv.includes("--usage")
      || argv.includes("-h") || argv.includes("-help")) continue;

    if (program === "git") {
      const sub = subcommand(argv, GIT_VALUED);
      if (sub === "push") return { effect: "git.push", action: "push to a remote" };
      if (sub === "subtree" && argv.includes("push")) return { effect: "git.push", action: "git subtree push" };
      // A merge into an integration branch changes shared history; a merge into the current
      // feature branch does not. The string does not say which, so it asks.
      // --abort and --continue are the way out of a conflicted merge. Refusing them strands
      // a headless agent mid-conflict with no in-session recovery.
      if ((sub === "merge" || sub === "cherry-pick") && !argv.some((w) => w === "--abort" || w === "--continue" || w === "--quit" || w === "--skip")) {
        return { effect: "github.write", action: `git ${sub}` };
      }
    }

    if (program === "gh") {
      const sub = subcommand(argv, GH_VALUED);
      // The verb comes after the subcommand, skipping option words and their values —
      // `gh release -R owner/repo list` must read as `list`, not as `owner/repo`.
      const rest = remainingWords(argv, sub, GH_VALUED);
      if (sub === "pr") {
        const action = rest[0];
        if (action === "merge" || action === "create") {
          return { effect: "github.write", action: `gh pr ${action}` };
        }
      }
      const verb = rest[0];
      if (sub === "release" && verb && !GH_READ_VERBS.has(verb)) {
        return { effect: "release.publish", action: `gh release ${verb}` };
      }
      if (sub === "repo" && (verb === "delete" || verb === "create" || verb === "fork" || verb === "archive")) {
        return { effect: "github.write", action: `gh repo ${verb}` };
      }
      if ((sub === "issue" || sub === "gist" || sub === "secret" || sub === "variable"
           || sub === "label" || sub === "cache" || sub === "run") && verb && !GH_READ_VERBS.has(verb)) {
        return { effect: "github.write", action: `gh ${sub} ${verb}` };
      }
      if (sub === "pr" && verb && !GH_READ_VERBS.has(verb) && verb !== "checkout" && verb !== "diff"
          && verb !== "status" && verb !== "checks") {
        return { effect: "github.write", action: `gh pr ${verb}` };
      }
      if (sub === "workflow" && verb && !GH_READ_VERBS.has(verb)) {
        return { effect: "github.write", action: `gh workflow ${verb}` };
      }
      // `gh api` defaults to GET; only an explicit write method changes anything.
      if (sub === "api") {
        const inline = argv.find((w) => w.startsWith("--method=") || /^-X./.test(w));
        const methodIndex = argv.findIndex((w) => w === "-X" || w === "--method");
        const explicit = inline
          ? inline.replace(/^--method=|^-X/, "").toUpperCase()
          : methodIndex >= 0 ? (argv[methodIndex + 1] ?? "").toUpperCase() : "";
        // `gh api --help`: "The default HTTP request method is GET normally and POST if any
        // parameters were added." So a field makes it a write even with no -X.
        // `gh api --help`: POST when parameters were added. cli/cli treats --input the same
        // way (`len(params) > 0 || opts.RequestInputFile != ""`).
        const hasField = argv.some((w) => ["-f", "--field", "-F", "--raw-field", "--input"].includes(w)
          || /^-[fF]./.test(w) || w.startsWith("--input="));
        const method = explicit || (hasField ? "POST" : "GET");
        if (method !== "GET" && method !== "HEAD") return { effect: "github.write", action: `gh api ${method}` };
      }
    }

    if (PUBLISHERS.has(program)) {
      const sub = subcommand(argv, PACKAGE_VALUED);
      const after = remainingWords(argv, sub, PACKAGE_VALUED);
      // `npm owner ls`, `npm access list` and `npm dist-tag ls` read. Only the write verbs
      // of those families publish anything.
      const READ_VERBS = new Set(["ls", "list", "get", "status", "view", "info"]);
      if (["unpublish", "deprecate", "yank"].includes(sub ?? "")) {
        return { effect: "release.publish", action: `${program} ${sub}` };
      }
      if (["owner", "access", "dist-tag"].includes(sub ?? "")) {
        // `gem owner mygem` lists; only an explicit add/remove writes.
        const writes = argv.some((w) => ["-a", "--add", "-r", "--remove"].includes(w));
        const lists = argv.some((w) => ["--list", "-l"].includes(w));
        const verb = after[0];
        // `cargo owner <crate>` with no verb lists the owners, the same as `gem owner`.
        const listsByDefault = program === "gem" || program === "cargo";
        const writeVerb = verb !== undefined && !READ_VERBS.has(verb)
          && !lists && !listsByDefault;
        if (writes || writeVerb) {
          return { effect: "release.publish", action: `${program} ${sub}` };
        }
      }
      if (sub === "publish" || (program === "twine" && sub === "upload")
          || (program === "gem" && sub === "push")
          || (program === "yarn" && sub === "npm" && after[0] === "publish")) {
        return { effect: "release.publish", action: `${program} publish` };
      }
    }

    if (DEPLOYERS.has(program)) {
      const sub = subcommand(argv, new Set());
      // A bare `vercel` deploys and so does `vercel --prod`; `vercel --version` never
      // reaches here, because the informational skip above returns first. Only vercel
      // deploys from a bare invocation — the others print usage.
      if ((sub === undefined && program === "vercel")
          || sub === "deploy" || sub === "up" || sub === "publish" || sub === "launch") {
        return { effect: "deploy.execute", action: `${program} ${sub ?? "deploy"}` };
      }
    }

    if (program === "docker" || program === "podman") {
      const sub = subcommand(argv, DOCKER_VALUED);
      // `docker image push` is the modern spelling of `docker push`, and the docs use it.
      const rest = remainingWords(argv, sub, DOCKER_VALUED);
      const pushesBuild = argv.some((word) => word === "--push" || word === "--push=true");
      if (sub === "push" || ((sub === "image" || sub === "manifest" || sub === "compose") && rest[0] === "push")
          || ((sub === "buildx" || sub === "build") && pushesBuild)) {
        return { effect: "release.publish", action: `${program} push` };
      }
    }

    // `pnpm dlx` and `yarn dlx` are two words, so they are peeled here rather than in the
    // wrapper table, which keys on a single program name.
    // `npm exec`, `bun x`, `pnpm dlx`, `yarn dlx`: the documented equivalents of npx.
    // Re-assessed from the argv slice rather than a re-joined string, so a quoted argument
    // containing `;` is not re-split into a command that was never there.
    const RUNNER_VERBS: Record<string, string> = Object.assign(Object.create(null),
      { pnpm: "dlx", yarn: "dlx", npm: "exec", bun: "x" });
    const runnerVerb = RUNNER_VERBS[program];
    if (runnerVerb) {
      // The verb has to be the subcommand, not a word that appears later: `npm test --grep
      // exec vercel deploy` peeled from the wrong place and invented a deploy.
      const at = subcommand(argv, PACKAGE_VALUED) === runnerVerb ? argv.indexOf(runnerVerb) : -1;
      if (at > 0) {
        let inner = argv.slice(at + 1).filter((w) => w !== "--");
        // Strip the runner's own flags, the way the npx wrapper entry already does.
        const RUNNER_VALUED = new Set(["-p", "--package", "-c", "--call", "--prefix", "-C"]);
        while (inner.length > 0 && inner[0]!.startsWith("-")) {
          const flag = inner[0]!;
          inner = inner.slice(RUNNER_VALUED.has(flag) ? 2 : 1);
        }
        if (inner.length > 0) {
          const nested = assessRemoteEffect(
            inner.map((w) => `'${w.split("'").join("'\\''")}'`).join(" "), depth + 1);
          if (nested) return nested;
        }
      }
    }

    if (program === "kubectl" || program === "helm") {
      const sub = subcommand(argv, KUBE_VALUED);
      if (sub === "create" || sub === "replace" || sub === "patch" || sub === "scale"
          || sub === "set" || sub === "edit" || sub === "drain" || sub === "cordon"
          || sub === "apply" || sub === "delete" || sub === "install" || sub === "upgrade"
          || (program === "helm" && (sub === "uninstall" || sub === "rollback" || sub === "push"))) {
        return { effect: "deploy.execute", action: `${program} ${sub}` };
      }
      // `rollout status` and `rollout history` read; restart/undo/pause/resume change things.
      if (sub === "rollout") {
        const rest = argv.slice(argv.indexOf(sub) + 1);
        const verb = rest[0];
        if (verb && verb !== "status" && verb !== "history") {
          return { effect: "deploy.execute", action: `${program} rollout ${verb}` };
        }
      }
    }

    if (program === "terraform" || program === "tofu") {
      const sub = subcommand(argv, new Set(["-chdir"]));
      if (sub === "apply" || sub === "destroy" || sub === "import") {
        return { effect: "deploy.execute", action: `${program} ${sub}` };
      }
      if (sub === "state") {
        const verb = remainingWords(argv, sub, new Set(["-state", "-backup"]))[0];
        if (verb === "push" || verb === "rm" || verb === "mv" || verb === "replace-provider") {
          return { effect: "deploy.execute", action: `${program} state ${verb}` };
        }
      }
    }
  }
  return undefined;
}
