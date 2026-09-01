import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { validArcwellPackageDir } from "./setup-package-fixture.js";

const expectedManifest = {
  name: "arcwell",
  version: "0.3.0",
  type: "module",
  pi: {
    extensions: ["./dist/extensions/arcwell-protections.js"],
  },
};

test("setup package fixture is materialized under the repository test scratch root", async () => {
  assert.equal(
    relative(process.cwd(), validArcwellPackageDir).replaceAll("\\", "/"),
    ".tmp-tests/package-fixtures/arcwell",
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(validArcwellPackageDir, "package.json"), "utf8")),
    expectedManifest,
  );
  const extensionPath = join(validArcwellPackageDir, "dist", "extensions", "arcwell-protections.js");
  assert.equal(
    readFileSync(extensionPath, "utf8"),
    "export default function arcwellProtections() {}\n",
  );
  const extension = await import(pathToFileURL(extensionPath).href);
  assert.equal(typeof extension.default, "function");
});
