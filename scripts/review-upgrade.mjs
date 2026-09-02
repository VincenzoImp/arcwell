/**
 * What actually changed between two published versions of a dependency.
 *
 * `check:updates` says a pin has aged. It does not say whether the new version added a
 * postinstall script, pulled in four dependencies, or rewrote the file that spawns processes —
 * and a bump accepted without knowing that is a bump accepted on the maintainer's reputation
 * alone. Five of the seven packages here are one person.
 *
 * Nothing is installed and no lifecycle script runs: both versions are fetched as tarballs with
 * `npm pack --ignore-scripts` and read.
 *
 *   npm run review:upgrade -- pi-subagents 0.62.0 0.63.0
 *   npm run review:upgrade -- pi-subagents 0.62.0 0.63.0 --diff
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const showDiff = argv.includes("--diff");
const [name, from, to] = argv.filter((argument) => argument !== "--diff");
if (!name || !from || !to) {
  throw new Error("Usage: node scripts/review-upgrade.mjs <package> <from> <to> [--diff]");
}

/** Text files past this are summarised rather than printed, so a bundle cannot bury the report. */
const MAX_DIFF_BYTES = 24 * 1024;
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack"];

const temporaryBase = join(repositoryRoot, ".tmp-tests");
mkdirSync(temporaryBase, { recursive: true });
const scratch = mkdtempSync(join(temporaryBase, "review-upgrade-"));
process.once("exit", () => rmSync(scratch, { recursive: true, force: true }));

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Fetches and unpacks one version, returning its extracted `package/` directory. */
function fetchVersion(version) {
  const directory = join(scratch, version);
  mkdirSync(directory, { recursive: true });
  const output = run("npm", ["pack", `${name}@${version}`, "--ignore-scripts", "--json"], directory);
  const filename = JSON.parse(output)[0].filename;
  run("tar", ["xzf", filename], directory);
  return join(directory, "package");
}

function walk(root, base = root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path, base) : [relative(base, path).replaceAll("\\", "/")];
  });
}

const isProbablyText = (buffer) => !buffer.subarray(0, 8000).includes(0);

function fileMap(root) {
  return new Map(walk(root).map((path) => [path, readFileSync(join(root, path))]));
}

const oldRoot = fetchVersion(from);
const newRoot = fetchVersion(to);
const oldFiles = fileMap(oldRoot);
const newFiles = fileMap(newRoot);

const added = [...newFiles.keys()].filter((path) => !oldFiles.has(path)).sort();
const removed = [...oldFiles.keys()].filter((path) => !newFiles.has(path)).sort();
const changed = [...newFiles.keys()]
  .filter((path) => oldFiles.has(path) && !oldFiles.get(path).equals(newFiles.get(path)))
  .sort();

const oldManifest = JSON.parse(oldFiles.get("package.json").toString("utf-8"));
const newManifest = JSON.parse(newFiles.get("package.json").toString("utf-8"));
const oldDeps = oldManifest.dependencies ?? {};
const newDeps = newManifest.dependencies ?? {};

const sizeOf = (files) => [...files.values()].reduce((total, buffer) => total + buffer.length, 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

console.log(`${name}: ${from} -> ${to}\n`);
console.log(`files    ${added.length} added, ${removed.length} removed, ${changed.length} changed`);
console.log(`size     ${kb(sizeOf(oldFiles))} -> ${kb(sizeOf(newFiles))}`);

// The two things that change what runs on your machine rather than what it computes.
const newLifecycle = LIFECYCLE.filter((script) => newManifest.scripts?.[script] && !oldManifest.scripts?.[script]);
console.log(`lifecycle ${newLifecycle.length === 0
  ? "no new install scripts"
  : `NEW: ${newLifecycle.map((script) => `${script}=${newManifest.scripts[script]}`).join(", ")}`}`);

const addedDeps = Object.keys(newDeps).filter((dependency) => !(dependency in oldDeps));
const droppedDeps = Object.keys(oldDeps).filter((dependency) => !(dependency in newDeps));
const movedDeps = Object.keys(newDeps).filter((d) => d in oldDeps && oldDeps[d] !== newDeps[d]);
console.log(`deps     ${addedDeps.length === 0 && droppedDeps.length === 0 && movedDeps.length === 0
  ? "unchanged"
  : [
    addedDeps.length ? `added ${addedDeps.join(", ")}` : "",
    droppedDeps.length ? `dropped ${droppedDeps.join(", ")}` : "",
    movedDeps.length ? `moved ${movedDeps.map((d) => `${d} ${oldDeps[d]}->${newDeps[d]}`).join(", ")}` : "",
  ].filter(Boolean).join("; ")}`);

for (const [label, list] of [["added", added], ["removed", removed], ["changed", changed]]) {
  if (list.length === 0) continue;
  console.log(`\n${label}:`);
  for (const path of list) console.log(`  ${path}`);
}

if (showDiff) {
  for (const path of changed) {
    const before = oldFiles.get(path);
    const after = newFiles.get(path);
    if (!isProbablyText(before) || !isProbablyText(after)) {
      console.log(`\n--- ${path}: binary, ${before.length} -> ${after.length} bytes`);
      continue;
    }
    if (after.length > MAX_DIFF_BYTES) {
      console.log(`\n--- ${path}: ${kb(after.length)}, too large to print; read it in ${scratch}`);
      continue;
    }
    console.log(`\n--- ${path}`);
    try {
      run("diff", ["-u", join(oldRoot, path), join(newRoot, path)], scratch);
    } catch (error) {
      // diff exits 1 when files differ, which is the expected case here.
      process.stdout.write(error.stdout ?? "");
    }
  }
}

console.log("\nNothing was installed and no lifecycle script ran.");
