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
import { basename, dirname, join } from "node:path";

import { assertNoSymbolicLinkComponents } from "./config.js";
import { assertNoDuplicateJsonProperties } from "./manifest.js";
import { ARCWELL_PACKAGE_SOURCE } from "./package-source.js";

export const MAX_OWNERSHIP_BYTES = 64 * 1024;

export interface ArcwellOwnership {
  schemaVersion: 1;
  arcwellVersion: string;
  manifestDigest: string;
  installedPackageSources: string[];
  selectedPackageSources: string[];
  workingAgreementDigest: string;
  workingAgreementExisted: boolean;
  workingAgreementEndedWithNewline: boolean;
  arcwellDirectoryExisted: boolean;
}

const allowedProperties = [
  "schemaVersion",
  "arcwellVersion",
  "manifestDigest",
  "installedPackageSources",
  "selectedPackageSources",
  "workingAgreementDigest",
  "workingAgreementExisted",
  "workingAgreementEndedWithNewline",
  "arcwellDirectoryExisted",
] as const;
const digestPattern = /^[a-f0-9]{64}$/;
const exactNpmSource = /^npm:(?:@[^/@]+\/)?[^/@]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseOwnership(value: unknown): ArcwellOwnership {
  if (!isRecord(value)) throw new Error("ownership: expected an object");
  const unknown = Object.keys(value).find((key) => !allowedProperties.includes(key as (typeof allowedProperties)[number]));
  if (unknown) throw new Error(`${unknown}: unknown property`);
  if (value.schemaVersion !== 1) throw new Error("schemaVersion: expected 1");
  if (typeof value.arcwellVersion !== "string" || !value.arcwellVersion) throw new Error("arcwellVersion: expected a non-empty string");
  if (typeof value.manifestDigest !== "string" || !digestPattern.test(value.manifestDigest)) {
    throw new Error("manifestDigest: expected a sha256 digest");
  }
  const packageSources = (property: "installedPackageSources" | "selectedPackageSources"): string[] => {
    const sources = value[property];
    if (!Array.isArray(sources)) throw new Error(`${property}: expected an array`);
    const parsed = sources.map((source, index) => {
      if (typeof source !== "string" || (source !== ARCWELL_PACKAGE_SOURCE && !exactNpmSource.test(source))) {
        throw new Error(`${property}[${index}]: expected an exact npm package source or the exact Arcwell Git source`);
      }
      return source;
    });
    if (new Set(parsed).size !== parsed.length) throw new Error(`${property}: duplicate package source`);
    return parsed;
  };
  const installedPackageSources = packageSources("installedPackageSources");
  const selectedPackageSources = packageSources("selectedPackageSources");
  if (installedPackageSources.some((source) => !selectedPackageSources.includes(source))) {
    throw new Error("installedPackageSources: expected a subset of selectedPackageSources");
  }
  if (typeof value.workingAgreementDigest !== "string" || !digestPattern.test(value.workingAgreementDigest)) {
    throw new Error("workingAgreementDigest: expected a sha256 digest");
  }
  if (typeof value.workingAgreementExisted !== "boolean") {
    throw new Error("workingAgreementExisted: expected a boolean");
  }
  if (typeof value.workingAgreementEndedWithNewline !== "boolean") {
    throw new Error("workingAgreementEndedWithNewline: expected a boolean");
  }
  if (typeof value.arcwellDirectoryExisted !== "boolean") {
    throw new Error("arcwellDirectoryExisted: expected a boolean");
  }
  return {
    schemaVersion: 1,
    arcwellVersion: value.arcwellVersion,
    manifestDigest: value.manifestDigest,
    installedPackageSources,
    selectedPackageSources,
    workingAgreementDigest: value.workingAgreementDigest,
    workingAgreementExisted: value.workingAgreementExisted,
    workingAgreementEndedWithNewline: value.workingAgreementEndedWithNewline,
    arcwellDirectoryExisted: value.arcwellDirectoryExisted,
  };
}

export function parseOwnershipJson(text: string): ArcwellOwnership {
  if (Buffer.byteLength(text) > MAX_OWNERSHIP_BYTES) throw new Error("ownership exceeds 64 KiB");
  try {
    assertNoDuplicateJsonProperties(text);
    return parseOwnership(JSON.parse(text) as unknown);
  } catch (error) {
    throw new Error(`ownership: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function readOwnership(path: string): ArcwellOwnership | undefined {
  assertNoSymbolicLinkComponents(path);
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`ownership target is a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`ownership target is not a regular file: ${path}`);
  return parseOwnershipJson(readFileSync(path, "utf8"));
}

export function writeOwnershipAtomic(path: string, ownership: ArcwellOwnership): void {
  const parsed = parseOwnership(ownership);
  const content = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(content) > MAX_OWNERSHIP_BYTES) throw new Error("ownership exceeds 64 KiB");
  const directory = dirname(path);
  assertNoSymbolicLinkComponents(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(directory);

  let mode = 0o600;
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`ownership target is a symbolic link: ${path}`);
    if (!stat.isFile()) throw new Error(`ownership target is not a regular file: ${path}`);
    if (readFileSync(path, "utf8") === content) return;
    mode = stat.mode & 0o777;
  }

  const temporary = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", mode);
    writeFileSync(descriptor, content, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
