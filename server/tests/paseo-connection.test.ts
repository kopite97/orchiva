import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { OwnedConnection } from "../adapters/paseo/connection";

test("concurrent starts share one connection; cleanup twice closes once and is terminal", async () => {
  let starts = 0, closes = 0;
  const connection = new OwnedConnection(() => ({ api: "API", connect: async () => { starts++; await delay(5); }, close: async () => { closes++; } }));
  assert.deepEqual(await Promise.all([connection.start(), connection.start()]), ["API", "API"]);
  await Promise.all([connection.dispose(), connection.dispose()]);
  assert.equal(starts, 1); assert.equal(closes, 1); assert.equal(connection.state, "disposed");
  await assert.rejects(connection.start(), /disposed/);
});

test("failed clients are closed before bounded retry and exhausted starts do not leak", async () => {
  let creates = 0, closes = 0;
  const connection = new OwnedConnection(() => { creates++; return { api: 1, connect: async () => { throw Error("offline"); }, close: async () => { closes++; } }; }, { attempts: 3, retryMs: 1 });
  await assert.rejects(connection.start(), /offline/);
  assert.equal(connection.state, "failed");
  await connection.dispose(); assert.equal(creates, 3); assert.equal(closes, 3);
});

test("startup recovers when daemon becomes ready on a later attempt", async () => {
  let attempt = 0, closes = 0;
  const connection = new OwnedConnection(() => { const current = ++attempt; return { api: current, connect: async () => { if (current < 3) throw Error("not ready"); }, close: async () => { closes++; } }; }, { attempts: 3, retryMs: 1 });
  assert.equal(await connection.start(), 3); assert.equal(closes, 2);
  await connection.dispose(); assert.equal(closes, 3);
});

test("dispose cancels a hung connect and a late completion cannot resurrect the owner", async () => {
  let resolve!: () => void, closes = 0;
  const connection = new OwnedConnection(() => ({ api: 1, connect: () => new Promise<void>(done => { resolve = done; }), close: async () => { closes++; } }));
  const started = connection.start(); const rejected = assert.rejects(started, /disposed/);
  await connection.dispose(); resolve(); await rejected;
  await delay(1); assert.equal(connection.state, "disposed"); assert.equal(closes, 1);
});

test("dispose cancels retry delay before a replacement connection can be created", async () => {
  let attempts = 0;
  const connection = new OwnedConnection(() => { attempts++; return { api: 1, connect: async () => { throw Error("offline"); }, close: async () => {} }; }, { attempts: 6, retryMs: 5000 });
  const started = connection.start(); const rejected = assert.rejects(started);
  await delay(5); await connection.dispose(); await rejected; assert.equal(attempts, 1);
});
