/**
 * Compares extensions/upstream against Pi's own examples in node_modules.
 *
 * Those files are redistributed rather than written here, and nothing else notices when Pi
 * ships a new version of them: they are not compiled, not type-checked, and the tests only
 * prove they load. Without this the fork is silent, and drift is found by a user hitting a
 * behaviour that upstream fixed a release ago.
 *
 * The leading block comment is expected to differ — each file carries a provenance header in
 * place of upstream's "copy this file to…" usage note (see NOTICE), so only the code below it
 * is compared.
 *
 * Usage: npm run check:upstream
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = join(repositoryRoot, "extensions", "upstream");
const upstreamRoot = join(
  repositoryRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "examples",
  "extensions",
);

/**
 * Files this repository changes on purpose, each with the reason NOTICE records. They are
 * reported rather than passed over silently, so a second unrelated change to one of them is
 * still visible.
 */
const INTENDED_CHANGES = new Map([
  ["plan-mode/index.ts", "registers /plan-todos, because todo.ts owns /todos"],
]);

/** Everything after the first block comment: the header is provenance, not code. */
function body(text) {
  const end = text.indexOf("*/");
  return (end < 0 ? text : text.slice(end + 2)).trim();
}

function typescriptFiles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts")) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

if (!existsSync(upstreamRoot)) {
  console.error(`Pi examples not found at ${upstreamRoot}; run npm install first.`);
  process.exit(2);
}

const drifted = [];
const missing = [];
const intended = [];
for (const localPath of typescriptFiles(localRoot)) {
  const relativePath = relative(localRoot, localPath).replaceAll("\\", "/");
  const upstreamPath = join(upstreamRoot, relativePath);
  if (!existsSync(upstreamPath)) {
    missing.push(relativePath);
    continue;
  }
  if (body(readFileSync(localPath, "utf8")) === body(readFileSync(upstreamPath, "utf8"))) continue;
  const reason = INTENDED_CHANGES.get(relativePath);
  if (reason) intended.push(`${relativePath} (${reason})`);
  else drifted.push(relativePath);
}

const piVersion = JSON.parse(
  readFileSync(join(repositoryRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json"), "utf8"),
).version;

if (missing.length > 0) {
  console.error(`Upstream no longer ships: ${missing.join(", ")}`);
}
if (drifted.length > 0) {
  console.error(`Code differs from Pi ${piVersion} examples: ${drifted.join(", ")}`);
  console.error("Review each difference, then either adopt upstream's version or record the change in NOTICE.");
}
if (missing.length > 0 || drifted.length > 0) process.exit(1);

for (const entry of intended) console.log(`Changed by design: ${entry}`);
console.log(`extensions/upstream matches the Pi ${piVersion} examples (headers and recorded changes excluded).`);
