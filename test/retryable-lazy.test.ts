import assert from "node:assert/strict";
import test from "node:test";

import { retryableLazy } from "../src/retryable-lazy.js";

test("retryable lazy initialization shares success and recovers after rejection", async () => {
  let attempts = 0;
  const load = retryableLazy(async (value: string) => {
    attempts += 1;
    if (attempts === 1) throw new Error("aborted initialization");
    return value;
  });

  await assert.rejects(() => load("first"), /aborted/);
  assert.equal(await load("healthy"), "healthy");
  assert.equal(await load("ignored-after-success"), "healthy");
  assert.equal(attempts, 2);
});

test("a loader that resolves after abort is not retained as successful", async () => {
  let attempts = 0;
  const load = retryableLazy(async (signal: AbortSignal) => {
    attempts += 1;
    await Promise.resolve();
    signal.throwIfAborted();
    return attempts;
  });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => load(aborted.signal), /abort/i);
  assert.equal(await load(new AbortController().signal), 2);
});
