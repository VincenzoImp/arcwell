/**
 * Every pinned version against what the registry currently publishes.
 *
 * The pins are exact on purpose — a setup has to compose the same environment twice — but exact
 * pins age silently. This is the thing that notices. It changes nothing; it reports, and exits
 * non-zero so a scheduled run is a signal rather than a log entry.
 *
 * `--json` prints machine-readable drift for anything that wants to act on it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

const load = async (relativePath) =>
  import(pathToFileURL(join(repositoryRoot, "dist", "src", "setup", relativePath)).href);
const { PACKAGE_CATALOG } = await load("catalog.js");
const { COMPATIBLE_PI_VERSION } = await load("pi-version.js");

const manifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

/** `npm view` rather than the registry API: it already honours the caller's registry config. */
function publishedVersion(name) {
  try {
    return execFileSync("npm", ["view", name, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** `npm:@scope/name@1.2.3` -> `["@scope/name", "1.2.3"]`. */
function splitNpmSource(source) {
  const body = source.replace(/^npm:/, "");
  const at = body.lastIndexOf("@");
  return [body.slice(0, at), body.slice(at + 1)];
}

const pinned = [
  ["@earendil-works/pi-coding-agent", COMPATIBLE_PI_VERSION],
  ...PACKAGE_CATALOG.map((entry) => splitNpmSource(entry.source)),
  ...Object.entries(manifest.dependencies ?? {}),
  ...Object.entries(manifest.devDependencies ?? {}),
];

const drifted = [];
const unreachable = [];
for (const [name, current] of pinned) {
  const latest = publishedVersion(name);
  if (latest === undefined) unreachable.push(name);
  else if (latest !== current) drifted.push({ name, current, latest });
}

if (asJson) {
  console.log(JSON.stringify({ drifted, unreachable }, null, 2));
} else {
  for (const { name, current, latest } of drifted) console.log(`${name}: ${current} -> ${latest}`);
  for (const name of unreachable) console.log(`${name}: could not be read from the registry`);
  if (drifted.length === 0 && unreachable.length === 0) {
    console.log(`All ${pinned.length} pinned versions are the currently published ones.`);
  }
}

// Unreachable is not drift, but it is not a pass either: a pin nobody could check is unchecked.
process.exitCode = drifted.length > 0 || unreachable.length > 0 ? 1 : 0;
