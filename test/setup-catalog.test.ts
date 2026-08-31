import assert from "node:assert/strict";
import test from "node:test";

import { PACKAGE_CATALOG, REJECTED_CAPABILITIES, validateCatalog } from "../src/setup/catalog.js";

const expectedCatalog = [
  ["lsp", "npm:@spences10/pi-lsp@0.0.46", true],
  ["context", "npm:@spences10/pi-context@0.1.16", true],
  ["todo", "npm:@juicesharp/rpiv-todo@2.8.0", true],
  ["questionnaire", "npm:@juicesharp/rpiv-ask-user-question@2.8.0", true],
  ["planMode", "npm:@narumitw/pi-plan-mode@0.56.0", true],
  ["mcp", "npm:@spences10/pi-mcp@0.0.60", true],
  ["web", "npm:pi-web-access@0.27.0", false],
  ["subagents", "npm:pi-subagents@0.61.0", false],
  ["autonomousWorkflows", "npm:@narumitw/pi-goal@0.54.4", false],
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
