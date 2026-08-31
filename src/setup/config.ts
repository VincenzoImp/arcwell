import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, basename, join, parse, resolve, sep } from "node:path";

import { assertNoDuplicateJsonProperties } from "./manifest.js";
import { protectionNames, type ProtectionName, type RuntimeConfig, type SetupManifest } from "./types.js";

export const MAX_RUNTIME_CONFIG_BYTES = 16 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function rejectUnknown(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}${path ? "." : ""}${unknown}: unknown property`);
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (!isRecord(value)) throw new Error("runtime config: expected an object");
  rejectUnknown("", value, ["schemaVersion", "posture", "protections"]);
  if (value.schemaVersion !== 1) throw new Error("schemaVersion: expected 1");
  if (value.posture !== "guarded" && value.posture !== "host") throw new Error("posture: expected guarded or host");
  if (!isRecord(value.protections)) throw new Error("protections: expected an object");
  const protectionsInput = value.protections;
  rejectUnknown("protections", protectionsInput, protectionNames);
  const protections = Object.fromEntries(protectionNames.map((name) => {
    if (typeof protectionsInput[name] !== "boolean") throw new Error(`protections.${name}: expected a boolean`);
    return [name, protectionsInput[name]];
  })) as Record<ProtectionName, boolean>;
  if (value.posture === "host" && protectionNames.some((name) => protections[name])) {
    throw new Error("posture host: all protections must be false");
  }
  return { schemaVersion: 1, posture: value.posture, protections };
}

export function parseRuntimeConfigJson(text: string): RuntimeConfig {
  if (Buffer.byteLength(text) > MAX_RUNTIME_CONFIG_BYTES) throw new Error("runtime config exceeds 16 KiB");
  try {
    assertNoDuplicateJsonProperties(text);
    return parseRuntimeConfig(JSON.parse(text) as unknown);
  } catch (error) {
    throw new Error(`runtime config: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function runtimeConfigFromManifest(manifest: SetupManifest): RuntimeConfig {
  return {
    schemaVersion: 1,
    posture: manifest.posture,
    protections: { ...manifest.protections },
  };
}

/** Reject existing symbolic links anywhere in a path before accessing Arcwell state. */
export function assertNoSymbolicLinkComponents(path: string, includeTarget = true): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  const limit = includeTarget ? components.length : Math.max(0, components.length - 1);
  let current = root;
  for (let index = 0; index < limit; index += 1) {
    current = join(current, components[index]!);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`runtime config path contains a symbolic link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
}

export function writeRuntimeConfigAtomic(path: string, config: RuntimeConfig): void {
  const parsed = parseRuntimeConfig(config);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  if (existsSync(path)) {
    const existing = lstatSync(path);
    if (!existing.isSymbolicLink() && existing.isFile() && readFileSync(path, "utf8") === serialized) return;
  }
  const directory = dirname(path);
  assertNoSymbolicLinkComponents(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(directory);

  let mode = 0o600;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`runtime config target is a symbolic link: ${path}`);
    if (!stat.isFile()) throw new Error(`runtime config target is not a regular file: ${path}`);
    mode = stat.mode & 0o777;
  }

  const temporary = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, serialized, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
