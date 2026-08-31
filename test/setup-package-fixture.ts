import { join } from "node:path";

import type { PiPackage } from "../src/setup/pi-client.js";

export const validArcwellPackageDir = join(
  process.cwd(),
  "test",
  "fixtures",
  "pi-packages",
  "arcwell",
);

const externalPackageDir = join(
  process.cwd(),
  "test",
  "fixtures",
  "pi-packages",
  "external",
);

export function fixtureInstalledPath(source: string): string {
  return source === "npm:arcwell@0.1.0" ? validArcwellPackageDir : externalPackageDir;
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
