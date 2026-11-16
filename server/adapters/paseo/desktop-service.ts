import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectsRpc as p } from "../../../shared/contracts/desktop-project";
import { productionRpc as r } from "../../../shared/contracts/desktop-production";
import { Projects } from "../../application/desktop/projects";
import { ProductionService } from "../../application/desktop/production";
import { ProductionArtifacts } from "../../application/desktop/artifacts";
import type { RequestStore } from "../../application/ports";
import { localConnection } from "./connection";
import { conversationRpc as c, viewConversation } from "../../../shared/contracts/desktop-conversation";
import { Conversations } from "../../application/desktop/conversations";
import { PaseoConversationRuntime } from "./conversation-runtime";

export function contributeDesktop(server: PluginServerContext, legacy: RequestStore, dataHome: string, ready: Promise<void>) {
  const projects = new Projects(join(dataHome, "desktop")), connection = localConnection(`orchiva-desktop-service-${process.pid}`);
  const service = new ProductionService(projects, legacy, () => connection.start(), undefined, async id => (await connection.start()).cancelAgent(id)), artifacts = new ProductionArtifacts(service);
  const conversationRuntime = new PaseoConversationRuntime(() => connection.start(), async id => (await connection.start()).cancelAgent(id), join(dataHome, "desktop", "conversation-outcomes"));
  const conversations = new Conversations(service, conversationRuntime);
  const removeConversationHook = server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    const snapshot = await paseo.agents.ref(agent.id).refresh();
    if (snapshot?.agent.labels.orchivaConversation && turnId) {
      const timeline = paseo.agents.ref(agent.id).timeline;
      let cursor: Parameters<typeof timeline.refetch>[0], epoch: string | undefined;
      for (let n = 0; n < 30; n++) {
        const page = await timeline.refetch(cursor ?? { direction: "tail", limit: 100 });
        if (page.gap || page.staleCursor || (n > 0 && page.reset) || (epoch && epoch !== page.epoch)) break;
        epoch = page.epoch;
        const user = page.entries.filter(e => e.item.type === "user_message").at(-1);
        if (user) {
          if (user.turnId === turnId && user.item.type === "user_message" && user.item.clientMessageId) { await conversationRuntime.recordOutcome(agent.id, user.item.clientMessageId, turnId, outcome.kind); conversations.wake(); }
          break;
        }
        if (!page.hasOlder || !page.startCursor) break;
        cursor = { direction: "before", cursor: page.startCursor, limit: 100 };
      }
    }
  });
  let stopped = false;
  const opened = ready.then(() => projects.open());
  void opened.then(() => { if (!stopped) { service.startWorker(); conversations.startWorker(); } }).catch(() => undefined);
  // Register synchronously, before SDK contribution collection completes.
  server.handle(c["desktop.conversations.list"], async i => { await opened; return conversations.list(i.projectId); });
  server.handle(c["desktop.conversations.create"], async i => { await opened; return viewConversation(await conversations.create(i)); });
  server.handle(c["desktop.conversations.get"], async i => { await opened; return viewConversation(await conversations.required(i)); });
  server.handle(c["desktop.conversations.turn"], async i => { await opened; const turn = (await conversations.required(i)).turns.find(t => t.id === i.turnId); if (!turn) throw new Error("NOT_FOUND"); return turn; });
  server.handle(c["desktop.conversations.send"], async i => { await opened; return viewConversation(await conversations.send(i)); });
  server.handle(c["desktop.conversations.attention"], async i => { await opened; return conversations.attention(i); });
  server.handle(c["desktop.conversations.permission"], async i => { await opened; return viewConversation(await conversations.permission(i)); });
  server.handle(c["desktop.conversations.stop"], async i => { await opened; return viewConversation(await conversations.stop(i)); });
  server.handle(p["desktop.projects.list"], async () => { await opened; return projects.list(); });
  server.handle(p["desktop.projects.register"], async i => { await opened; return projects.register(i.sourceRoot, i.name); });
  server.handle(p["desktop.projects.preview"], async i => { await opened; return projects.preview(i.projectId); });
  server.handle(p["desktop.projects.initialize"], async i => { await opened; return projects.initialize(i.projectId, i.fingerprint, i.commandKey); });
  server.handle(p["desktop.projects.configure"], async i => { await opened; return projects.configure(i.projectId, i.expectedRevision, i); });
  server.handle(p["desktop.instructions.read"], async i => { await opened; return projects.instructions(i.projectId); });
  server.handle(p["desktop.instructions.save"], async i => { await opened; return projects.saveInstruction(i.projectId, i.path, i.expectedHash, i.content, i.scope); });
  server.handle(r["desktop.models"], async i => { await opened; return service.models(i.projectId); });
  server.handle(r["desktop.requests.list"], async i => { await opened; return service.list(i.projectId); });
  server.handle(r["desktop.requests.get"], async i => { await opened; return service.required(i.projectId, i.token); });
  server.handle(r["desktop.requests.save"], async i => { await opened; return service.save(i); });
  server.handle(r["desktop.requests.plan"], async i => { await opened; return service.plan(i); });
  server.handle(r["desktop.requests.sync-plan"], async i => { await opened; return service.syncPlan(i); });
  server.handle(r["desktop.requests.start"], async i => { await opened; return service.start(i); });
  server.handle(r["desktop.requests.observe"], async i => { await opened; return service.observe(i.projectId, i.token); });
  server.handle(r["desktop.requests.stop"], async i => { await opened; return service.stop(i); });
  server.handle(r["desktop.requests.attention"], async i => { await opened; return service.attention(i.projectId, i.token); });
  server.handle(r["desktop.requests.permission"], async i => { await opened; return service.permission(i); });
  server.handle(r["desktop.requests.resume"], async i => { await opened; return service.engineCommand("resume", i); });
  server.handle(r["desktop.requests.revalidate"], async i => { await opened; return service.engineCommand("revalidate", i); });
  server.handle(r["desktop.requests.retry"], async i => { await opened; return service.engineCommand("retry", i); });
  server.handle(r["desktop.requests.reconcile"], async i => { await opened; return service.engineCommand("reconcile", i); });
  server.handle(r["desktop.requests.review"], async i => { await opened; return service.review(i); });
  server.handle(r["desktop.requests.export"], async i => { await opened; return artifacts.export(i); });
  server.handle(r["desktop.requests.diff"], async i => { await opened; return artifacts.preview(i.projectId, i.token, i.resultId); });
  server.handle(r["desktop.requests.apply"], async i => { await opened; return artifacts.apply(i); });
  server.handle(r["desktop.requests.undo"], async i => { await opened; return artifacts.undo(i.projectId, i.token, i.resultId, i.transferKey); });
  server.handle(r["desktop.requests.transfers"], async i => { await opened; return artifacts.transfers(i.projectId, i.token, i.resultId); });
  server.handle(r["desktop.requests.import-legacy"], async i => { await opened; return service.importLegacy(i.projectId, i.token, i.commandKey, await readFile(join(dataHome, "requests", i.token + ".json"), "utf8")); });
  return { service, close: async () => { stopped = true; await opened.catch(() => undefined); await conversations.close(); removeConversationHook(); await service.close(); await connection.dispose(); await projects.close(); } };
}
