import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERNAL_CAPABILITIES,
  PACKAGE_CATALOG,
  REJECTED_CAPABILITIES,
  validateCatalog,
} from "../src/setup/catalog.js";

const expectedCatalog = [
  ["lsp", "npm:@spences10/pi-lsp@0.0.46", true],
  ["context", "npm:@spences10/pi-context@0.1.16", true],
  ["mcp", "npm:@spences10/pi-mcp@0.0.60", true],
  ["subagents", "npm:pi-subagents@0.62.0", true],
  ["goal", "npm:@narumitw/pi-goal@0.54.4", true],
  ["redaction", "npm:@spences10/pi-redact@0.0.15", true],
] as const;

test("catalog assigns one exact owner to every accepted capability", () => {
  assert.deepEqual(
    PACKAGE_CATALOG.map(({ capability, source, defaultEnabled }) => [capability, source, defaultEnabled]),
    expectedCatalog,
  );
  assert.doesNotThrow(() => validateCatalog(PACKAGE_CATALOG));
});

test("catalog rejects unversioned sources, duplicate ownership, and declared conflicts", () => {
  const first = PACKAGE_CATALOG[0]!;
  assert.throws(
    () => validateCatalog([{ ...first, source: "npm:@spences10/pi-lsp" }, ...PACKAGE_CATALOG.slice(1)]),
    /exact npm version/,
  );
  assert.throws(
    () => validateCatalog([...PACKAGE_CATALOG, { ...first, id: "second-lsp" }]),
    /duplicate owner.*lsp/,
  );
  assert.throws(
    () => validateCatalog([{ ...first, conflictsWith: [PACKAGE_CATALOG[1]!.id] }, ...PACKAGE_CATALOG.slice(1)]),
    /conflict/,
  );
});

test("overlapping and rejected policy or workflow packages stay out of the catalog", () => {
  assert.deepEqual(REJECTED_CAPABILITIES, [
    "coding-preferences",
    "nopeek",
    "confirm-destructive",
    "background-tasks",
    "dynamic-workflows",
    "web-ui",
    "git-checkpoint",
    "notifications",
  ]);
  const serialized = JSON.stringify(PACKAGE_CATALOG);
  for (const rejected of [
    "pi-coding-preferences",
    "pi-nopeek",
    "pi-confirm-destructive",
    "pi-background-tasks",
    "pi-dynamic-workflows",
    "pi-web-ui",
  ]) assert.equal(serialized.includes(rejected), false);
});

test("a package Arcwell supersedes never reappears in the catalog", () => {
  // Installing one of these alongside Arcwell's own copy registers the same tool twice and
  // Pi then loads neither: `Tool "todo" conflicts with ...`. The real-package smoke caught
  // exactly this, so the catalog is asserted against the superseded list.
  const serialized = JSON.stringify(PACKAGE_CATALOG);
  for (const { capability, supersedes } of INTERNAL_CAPABILITIES) {
    assert.equal(serialized.includes(supersedes), false, `${supersedes} conflicts with Arcwell's own ${capability}`);
  }
  assert.deepEqual(
    INTERNAL_CAPABILITIES.map((entry) => entry.capability),
    ["todo", "questionnaire", "plan-mode", "web"],
  );
});
