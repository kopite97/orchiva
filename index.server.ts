import type { PluginServerContext } from "@getpaseo/plugin/server";
import { join } from "node:path";
import { configRpc, listRpc, startRpc, refreshRpc, resumeRpc, reviewRpc } from "./shared/contracts/feature-request";
import { configDirectory, loadConfig } from "./server/config/project-config";
import { JsonRequestStore } from "./server/adapters/storage/json-request-store";
import { PaseoRuntime } from "./server/adapters/paseo/runtime";
import { StartFeatureRequest } from "./server/application/start-feature-request";
import { TrackExecution } from "./server/application/track-execution";

export default function contribute(server: PluginServerContext) {
  const store = new JsonRequestStore(join(configDirectory, "requests"));
  const start = new StartFeatureRequest(store);
  const tracker = new TrackExecution(store, start.locks);
  const runtime = async (paseo: Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"]) => new PaseoRuntime(paseo, await loadConfig());
  server.handle(configRpc, () => loadConfig());
  server.handle(listRpc, async (_, { paseo }) => {
    const adapter = await runtime(paseo);
    // Polling is also recovery: reconstruct state when hooks were missed during reload.
    const records = await store.list();
    for (const record of records) if (record.agentId && record.status !== "completed") await tracker.refresh(record.token, adapter);
    return store.list();
  });
  server.handle(startRpc, async (input, { paseo }) => start.start(input, new PaseoRuntime(paseo, await loadConfig())));
  server.handle(refreshRpc, async ({ token, revalidate }, { paseo }) => tracker.refresh(token, await runtime(paseo), undefined, revalidate));
  server.handle(resumeRpc, async (input, { paseo }) => tracker.resume(input, await runtime(paseo)));
  server.handle(reviewRpc, async (input, { paseo }) => tracker.review(input, await runtime(paseo)));
  const sync = async (agentId: string, workspaceId: string | null, paseo: Parameters<typeof runtime>[0], outcome?: { kind: string; error?: { message: string }; reason?: string; turnId?: string | null }) => {
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
  return () => remove.forEach(dispose => dispose());
}
