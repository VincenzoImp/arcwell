/**
 * Every pinned version against what the registry currently publishes.
 *
 * The pins are exact on purpose — a setup has to compose the same environment twice — but exact
 * pins age silently. This is the thing that notices. It changes nothing; it reports, and exits
 * non-zero so a scheduled run is a signal rather than a log entry.
 *
 * It reports three things a version number alone cannot:
 *
 * - **drift**, a newer version exists;
 * - **republish**, the *pinned* version no longer serves the bytes that were audited, which is
 *   the case a version number is structurally unable to show;
 * - **staleness**, no release in months. `pi-claude-cli` looked exactly like that for five of
 *   them, on the billing path, while nobody was watching.
 *
 * `--json` prints machine-readable findings for anything that wants to act on them.
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

/** Days after which a package with no release is worth a second look before trusting it. */
const STALE_DAYS = 120;

/** `npm view` rather than the registry API: it already honours the caller's registry config. */
function view(spec, field) {
  try {
    return execFileSync("npm", ["view", spec, field], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

const publishedVersion = (name) => view(name, "version");

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

// Republished artifacts: the pin still names the same release, but the registry now serves
// different bytes than the ones recorded in the catalog.
const republished = [];
for (const entry of PACKAGE_CATALOG) {
  const actual = view(entry.source.replace(/^npm:/, ""), "dist.integrity");
  if (actual === undefined) continue;
  if (actual !== entry.integrity) republished.push({ source: entry.source, expected: entry.integrity, actual });
}

// Staleness is not a defect, and this never fails on it — it is the signal that a dependency
// may have stopped having a maintainer, which is a decision for a person to make.
const stale = [];
for (const entry of PACKAGE_CATALOG) {
  const name = entry.source.replace(/^npm:/, "").replace(/@[^@]+$/, "");
  const modified = view(name, "time.modified");
  if (!modified) continue;
  const days = Math.floor((Date.now() - Date.parse(modified)) / 86400000);
  if (days > STALE_DAYS) stale.push({ name, days, lastRelease: modified.slice(0, 10) });
}

if (asJson) {
  console.log(JSON.stringify({ drifted, republished, stale, unreachable }, null, 2));
} else {
  for (const { source, actual } of republished) {
    console.log(`REPUBLISHED ${source}: the registry now serves ${actual}, not the audited bytes`);
  }
  for (const { name, current, latest } of drifted) console.log(`${name}: ${current} -> ${latest}`);
  for (const name of unreachable) console.log(`${name}: could not be read from the registry`);
  for (const { name, days, lastRelease } of stale) {
    console.log(`stale: ${name} has had no release for ${days} days (last ${lastRelease})`);
  }
  if (drifted.length === 0 && republished.length === 0 && unreachable.length === 0) {
    console.log(`All ${pinned.length} pinned versions are the currently published ones, with the audited bytes.`);
  }
}

// Staleness is deliberately not a failure: it is information, and a package can be finished
// rather than abandoned. A republished artifact is the opposite -- it means the pin stopped
// meaning what it said.
process.exitCode = drifted.length > 0 || republished.length > 0 || unreachable.length > 0 ? 1 : 0;
