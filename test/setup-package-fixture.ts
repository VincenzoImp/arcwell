import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_CATALOG } from "../src/setup/catalog.js";
import { packageNameOf } from "../src/setup/integrity.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import type { PiPackage } from "../src/setup/pi-client.js";

export const validArcwellPackageDir = join(
  process.cwd(),
  ".tmp-tests",
  "package-fixtures",
  "arcwell",
);

const validArcwellManifest = {
  name: "arcwell",
  version: "0.6.0",
  type: "module",
  pi: {
    extensions: ["./dist/extensions/arcwell-protections.js"],
  },
};

function writeFixtureFile(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function materializeValidArcwellPackage(): void {
  const extensionDirectory = join(validArcwellPackageDir, "dist", "extensions");
  mkdirSync(extensionDirectory, { recursive: true });
  writeFixtureFile(
    join(validArcwellPackageDir, "package.json"),
    `${JSON.stringify(validArcwellManifest, null, 2)}\n`,
  );
  writeFixtureFile(
    join(extensionDirectory, "arcwell-protections.js"),
    "export default function arcwellProtections() {}\n",
  );
}

materializeValidArcwellPackage();

const externalPackageDir = join(
  process.cwd(),
  "test",
  "fixtures",
  "pi-packages",
  "external",
);

export function fixtureInstalledPath(source: string): string {
  return source === ARCWELL_PACKAGE_SOURCE ? validArcwellPackageDir : externalPackageDir;
}

export function fixturePiPackage(
  source: string,
  scope: PiPackage["scope"] = "user",
  filtered = false,
): PiPackage {
  return {
    source,
    scope,
    filtered,
    installedPath: fixtureInstalledPath(source),
  } as PiPackage;
}

/**
 * Writes the `.package-lock.json` npm produces for the given sources, so a fake install models
 * the one artefact integrity verification reads. A fake that skips it is not modelling npm.
 *
 * Pass `corrupt` to make one package's recorded hash differ, which is the tampering case.
 */
export function writeIntegrityLock(
  agentDir: string,
  sources: readonly string[],
  corrupt?: string,
): void {
  const packages: Record<string, { integrity: string }> = {};
  for (const source of sources) {
    const entry = PACKAGE_CATALOG.find((candidate) => candidate.source === source);
    if (!entry) continue;
    packages[`node_modules/${packageNameOf(entry.source)}`] = {
      integrity: entry.source === corrupt ? `sha512-${"A".repeat(86)}==` : entry.integrity,
    };
  }
  const directory = join(agentDir, "npm", "node_modules");
  mkdirSync(directory, { recursive: true });
  writeFixtureFile(join(directory, ".package-lock.json"), JSON.stringify({ packages }, null, 2));
}
