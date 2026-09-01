import assert from "node:assert/strict";
import test from "node:test";

import { PACKAGE_CATALOG } from "../src/setup/catalog.js";
import { createDefaultManifest } from "../src/setup/manifest.js";
import { ARCWELL_PACKAGE_SOURCE } from "../src/setup/package-source.js";
import { createSetupPlan } from "../src/setup/plan.js";
import { moduleNames, protectionNames } from "../src/setup/types.js";

const sourceFor = (capability: string): string | undefined =>
  PACKAGE_CATALOG.find((entry) => entry.capability === capability)?.source;

/** Modules backed by an external package. `memory` gates an extension Arcwell ships itself. */
const packagedModules = moduleNames.filter((name) => sourceFor(name) !== undefined);

test("dry-run plan is deterministic, portable, and contains exact selected package sources", () => {
  const manifest = createDefaultManifest();
  const first = createSetupPlan(manifest);
  assert.deepEqual(first, createSetupPlan(manifest));
  assert.deepEqual(
    first.operations.filter((operation) => operation.kind === "install-package").map((operation) => operation.source),
    [
      ARCWELL_PACKAGE_SOURCE,
      "npm:@spences10/pi-context@0.1.16",
      "npm:@narumitw/pi-goal@0.54.4",
      "npm:@spences10/pi-lsp@0.0.46",
      "npm:@spences10/pi-mcp@0.0.60",
      "npm:@spences10/pi-redact@0.0.15",
      "npm:pi-subagents@0.62.0",
    ],
  );
  assert.equal(first.operations.some((operation) => operation.destination === "$PI_CODING_AGENT_DIR/AGENTS.md"), true);
  assert.equal(first.operations.some((operation) => operation.destination === "$PI_CODING_AGENT_DIR/arcwell/config.json"), true);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(process.env.HOME ?? "__no_home__"), false);
  assert.match(first.notes.join("\n"), /Claude.*\/login/);
});

test("each disabled protection warns independently and redaction controls only its owner package", () => {
  for (const protection of protectionNames) {
    const manifest = createDefaultManifest();
    manifest.protections[protection] = false;
    const plan = createSetupPlan(manifest);
    assert.equal(plan.warnings.filter((warning) => warning.includes(protection)).length, 1);
    if (protection === "redaction") {
      assert.equal(plan.operations.some((operation) => operation.source === sourceFor("redaction")), false);
    }
  }
});

test("package composition omits every disabled default and every unselected optional module", () => {
  const defaults = createDefaultManifest();
  const allDisabled = createDefaultManifest();
  for (const moduleName of moduleNames) allDisabled.modules[moduleName] = false;
  const disabledPackageSources = createSetupPlan(allDisabled).operations
    .filter((operation) => operation.kind === "install-package")
    .map((operation) => operation.source);
  assert.deepEqual(disabledPackageSources, [ARCWELL_PACKAGE_SOURCE, sourceFor("redaction")]);

  for (const moduleName of packagedModules) {
    const source = sourceFor(moduleName)!;
    const defaultPlan = createSetupPlan(defaults);
    assert.equal(
      defaultPlan.operations.some((operation) => operation.source === source),
      defaults.modules[moduleName],
    );

    const toggled = createDefaultManifest();
    toggled.modules[moduleName] = !toggled.modules[moduleName];
    assert.equal(
      createSetupPlan(toggled).operations.some((operation) => operation.source === source),
      toggled.modules[moduleName],
    );
  }
});
