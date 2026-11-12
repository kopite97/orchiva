import { randomUUID } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { Reconciler } from "../../application/reconcile";
import type { RequestStore } from "../../application/ports";
import type { StartFeatureRequest } from "../../application/start-feature-request";
import type { TrackExecution } from "../../application/track-execution";
import { localConnection } from "./connection";
import { PaseoRuntime } from "./runtime";
import { configDirectory, loadConfig } from "../../config/project-config";

export function createReconciler(store: RequestStore, starter: StartFeatureRequest, tracker: TrackExecution) {
  return new Reconciler(store, starter, tracker, () => {
    const owner = localConnection(`orchiva-runtime-${randomUUID()}`);
    return { runtime: async () => new PaseoRuntime(await owner.start(), await loadConfig()), ping: async () => { await (await owner.start()).agents.list(); }, close: () => owner.dispose() };
  }, { report: async status => {
    const path = join(configDirectory, "runtime-status.json"), temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ ...status, pid: process.pid }), "utf8"); await rename(temp, path);
  } });
}
