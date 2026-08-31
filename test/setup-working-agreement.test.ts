import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  mergeWorkingAgreement,
  removeWorkingAgreement,
  removeWorkingAgreementText,
  workingAgreementDigest,
} from "../src/setup/working-agreement.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });
const block = "<!-- arcwell:start -->\nArcwell rules\n<!-- arcwell:end -->\n";

test("working agreement merge preserves unrelated content and file mode and is idempotent", () => {
  const root = mkdtempSync(join(temporaryRoot, "agreement-"));
  try {
    const target = join(root, "AGENTS.md");
    writeFileSync(target, `before\n${block}after\n`, { mode: 0o640 });
    chmodSync(target, 0o640);
    const replacement = "<!-- arcwell:start -->\nNew Arcwell rules\n<!-- arcwell:end -->\n";
    assert.equal(mergeWorkingAgreement(target, replacement), workingAgreementDigest(replacement));
    assert.equal(readFileSync(target, "utf8"), `before\n${replacement}after\n`);
    if (process.platform !== "win32") assert.equal(lstatSync(target).mode & 0o777, 0o640);
    const inode = lstatSync(target).ino;
    assert.equal(mergeWorkingAgreement(target, replacement), workingAgreementDigest(replacement));
    assert.equal(readFileSync(target, "utf8"), `before\n${replacement}after\n`);
    assert.equal(lstatSync(target).ino, inode);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("working agreement removal preserves every unrelated byte and the file mode", () => {
  const root = mkdtempSync(join(temporaryRoot, "agreement-remove-"));
  try {
    const target = join(root, "AGENTS.md");
    writeFileSync(target, `before\n${block}after\n`, { mode: 0o640 });
    chmodSync(target, 0o640);
    assert.equal(removeWorkingAgreementText(`before\n${block}after\n`), "before\nafter\n");
    assert.equal(removeWorkingAgreement(target), true);
    assert.equal(readFileSync(target, "utf8"), "before\nafter\n");
    if (process.platform !== "win32") assert.equal(lstatSync(target).mode & 0o777, 0o640);
    assert.equal(removeWorkingAgreement(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("working agreement removal deletes an empty file originally created by Arcwell", () => {
  const root = mkdtempSync(join(temporaryRoot, "agreement-created-empty-"));
  try {
    const target = join(root, "AGENTS.md");
    writeFileSync(target, "");
    assert.equal(removeWorkingAgreement(target, { existed: false, endedWithNewline: false }), true);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("working agreement rejects malformed markers and symlink path components", () => {
  const root = mkdtempSync(join(temporaryRoot, "agreement-invalid-"));
  try {
    const malformed = join(root, "AGENTS.md");
    writeFileSync(malformed, "unrelated\n<!-- arcwell:start -->\nmissing end\n");
    assert.throws(() => mergeWorkingAgreement(malformed, block), /malformed Arcwell markers/);
    assert.equal(readFileSync(malformed, "utf8"), "unrelated\n<!-- arcwell:start -->\nmissing end\n");

    const real = join(root, "real");
    const linked = join(root, "linked");
    mkdirSync(real);
    symlinkSync(real, linked, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => mergeWorkingAgreement(join(linked, "AGENTS.md"), block), /symbolic link/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
