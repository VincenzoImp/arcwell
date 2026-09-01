import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  version: "0.4.0",
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
