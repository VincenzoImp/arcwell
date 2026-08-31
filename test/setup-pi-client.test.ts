import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createPiClient, type PiClientOptions } from "../src/setup/pi-client.js";

const temporaryRoot = join(process.cwd(), ".tmp-tests");
mkdirSync(temporaryRoot, { recursive: true });

test("Pi client waits for child close after abort before rejecting", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
  const spawn = ((_command: string, _arguments: readonly string[], options: { signal?: AbortSignal }) => {
    options.signal?.addEventListener("abort", () => child.emit("error", new Error("Pi command aborted")));
    return child;
  }) as unknown as NonNullable<PiClientOptions["spawn"]>;
  const client = createPiClient({ spawn });
  const controller = new AbortController();
  const pending = client.install("npm:slow@1.0.0", controller.signal);
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });

  controller.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  child.emit("close", null, "SIGTERM");
  await assert.rejects(pending, /abort/i);
});

test("Pi client uses argument arrays and parses documented package identities", async () => {
  const root = mkdtempSync(join(temporaryRoot, "pi-client-"));
  try {
    const fixture = join(root, "pi-fixture.mjs");
    const log = join(root, "calls.jsonl");
    writeFileSync(fixture, `
      import { appendFileSync } from "node:fs";
      const [command, ...args] = process.argv.slice(2);
      appendFileSync(process.env.PI_FIXTURE_LOG, JSON.stringify([command, ...args]) + "\\n");
      if (command === "--version") console.log("pi 0.84.4");
      else if (command === "list") console.log("User packages:\\n  npm:@scope/one@1.2.3\\n    /installed/one\\n\\nProject packages:\\n  npm:two@2.0.0 (filtered)\\n    C:\\\\installed\\\\two");
      else if (command === "install" && args[0] === "npm:slow@1.0.0") setTimeout(() => {}, 10_000);
      else if (command === "install" && args[0] === "npm:bad@1.0.0") { console.error("\\u001b[31mBAD\\u001b[0m\\u0000" + "x".repeat(200)); process.exitCode = 2; }
      else if (command === "install" && args[0] === "npm:huge@1.0.0") { console.error("x".repeat(5_000)); process.exitCode = 2; }
    `);
    const client = createPiClient({
      executable: process.execPath,
      prefixArguments: [fixture],
      environment: { ...process.env, PI_FIXTURE_LOG: log },
      maxOutputBytes: 512,
    });

    assert.equal(await client.version(), "pi 0.84.4");
    assert.deepEqual(await client.list(), [
      { source: "npm:@scope/one@1.2.3", scope: "user", filtered: false, installedPath: "/installed/one" },
      { source: "npm:two@2.0.0", scope: "project", filtered: true, installedPath: "C:\\installed\\two" },
    ]);
    await client.install("npm:three@3.0.0");
    await client.remove("npm:three@3.0.0");
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)), [
      ["--version"],
      ["list"],
      ["install", "npm:three@3.0.0"],
      ["remove", "npm:three@3.0.0"],
    ]);

    await assert.rejects(client.install("npm:bad@1.0.0"), (error: Error) => {
      assert.match(error.message, /BAD\\u0000/);
      assert.doesNotMatch(error.message, /\u001b/);
      assert.ok(Buffer.byteLength(error.message) < 512);
      return true;
    });
    await assert.rejects(client.install("npm:huge@1.0.0"), /output exceeded 512 bytes/);

    const controller = new AbortController();
    const pending = client.install("npm:slow@1.0.0", controller.signal);
    controller.abort();
    await assert.rejects(pending, /abort/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
