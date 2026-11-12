import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { configRpc, listRpc, startRpc, refreshRpc, resumeRpc, reviewRpc, diagnosticsRpc, revalidateRpc } from "./shared/contracts/feature-request";
import { configDirectory, loadConfig } from "./server/config/project-config";
import { JsonRequestStore } from "./server/adapters/storage/json-request-store";
import { PaseoRuntime } from "./server/adapters/paseo/runtime";
import { StartFeatureRequest } from "./server/application/start-feature-request";
import { TrackExecution } from "./server/application/track-execution";
import { startM0Probe } from "./server/adapters/paseo/m0-probe";

export default function contribute(server: PluginServerContext) {
  const stopProbe = startM0Probe();
  const store = new JsonRequestStore(join(configDirectory, "requests"));
  // SDK 0.15.4 requires synchronous contribution registration. All entry points
  // await ownership/migration; a rejected startup disables this instance's work.
  const ready = store.open().then(() => store.list()).then(() => undefined);
  void ready.catch(() => undefined);
  const start = new StartFeatureRequest(store);
  const tracker = new TrackExecution(store, start.locks);
  const runtime = async (paseo: Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"]) => { await ready; return new PaseoRuntime(paseo, await loadConfig()); };
  server.handle(configRpc, async () => { await ready; stopProbe.rpc(); return loadConfig(); });
  server.handle(listRpc, async () => {
    stopProbe.rpc();
    await ready;
    return store.list();
  });
  server.handle(diagnosticsRpc, async () => { await ready; return store.diagnostics(); });
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
