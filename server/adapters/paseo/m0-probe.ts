import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { assertWorktree, configDirectory, loadConfig } from "../../config/project-config";
import { localConnection } from "./connection";

/** Explicit local opt-in. Read-only observer, not the M3 production scheduler. */
export function startM0Probe(): (() => Promise<void>) & { rpc(): void } {
  const controller = new AbortController();
  const generation = randomUUID();
  let rpcCalls = 0;
  const owner = localConnection(`orchiva-m0-plugin-${generation}`);
  let record: ((event: string, extra?: object) => Promise<void>) | undefined;
  const job = (async () => {
    let raw: string;
    try { raw = await readFile(join(configDirectory, "m0-probe.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (controller.signal.aborted) return;
    const options = z.object({ runId: z.string().regex(/^m0-[a-zA-Z0-9-]{8,80}$/), agentId: z.string().uuid() }).parse(JSON.parse(raw));
    const directory = join(configDirectory, "m0", options.runId);
    await mkdir(directory, { recursive: true });
    record = (event, extra = {}) => appendFile(join(directory, "plugin.jsonl"), JSON.stringify({ event, generation, pid: process.pid, at: new Date().toISOString(), ...extra }) + "\n", "utf8");
    await record("starting");
    if (controller.signal.aborted) return;
    const api = await owner.start();
    const agent = api.agents.ref(options.agentId);
    while (!controller.signal.aborted) {
      const observed = await agent.refresh();
      if (!observed || !agent.cwd) throw new Error("Probe target unavailable.");
      await assertWorktree(await loadConfig(), agent.cwd);
      if (controller.signal.aborted) break;
      await record("observed", { agentId: agent.id, status: agent.status, rpcCalls });
      await delay(1000, undefined, { signal: controller.signal });
    }
  })().catch(async () => {
    if (!controller.signal.aborted) await record?.("failed");
  }).finally(async () => {
    await owner.dispose();
    await record?.("closed");
  });
  return Object.assign(async () => { controller.abort(); await owner.dispose(); await job; }, { rpc: () => { rpcCalls++; } });
}
