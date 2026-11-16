import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { URL } from "node:url";
import { tmpdir, homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { BridgeSession, LineFrames } from "../../bridge/protocol";
import { readRuntimeSettings } from "../config/runtime-settings";
import { maxFrameBytes } from "../../shared/contracts/desktop-protocol";
import { runIsolatedDaemon } from "../../bridge/launcher";
const settings = { dataHome: "C:\\isolated\\data", paseoHome: "C:\\isolated\\paseo", endpoint: "127.0.0.1:17767", isolationRoot: "C:\\isolated" };
const wire = JSON.parse(readFileSync(new URL("../../shared/contracts/fixtures/desktop-wire-v1.json", import.meta.url), "utf8"));
const info = wire.response.result;
const envelope = (id: string, method: string, params: unknown = {}) => JSON.stringify({ protocolVersion: 1, id, method, params });
test("desktop mutations require advertised capability and forward only whitelisted domain errors", async () => {
  const old = new BridgeSession({ invoke: async () => info, close: async () => {} }, settings);
  await old.handle(envelope("old-hello", "handshake"));
  assert.match(JSON.stringify(await old.handle(envelope("old-projects", "desktop.projects.list"))), /CAPABILITY_UNAVAILABLE/);
  const calls: string[] = [];
  const session = new BridgeSession({ invoke: async method => { calls.push(method); if (method === "runtime.info") return { ...info, serverVersion: "desktop-d3", capabilities: ["desktop.projects.register"] }; throw new Error("provider wrapper: SOURCE_OUTPUT_OVERLAP secret-auth-value"); }, close: async () => {} }, settings);
  await session.handle(envelope("new-hello", "handshake"));
  assert.match(JSON.stringify(await session.handle(envelope("invalid", "desktop.projects.register", {}))), /INVALID_PARAMS/);
  const response = JSON.stringify(await session.handle(envelope("register", "desktop.projects.register", { sourceRoot: "C:\\test", name: "Test" })));
  assert.match(response, /SOURCE_OUTPUT_OVERLAP/); assert.doesNotMatch(response, /secret-auth-value/); assert.equal(calls.length, 2);
});
test("desktop rejects mutation, invalid input, and pre-handshake reads before SDK invocation", async () => {
  const calls: string[] = [];
  const session = new BridgeSession({ invoke: async method => { calls.push(method); return info; }, close: async () => {} }, settings);
  assert.match(JSON.stringify(await session.handle(envelope("a", "request.start"))), /METHOD_DENIED/);
  assert.match(JSON.stringify(await session.handle(envelope("b", "project.read"))), /HANDSHAKE_REQUIRED/);
  assert.match(JSON.stringify(await session.handle(envelope("c", "handshake"))), /desktop-d1/);
  assert.match(JSON.stringify(await session.handle(envelope("d", "request.detail", { token: "../bad" }))), /INVALID_PARAMS/);
  assert.match(JSON.stringify(await session.handle(envelope("c", "handshake"))), /DUPLICATE_ID/);
  assert.deepEqual(calls, ["runtime.info"]);
  const fresh = new BridgeSession({ invoke: async () => info, close: async () => {} }, settings);
  assert.deepEqual(await fresh.handle(JSON.stringify(wire.request)), wire.response);
});
test("desktop rejects identity mismatch and never leaks upstream error text", async () => {
  let wrong = true;
  const session = new BridgeSession({ invoke: async () => { if (wrong) return { ...info, dataHome: "other" }; throw new Error("secret-auth-value"); }, close: async () => {} }, settings);
  assert.match(JSON.stringify(await session.handle(envelope("a", "handshake"))), /ENVIRONMENT_MISMATCH/);
  wrong = false;
  const output = JSON.stringify(await session.handle(envelope("b", "handshake")));
  assert.match(output, /CONNECTION_FAILED/); assert.ok(!output.includes("secret"));
});
test("desktop framing preserves split UTF-8 and multiple frames, rejects oversized or invalid UTF-8", () => {
  const f = new LineFrames(), bytes = Buffer.from('한글\nsecond\r\n');
  assert.deepEqual(f.push(bytes.subarray(0, 2)), []);
  assert.deepEqual(f.push(bytes.subarray(2)), ["한글", "second"]);
  assert.throws(() => new LineFrames().push(Buffer.alloc(maxFrameBytes + 1)), /FRAME_TOO_LARGE/);
  assert.throws(() => new LineFrames().push(Buffer.from([0xff, 10])));
});
test("desktop validates protocol version and limits concurrent requests without invoking excess RPCs", async () => {
  let invocations = 0; const release: (() => void)[] = [];
  const session = new BridgeSession({ invoke: async () => { invocations++; if (invocations > 1) await new Promise<void>(resolve => release.push(resolve)); return info; }, close: async () => {} }, settings);
  assert.match(JSON.stringify(await session.handle(JSON.stringify({ protocolVersion: 2, id: "wrong", method: "handshake", params: {} }))), /INVALID_ENVELOPE/);
  assert.equal(invocations, 0);
  await session.handle(envelope("hello", "handshake"));
  const active = Array.from({ length: 8 }, (_, i) => session.handle(envelope(`read-${i}`, "runtime.info")));
  assert.match(JSON.stringify(await session.handle(envelope("excess", "runtime.info"))), /BUSY/);
  assert.equal(invocations, 9); release.forEach(resolve => resolve());
  const replies = await Promise.all(active);
  assert.equal(new Set(replies.map(value => (value as { id: string }).id)).size, 8);
});
test("runtime isolation has no partial-config fallback and excludes out-of-root homes", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchiva-desktop-test-"));
  try {
    await mkdir(join(root, "data")); await mkdir(join(root, "paseo"));
    const env = { ORCHIVA_ISOLATION_ROOT: root, ORCHIVA_DATA_HOME: join(root, "data"), ORCHIVA_PASEO_HOME: join(root, "paseo"), ORCHIVA_PASEO_ENDPOINT: "127.0.0.1:17767" };
    assert.ok(readRuntimeSettings(env).isolationRoot);
    assert.throws(() => readRuntimeSettings({ ORCHIVA_DATA_HOME: env.ORCHIVA_DATA_HOME }), /no fallback/);
    assert.throws(() => readRuntimeSettings({ ...env, ORCHIVA_DATA_HOME: tmpdir() }), /outside/);
    assert.throws(() => readRuntimeSettings({ ...env, ORCHIVA_PASEO_ENDPOINT: "127.0.0.1:6767" }), /isolated loopback/);
    assert.throws(() => readRuntimeSettings({ ...env, ORCHIVA_PASEO_ENDPOINT: "example.com:17767" }), /isolated loopback/);
  } finally { const delta = relative(tmpdir(), root); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta)); await rm(root, { recursive: true, force: true }); }
});

test("desktop timeout invalidates handshake, drops late replies and permits explicit reconnect", async () => {
  let stalled = false;
  let release: (value: unknown) => void = () => {};
  const session = new BridgeSession({ invoke: async () => stalled ? new Promise(resolve => { release = resolve; }) : info, close: async () => {} }, settings, 20);
  await session.handle(envelope("hello", "handshake"));
  stalled = true;
  assert.match(JSON.stringify(await session.handle(envelope("timeout", "runtime.info"))), /TIMEOUT/);
  release(info);
  assert.match(JSON.stringify(await session.handle(envelope("stale", "project.read"))), /HANDSHAKE_REQUIRED/);
  stalled = false;
  assert.match(JSON.stringify(await session.handle(envelope("reconnect", "handshake"))), /desktop-d1/);
});

test("restoring handshake stays read-only and an empty page is preserved", async () => {
  const session = new BridgeSession({ invoke: async method => method === "runtime.info" ? { ...info, restoring: true } : { items: [], nextCursor: null, active: [], total: 0 }, close: async () => {} }, settings);
  const handshake = await session.handle(envelope("hello", "handshake"));
  assert.equal((handshake as any).result.restoring, true);
  assert.deepEqual((await session.handle(envelope("empty", "request.page", { filter: "all", limit: 20 })) as any).result, { items: [], nextCursor: null, active: [], total: 0 });
  assert.match(JSON.stringify(await session.handle(envelope("deny", "request.start"))), /METHOD_DENIED/);
});

test("launcher rejects endpoint mismatch and runtime isolation rejects production aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "orchiva-launch-"));
  try {
    const dataHome = join(root, "data"), paseoHome = join(root, "paseo");
    await mkdir(dataHome); await mkdir(paseoHome);
    await writeFile(join(paseoHome, "config.json"), JSON.stringify({ daemon: { listen: "127.0.0.1:6767" } }));
    await assert.rejects(runIsolatedDaemon({ dataHome, paseoHome, isolationRoot: root, endpoint: "127.0.0.1:17767" }, () => assert.fail("not ready")), /DAEMON_ENDPOINT_MISMATCH/);
    await symlink(homedir(), join(root, "user-alias"), process.platform === "win32" ? "junction" : "dir");
    const env = { ORCHIVA_ISOLATION_ROOT: root, ORCHIVA_DATA_HOME: join(root, "user-alias"), ORCHIVA_PASEO_HOME: paseoHome, ORCHIVA_PASEO_ENDPOINT: "127.0.0.1:17767" };
    assert.throws(() => readRuntimeSettings(env), /outside/);
    if (existsSync(join(homedir(), ".orchiva")) && existsSync(join(homedir(), ".paseo-orchiva"))) assert.throws(() => readRuntimeSettings({ ...env, ORCHIVA_ISOLATION_ROOT: homedir(), ORCHIVA_DATA_HOME: join(homedir(), ".orchiva"), ORCHIVA_PASEO_HOME: join(homedir(), ".paseo-orchiva") }), /production home excluded/);
  } finally {
    const delta = relative(tmpdir(), root); assert.ok(delta && !delta.startsWith("..") && !isAbsolute(delta));
    await rm(root, { recursive: true, force: true });
  }
});
