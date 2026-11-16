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

export function contributeDesktop(server: PluginServerContext, legacy: RequestStore, dataHome: string, ready: Promise<void>) {
  const projects = new Projects(join(dataHome, "desktop")), connection = localConnection(`orchiva-desktop-service-${process.pid}`);
  const service = new ProductionService(projects, legacy, () => connection.start(), undefined, async id => (await connection.start()).cancelAgent(id)), artifacts = new ProductionArtifacts(service);
  let stopped = false;
  const opened = ready.then(() => projects.open());
  void opened.then(() => { if (!stopped) service.startWorker(); }).catch(() => undefined);
  // Register synchronously, before SDK contribution collection completes.
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
  return { service, close: async () => { stopped = true; await opened.catch(() => undefined); await service.close(); await connection.dispose(); await projects.close(); } };
}
