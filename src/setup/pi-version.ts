/**
 * The one Pi version this Arcwell targets, and the two places that have to agree about it.
 *
 * The host Pi is whatever `pi --version` reports. The nested copy is the one npm installs into
 * the Arcwell package root to satisfy the peer dependency; `preset.ts`, `tools.ts` and
 * `agent-dir.ts` import values — not just types — and Node resolves those from the nested copy
 * rather than from the host. Two different versions there means two module instances of the
 * same class, which is how `DynamicBorder` stops rendering.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const COMPATIBLE_PI_VERSION = "0.84.4";

/** Pulls the version out of `pi --version` output, which carries other text around it. */
export function normalizedPiVersion(output: string): string | undefined {
  const match = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/.exec(output);
  return match?.[1];
}

/** The Pi version resolved from inside an installed Arcwell, or undefined when absent. */
export function nestedPiVersion(packageRoot: string): string | undefined {
  const manifest = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  if (!existsSync(manifest)) return undefined;
  try {
    const version: unknown = JSON.parse(readFileSync(manifest, "utf8")).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
