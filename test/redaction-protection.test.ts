import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

import { PACKAGE_CATALOG, selectedCatalogEntries } from "../src/setup/catalog.js";
import { createDefaultManifest } from "../src/setup/manifest.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

function fakeExternalPackage(root: string, name: string): string {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), `${JSON.stringify({
    name,
    version: "1.0.0",
    pi: { extensions: ["./extension.js"] },
  })}\n`);
  writeFileSync(join(directory, "extension.js"), "export default function externalPackage() {}\n");
  return directory;
}

test("redaction toggle composes only the exact audited external source", () => {
  const source = PACKAGE_CATALOG.find((entry) => entry.capability === "redaction")!.source;
  const enabled = createDefaultManifest();
  assert.equal(selectedCatalogEntries(enabled).some((entry) => entry.source === source), true);

  const disabled = createDefaultManifest();
  disabled.protections.redaction = false;
  assert.equal(selectedCatalogEntries(disabled).some((entry) => entry.source === source), false);
});

test("Pi can compose selected external package resources from local fixtures without installation", async () => {
  const root = mkdtempSync(join(temporaryRoot, "external-composition-"));
  try {
    const redactionFixture = fakeExternalPackage(root, "fake-redaction-owner");
    const webFixture = fakeExternalPackage(root, "fake-web-owner");
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "agent"),
      settingsManager: SettingsManager.inMemory(
        { packages: [redactionFixture, { source: webFixture, extensions: [] }] },
        { projectTrusted: false },
      ),
      noContextFiles: true,
    });
    await loader.reload({ resolveProjectTrust: async () => false });

    const loaded = loader.getExtensions().extensions.map((entry) => basename(entry.resolvedPath));
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.deepEqual(loaded, ["extension.js"]);
    assert.equal(loader.getExtensions().extensions[0]?.resolvedPath.startsWith(redactionFixture), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
