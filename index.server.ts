import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { configRpc, listRpc, startRpc, refreshRpc, resumeRpc, reviewRpc, diagnosticsRpc, revalidateRpc, saveDraftRpc, preparePlanRpc, getRpc, preflightRpc } from "./shared/contracts/feature-request";
import { configDirectory, loadConfig } from "./server/config/project-config";
import { JsonRequestStore } from "./server/adapters/storage/json-request-store";
import { PaseoRuntime } from "./server/adapters/paseo/runtime";
import { StartFeatureRequest } from "./server/application/start-feature-request";
import { TrackExecution } from "./server/application/track-execution";
import { startM0Probe } from "./server/adapters/paseo/m0-probe";
import { DraftRequest } from "./server/application/draft-request";

export default function contribute(server: PluginServerContext) {
  const stopProbe = startM0Probe();
  const store = new JsonRequestStore(join(configDirectory, "requests"));
  // SDK 0.15.4 requires synchronous contribution registration. All entry points
  // await ownership/migration; a rejected startup disables this instance's work.
  const ready = store.open().then(() => store.list()).then(() => undefined);
  void ready.catch(() => undefined);
  const start = new StartFeatureRequest(store);
  const drafts = new DraftRequest(store);
  const tracker = new TrackExecution(store, start.locks);
  const runtime = async (paseo: Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"]) => { await ready; return new PaseoRuntime(paseo, await loadConfig()); };
  server.handle(configRpc, async () => { await ready; stopProbe.rpc(); return loadConfig(); });
  server.handle(listRpc, async () => {
    stopProbe.rpc();
    await ready;
    return store.list();
  });
  server.handle(diagnosticsRpc, async () => { await ready; return store.diagnostics(); });
  server.handle(getRpc, async ({ token }) => { await ready; return store.get(token); });
  server.handle(saveDraftRpc, async input => { await ready; return drafts.save(input); });
  server.handle(preparePlanRpc, async (input, { paseo }) => drafts.prepare(input, await runtime(paseo)));
  server.handle(preflightRpc, async (_, { paseo }) => {
    try { const result = await (await runtime(paseo)).preflight([]); return { ready: true, baseCommit: result.baseCommit, checks: [{ label: "실행 환경", passed: true, detail: "저장소·기준 브랜치·daemon·Codex 경로 확인 완료" }] }; }
    catch (error) { return { ready: false, baseCommit: null, checks: [{ label: "실행 환경", passed: false, detail: error instanceof Error ? error.message : String(error) }] }; }
  });
  server.handle(revalidateRpc, async (input, { paseo }) => tracker.refresh(input.token, await runtime(paseo), undefined, true, input));
  server.handle(startRpc, async (input, { paseo }) => { stopProbe.rpc(); return start.start(input, await runtime(paseo)); });
  server.handle(refreshRpc, async ({ token, revalidate }, { paseo }) => { stopProbe.rpc(); return tracker.refresh(token, await runtime(paseo), undefined, revalidate); });
  server.handle(resumeRpc, async (input, { paseo }) => { stopProbe.rpc(); return tracker.resume(input, await runtime(paseo)); });
  server.handle(reviewRpc, async (input, { paseo }) => { stopProbe.rpc(); return tracker.review(input, await runtime(paseo)); });
  const sync = async (agentId: string, workspaceId: string | null, paseo: Parameters<typeof runtime>[0], outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }) => {
    await ready;
    const records = await store.list();
    const record = records.find(item => item.agentId === agentId || (!item.agentId && item.workspaceId && item.workspaceId === workspaceId));
    if (record) await tracker.refresh(record.token, await runtime(paseo), outcome);
  };
  const remove = [
    server.addHook("agent.turn.before", async ({ agent }, { paseo }) => sync(agent.id, agent.workspaceId, paseo)),
    server.addHook("agent.turn.after", async ({ agent, outcome, turnId }, { paseo }) => sync(agent.id, agent.workspaceId, paseo, { ...outcome, turnId })),
    server.addHook("agent.permission.before", async ({ agent }, { paseo }) => sync(agent.id, agent.workspaceId, paseo)),
    server.addHook("agent.permission.after", async ({ agent }, { paseo }) => sync(agent.id, agent.workspaceId, paseo)),
  ];
  return async () => { remove.forEach(dispose => dispose()); await ready.catch(() => undefined); try { await store.close(); } finally { await stopProbe(); } };
}
