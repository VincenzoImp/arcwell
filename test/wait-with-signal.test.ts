import assert from "node:assert/strict";
import test from "node:test";

import { waitWithSignal } from "../src/wait-with-signal.js";

test("one aborted waiter does not cancel a shared initialization", async () => {
  let resolveShared: ((value: string) => void) | undefined;
  const shared = new Promise<string>((resolve) => { resolveShared = resolve; });
  const first = new AbortController();
  const second = new AbortController();
  const aborted = waitWithSignal(shared, first.signal);
  const healthy = waitWithSignal(shared, second.signal);
  first.abort(new Error("first caller aborted"));
  await assert.rejects(() => aborted, /first caller aborted/);
  resolveShared?.("runtime");
  assert.equal(await healthy, "runtime");
});
