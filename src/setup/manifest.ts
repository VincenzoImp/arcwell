import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { moduleNames, protectionNames, type ModuleName, type ProtectionName, type SetupManifest } from "./types.js";

export const ARCWELL_VERSION = "0.3.1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function rejectUnknown(path: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${path}${path ? "." : ""}${unknown}: unknown property`);
}

function booleanRecord<T extends string>(
  path: string,
  value: unknown,
  names: readonly T[],
): Record<T, boolean> {
  if (!isRecord(value)) throw new Error(`${path}: expected an object`);
  rejectUnknown(path, value, names);
  return Object.fromEntries(names.map((name) => {
    if (typeof value[name] !== "boolean") throw new Error(`${path}.${name}: expected a boolean`);
    return [name, value[name]];
  })) as Record<T, boolean>;
}

export function createDefaultManifest(): SetupManifest {
  return {
    schemaVersion: 1,
    arcwellVersion: ARCWELL_VERSION,
    profile: "core",
    posture: "guarded",
    protections: { effects: true, secrets: true, redaction: true },
    providerGuidance: { claudeSubscription: true },
    modules: { lsp: true, context: true, mcp: true, subagents: true, goal: true },
  };
}

export function parseSetupManifest(value: unknown): SetupManifest {
  if (!isRecord(value)) throw new Error("manifest: expected a JSON object");
  rejectUnknown("", value, [
    "schemaVersion",
    "arcwellVersion",
    "profile",
    "posture",
    "protections",
    "providerGuidance",
    "modules",
  ]);
  if (value.schemaVersion !== 1) throw new Error(`schemaVersion: expected 1, found ${JSON.stringify(value.schemaVersion)}`);
  if (value.arcwellVersion !== ARCWELL_VERSION) {
    throw new Error(`arcwellVersion: expected ${ARCWELL_VERSION}, found ${JSON.stringify(value.arcwellVersion)}`);
  }
  if (value.profile !== "core") throw new Error(`profile: expected core, found ${JSON.stringify(value.profile)}`);
  if (value.posture !== "guarded" && value.posture !== "host") {
    throw new Error(`posture: expected guarded or host, found ${JSON.stringify(value.posture)}`);
  }

  const protections = booleanRecord<ProtectionName>("protections", value.protections, protectionNames);
  if (!isRecord(value.providerGuidance)) throw new Error("providerGuidance: expected an object");
  rejectUnknown("providerGuidance", value.providerGuidance, ["claudeSubscription"]);
  if (typeof value.providerGuidance.claudeSubscription !== "boolean") {
    throw new Error("providerGuidance.claudeSubscription: expected a boolean");
  }
  const modules = booleanRecord<ModuleName>("modules", value.modules, moduleNames);
  if (value.posture === "host" && protectionNames.some((name) => protections[name])) {
    throw new Error("posture host: all protections must be false");
  }

  return {
    schemaVersion: 1,
    arcwellVersion: ARCWELL_VERSION,
    profile: "core",
    posture: value.posture,
    protections,
    providerGuidance: { claudeSubscription: value.providerGuidance.claudeSubscription },
    modules,
  };
}

function skipWhitespace(text: string, state: { index: number }): void {
  while (/\s/.test(text[state.index] ?? "")) state.index += 1;
}

function scanString(text: string, state: { index: number }): string {
  const start = state.index;
  if (text[state.index] !== '"') throw new Error("invalid JSON object property");
  state.index += 1;
  let escaped = false;
  while (state.index < text.length) {
    const character = text[state.index++]!;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') return JSON.parse(text.slice(start, state.index)) as string;
  }
  throw new Error("unterminated JSON string");
}

function scanValue(text: string, state: { index: number }, path: string): void {
  skipWhitespace(text, state);
  if (text[state.index] === "{") {
    state.index += 1;
    const keys = new Set<string>();
    skipWhitespace(text, state);
    if (text[state.index] === "}") { state.index += 1; return; }
    while (state.index < text.length) {
      skipWhitespace(text, state);
      const key = scanString(text, state);
      const propertyPath = `${path}${path ? "." : ""}${key}`;
      if (keys.has(key)) throw new Error(`duplicate property: ${propertyPath}`);
      keys.add(key);
      skipWhitespace(text, state);
      if (text[state.index++] !== ":") throw new Error(`invalid JSON property: ${propertyPath}`);
      scanValue(text, state, propertyPath);
      skipWhitespace(text, state);
      const delimiter = text[state.index++];
      if (delimiter === "}") return;
      if (delimiter !== ",") throw new Error(`invalid JSON object: ${path || "manifest"}`);
    }
    throw new Error(`unterminated JSON object: ${path || "manifest"}`);
  }
  if (text[state.index] === "[") {
    state.index += 1;
    skipWhitespace(text, state);
    if (text[state.index] === "]") { state.index += 1; return; }
    let item = 0;
    while (state.index < text.length) {
      scanValue(text, state, `${path}[${item}]`);
      item += 1;
      skipWhitespace(text, state);
      const delimiter = text[state.index++];
      if (delimiter === "]") return;
      if (delimiter !== ",") throw new Error(`invalid JSON array: ${path}`);
    }
    throw new Error(`unterminated JSON array: ${path}`);
  }
  if (text[state.index] === '"') {
    scanString(text, state);
    return;
  }
  const start = state.index;
  while (state.index < text.length && !/[\s,}\]]/.test(text[state.index]!)) state.index += 1;
  if (state.index === start) throw new Error(`invalid JSON value: ${path}`);
}

export function assertNoDuplicateJsonProperties(text: string): void {
  const state = { index: 0 };
  scanValue(text, state, "");
  skipWhitespace(text, state);
  if (state.index !== text.length) throw new Error("invalid trailing JSON content");
}

export function parseManifestJson(text: string): SetupManifest {
  try {
    assertNoDuplicateJsonProperties(text);
    return parseSetupManifest(JSON.parse(text) as unknown);
  } catch (error) {
    throw new Error(`manifest: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function loadSetupManifest(path: string): SetupManifest {
  try {
    return parseManifestJson(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("manifest:")) throw error;
    throw new Error(`manifest: could not read ${path} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function manifestDigest(manifest: SetupManifest): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}
