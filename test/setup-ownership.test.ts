import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  MAX_OWNERSHIP_BYTES,
  parseOwnershipJson,
  readOwnership,
  writeOwnershipAtomic,
  type ArcwellOwnership,
} from "../src/setup/ownership.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const digest = "a".repeat(64);
const ownership: ArcwellOwnership = {
  schemaVersion: 1,
  arcwellVersion: "0.6.1",
  manifestDigest: digest,
  installedPackageSources: [ARCWELL_PACKAGE_SOURCE],
  installedResources: [],
  selectedPackageSources: [ARCWELL_PACKAGE_SOURCE, "npm:@spences10/pi-lsp@0.0.46"],
  workingAgreementDigest: "b".repeat(64),
  workingAgreementExisted: true,
  workingAgreementEndedWithNewline: false,
  arcwellDirectoryExisted: false,
  subagentOverridesWritten: false,
};

test("ownership JSON is strict, bounded, and contains only lifecycle ownership", () => {
  assert.deepEqual(parseOwnershipJson(JSON.stringify(ownership)), ownership);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, token: "secret" })), /token: unknown property/);
  assert.throws(() => parseOwnershipJson(`{"schemaVersion":1,"schemaVersion":1}`), /duplicate property/);
  assert.throws(() => parseOwnershipJson(" ".repeat(MAX_OWNERSHIP_BYTES + 1)), /64 KiB/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, installedPackageSources: ["npm:arcwell"] })), /exact npm package source/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, selectedPackageSources: ["npm:arcwell"] })), /exact npm package source/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, workingAgreementExisted: "yes" })), /workingAgreementExisted.*boolean/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, workingAgreementEndedWithNewline: 1 })), /workingAgreementEndedWithNewline.*boolean/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({ ...ownership, arcwellDirectoryExisted: "no" })), /arcwellDirectoryExisted.*boolean/);
  assert.throws(() => parseOwnershipJson(JSON.stringify({
    ...ownership,
    installedPackageSources: [...ownership.installedPackageSources, "npm:@spences10/pi-redact@0.0.15"],
  })), /installedPackageSources.*selectedPackageSources/);
});

test("ownership replacement is atomic, mode preserving, and rejects symlinks", () => {
  const root = mkdtempSync(join(temporaryRoot, "ownership-"));
  try {
    const target = join(root, "arcwell", "ownership.json");
    mkdirSync(join(root, "arcwell"));
    writeFileSync(target, "{}\n", { mode: 0o640 });
    chmodSync(target, 0o640);
    writeOwnershipAtomic(target, ownership);
    assert.deepEqual(readOwnership(target), ownership);
    assert.deepEqual(parseOwnershipJson(readFileSync(target, "utf8")), ownership);
    if (process.platform !== "win32") assert.equal(lstatSync(target).mode & 0o777, 0o640);
    const inode = lstatSync(target).ino;
    writeOwnershipAtomic(target, ownership);
    assert.equal(lstatSync(target).ino, inode);

    const real = join(root, "real");
    const linked = join(root, "linked");
    mkdirSync(real);
    symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => writeOwnershipAtomic(join(linked, "ownership.json"), ownership), /symbolic link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
