import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import * as protectionsExtension from "../extensions/arcwell-protections.js";
import {
  MAX_RUNTIME_CONFIG_BYTES,
  parseRuntimeConfigJson,
  runtimeConfigFromManifest,
  writeRuntimeConfigAtomic,
} from "../src/setup/config.js";
import { createDefaultManifest } from "../src/setup/manifest.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

const readRuntimeConfigFile = (protectionsExtension as unknown as {
  readRuntimeConfigFile(path: string): ReturnType<typeof runtimeConfigFromManifest>;
}).readRuntimeConfigFile;

test("runtime config is strict, bounded, and contains only approved non-secret fields", () => {
  const config = runtimeConfigFromManifest(createDefaultManifest());
  assert.deepEqual(config, {
    schemaVersion: 1,
    posture: "guarded",
    protections: { effects: true, secrets: true, redaction: true },
  });
  assert.deepEqual(parseRuntimeConfigJson(JSON.stringify(config)), config);
  assert.throws(() => parseRuntimeConfigJson(JSON.stringify({ ...config, token: "secret" })), /token: unknown property/);
  assert.throws(() => parseRuntimeConfigJson(`{"schemaVersion":1,"schemaVersion":1}`), /duplicate property/);
  assert.throws(() => parseRuntimeConfigJson(" ".repeat(MAX_RUNTIME_CONFIG_BYTES + 1)), /16 KiB/);
});

test("extension runtime loading rejects duplicate JSON properties and symlinked parents", () => {
  const root = mkdtempSync(join(temporaryRoot, "runtime-config-read-"));
  try {
    const configDirectory = join(root, "arcwell");
    mkdirSync(configDirectory);
    const target = join(configDirectory, "config.json");
    writeFileSync(target, "{\"schemaVersion\":1,\"posture\":\"host\",\"posture\":\"guarded\",\"protections\":{\"effects\":false,\"secrets\":false,\"redaction\":false}}");
    assert.equal(readRuntimeConfigFile(target).protections.effects, true);

    const realParent = join(root, "real-parent");
    const linkedParent = join(root, "linked-parent");
    mkdirSync(realParent);
    writeFileSync(join(realParent, "config.json"), JSON.stringify({
      schemaVersion: 1,
      posture: "guarded",
      protections: { effects: false, secrets: false, redaction: false },
    }));
    symlinkSync(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    assert.equal(readRuntimeConfigFile(join(linkedParent, "config.json")).protections.effects, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic runtime config replacement preserves mode and rejects symlink targets and parents", () => {
  const root = mkdtempSync(join(temporaryRoot, "runtime-config-"));
  try {
    const target = join(root, "arcwell", "config.json");
    mkdirSync(join(root, "arcwell"));
    writeFileSync(target, "{}\n", { mode: 0o640 });
    chmodSync(target, 0o640);
    const config = runtimeConfigFromManifest(createDefaultManifest());
    config.protections.effects = false;
    writeRuntimeConfigAtomic(target, config);
    assert.deepEqual(parseRuntimeConfigJson(readFileSync(target, "utf8")), config);
    if (process.platform !== "win32") assert.equal(lstatSync(target).mode & 0o777, 0o640);
    const inode = lstatSync(target).ino;
    writeRuntimeConfigAtomic(target, config);
    assert.equal(lstatSync(target).ino, inode);

    const realParent = join(root, "real-parent");
    const linkedParent = join(root, "linked-parent");
    mkdirSync(realParent);
    symlinkSync(realParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => writeRuntimeConfigAtomic(join(linkedParent, "config.json"), config), /symbolic link/);

    const real = join(root, "real.json");
    const link = join(root, "link.json");
    writeFileSync(real, "unchanged");
    symlinkSync(real, link);
    assert.throws(() => writeRuntimeConfigAtomic(link, config), /symbolic link/);
    assert.equal(readFileSync(real, "utf8"), "unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
