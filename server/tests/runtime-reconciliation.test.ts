import { test } from "node:test";
import assert from "node:assert/strict";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { findMessage, reconcileCandidates } from "../adapters/paseo/reconciliation";
import { performEffect, type EffectCheckpoint, type EffectStore } from "../application/effect-checkpoint";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
const page = (values: Partial<Page> = {}): Page => ({ epoch: "e", hasOlder: false, gap: false, staleCursor: false, reset: false, entries: [], ...values } as Page);
const message = { item: { type: "user_message", clientMessageId: "m", text: "fix" }, seqEnd: 3 } as Page["entries"][number];

test("message lookup searches before the latest window and checks the original payload", async () => {
  let calls = 0;
  const timeline = { refetch: async (options: Parameters<PaseoAgentTimelineHandle["refetch"]>[0]) => {
    if (++calls === 1) return page({ hasOlder: true, startCursor: { epoch: "e", seq: 100 } });
    assert.equal(options?.direction, "before"); return page({ entries: [message] });
  } };
  assert.equal((await findMessage(timeline, "m", "fix")).kind, "found"); assert.equal(calls, 2);
  assert.equal((await findMessage({ refetch: async () => page({ entries: [message] }) }, "m", "different")).kind, "unknown");
});

test("history absence is distinct from gaps, failures, resets and an exhausted page budget", async () => {
  assert.equal((await findMessage({ refetch: async () => page() }, "m")).kind, "absent");
  for (const value of [page({ gap: true }), page({ staleCursor: true }), page({ hasOlder: true }), page({ entries: [message, message] })]) {
    assert.equal((await findMessage({ refetch: async () => value }, "m")).kind, "unknown");
  }
  assert.equal((await findMessage({ refetch: async () => { throw Error("offline"); } }, "m")).kind, "unknown");
  let seq = 100;
  assert.equal((await findMessage({ refetch: async () => page({ hasOlder: true, startCursor: { epoch: "e", seq: seq-- } }) }, "m", undefined, 2)).kind, "unknown");
  let calls = 0;
  assert.equal((await findMessage({ refetch: async () => ++calls === 1 ? page({ hasOlder: true, startCursor: { epoch: "e", seq: 5 } }) : page({ epoch: "changed", entries: [message] }) }, "m")).kind, "unknown");
});

test("incomplete or ambiguous resource inventories cannot authorize a retry", () => {
  assert.equal(reconcileCandidates([], () => true, false).kind, "unknown");
  assert.equal(reconcileCandidates([1, 1], () => true, true).kind, "unknown");
  assert.equal(reconcileCandidates([1], () => true, true).kind, "found");
  assert.equal(reconcileCandidates([], () => true, true).kind, "absent");
});

test("provider-restored user messages without client IDs cannot prove non-delivery", async () => {
  const restored = { ...message, item: { type: "user_message", text: "fix", messageId: "provider-native-id" } } as Page["entries"][number];
  const result = await findMessage({ refetch: async () => page({ entries: [restored] }) }, "m", "fix");
  assert.equal(result.kind, "unknown");
});

for (const boundary of ["B1", "B2", "B3", "B4"] as const) {
  test(`durable effect recovery at ${boundary} never duplicates a confirmed effect`, async () => {
    let saved: EffectCheckpoint<string> | null = null, effects = 0, crashed = false;
    const store: EffectStore<string> = {
      read: async () => saved && structuredClone(saved),
      write: async value => {
        if (!crashed && ((boundary === "B1" && value.state === "pending") || (boundary === "B3" && value.state === "applied"))) {
          if (boundary === "B1") saved = structuredClone(value);
          crashed = true; throw Error("process lost");
        }
        saved = structuredClone(value);
      },
    };
    const input = { key: "key", payloadHash: "hash" };
    const effect = { apply: async () => { effects++; if (boundary === "B2" && !crashed) { crashed = true; throw Error("response lost"); } return "resource"; },
      lookup: async () => effects ? { kind: "found" as const, value: "resource" } : { kind: "absent" as const }, retryAbsent: true };
    await performEffect(input, store, effect).catch(() => undefined);
    assert.equal((await performEffect(input, store, effect)).kind, "found");
    assert.equal((await performEffect(input, store, effect)).kind, "found");
    assert.equal(effects, 1);
    await assert.rejects(performEffect({ ...input, payloadHash: "changed" }, store, effect), /CONFLICT/);
  });
}

test("unknown or unproven absence stays pending for review, without another side effect", async () => {
  let writes = 0;
  const store: EffectStore<string> = { read: async () => ({ key: "k", payloadHash: "h", state: "unknown" }), write: async () => {} };
  for (const kind of ["absent", "unknown"] as const) {
    const result = await performEffect({ key: "k", payloadHash: "h" }, store, { lookup: async () => kind === "absent" ? { kind } : { kind, reason: "offline" }, apply: async () => { writes++; return "bad"; } });
    assert.equal(result.kind, "unknown");
  }
  assert.equal(writes, 0);
});
