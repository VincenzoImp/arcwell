import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCWELL_PACKAGE_SOURCE,
  packageSourceIdentity,
  packageSourcesEquivalent,
} from "../src/setup/package-source.js";

const equivalentArcwellSources = [
  ARCWELL_PACKAGE_SOURCE,
  "https://github.com/VincenzoImp/arcwell@v0.2.0",
  "git:https://github.com/VincenzoImp/arcwell@v0.2.0",
  "ssh://git@github.com/VincenzoImp/arcwell@v0.2.0",
  "git:ssh://git@github.com/VincenzoImp/arcwell@v0.2.0",
  "git:git@github.com:VincenzoImp/arcwell@v0.2.0",
  "git:www.github.com/VincenzoImp/arcwell@v0.2.0",
  "https://www.github.com/VincenzoImp/arcwell@v0.2.0",
  "git:git@www.github.com:VincenzoImp/arcwell@v0.2.0",
] as const;

test("Pi-supported Arcwell Git forms normalize to one repository identity and same-ref source", () => {
  for (const source of equivalentArcwellSources) {
    assert.equal(packageSourceIdentity(source), "git:github.com/VincenzoImp/arcwell", source);
    assert.equal(packageSourcesEquivalent(source, ARCWELL_PACKAGE_SOURCE), true, source);
  }
});

test("raw SCP syntax without the git prefix remains a local source like Pi 0.84.4", () => {
  const rawScpSource = "git@github.com:VincenzoImp/arcwell@v0.2.0";
  assert.equal(packageSourceIdentity(rawScpSource), undefined);
  assert.equal(packageSourcesEquivalent(rawScpSource, ARCWELL_PACKAGE_SOURCE), false);
  assert.equal(
    packageSourcesEquivalent(`git:${rawScpSource}`, ARCWELL_PACKAGE_SOURCE),
    true,
  );
});

test("semantic package source equivalence includes the Git ref", () => {
  assert.equal(
    packageSourcesEquivalent(
      "git:https://github.com/VincenzoImp/arcwell@main",
      ARCWELL_PACKAGE_SOURCE,
    ),
    false,
  );
  assert.equal(
    packageSourceIdentity("git:https://github.com/VincenzoImp/arcwell@main"),
    packageSourceIdentity(ARCWELL_PACKAGE_SOURCE),
  );
});
