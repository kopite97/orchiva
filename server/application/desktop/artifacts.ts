import { mkdir, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ProductionService } from "./production";
import { bytes, digest, immutable, relativeFile, safePath, absent, inside } from "../../adapters/storage/project-files";
import { internalFile, loadSnapshot } from "./snapshots";
import { applyTransfer, previewTransfer, readTransfer, transferManifest, undoTransfer, type TransferManifest } from "./transfers";
import { occupiesSlot } from "../../domain/record-v2";
type Command = { projectId: string; token: string; expectedRevision: number; commandKey: string; resultId: string };
export class ProductionArtifacts {
  constructor(private service: ProductionService) {}
  private file(token: string, result: string) { relativeFile(token); relativeFile(result); return `docs/.orchiva/exports/${token}/${result}.json`; }
  async manifest(id: string, token: string, resultId: string) {
    const doc = await this.service.required(id, token), store = await this.service.store(id), entry = doc.exports.find(x => x.resultId === resultId);
    const raw = await bytes(store.root, this.file(token, resultId), 24 * 1024 * 1024);
    if (!entry || !raw || digest(raw) !== entry.manifestHash) throw new Error("EXPORT_REQUIRED_OR_CHANGED");
    const manifest = transferManifest.parse(JSON.parse(raw.toString("utf8")));
    if (manifest.projectId !== id || manifest.token !== token || manifest.resultId !== resultId) throw new Error("EXPORT_IDENTITY_MISMATCH");
    return manifest;
  }
  async export(input: Command) {
    return this.service.projects.exclusive(async () => {
      const doc = await this.service.required(input.projectId, input.token), store = await this.service.store(input.projectId);
      const prior = doc.journals.find(x => x.key === input.commandKey), payloadHash = digest(JSON.stringify({ resultId: input.resultId }));
      if (prior) { if (prior.kind !== "export" || prior.payloadHash !== payloadHash) throw new Error("IDEMPOTENCY_CONFLICT"); if (prior.state === "applied") return doc; }
      let journal = prior ?? doc.journals.find(x => x.kind === "export" && x.payloadHash === payloadHash && x.state === "pending");
      if (!journal && doc.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
      await this.service.assertSlot(input);
      const result = doc.engine.result, review = doc.reviews.at(-1);
      if (!result || result.id !== input.resultId || !review?.approved || review.resultId !== result.id || doc.engine.status !== "completed") throw new Error("APPROVED_RESULT_REQUIRED");
      const exported = doc.exports.find(x => x.resultId === result.id);
      if (exported) { doc.journals.push({ key: input.commandKey, kind: "export", payloadHash, state: "applied", phase: "done", outcome: exported.manifestHash, at: new Date().toISOString() }); await store.put(doc); return doc; }
      if (!journal) {
      if (await (await this.service.runtime(doc)).fingerprint(doc.engine) !== result.fingerprint) throw new Error("RESULT_CHANGED");
      const plan = doc.planVersions.find(x => x.revision === doc.engine.confirmedPlanRevision)!;
      const snapshot = await loadSnapshot(store.root, plan.snapshotId), refs = (await this.service.projects.instructions(input.projectId)).files.map(x => x.path);
      const files: TransferManifest["files"] = [];
      for (const path of result.changedFiles) {
        relativeFile(path);
        if (internalFile(path) || refs.includes(path) || /(^|\/)AGENTS\.md$/i.test(path)) continue;
        const before = snapshot.files.find(x => x.path === path)?.hash ?? null, content = await bytes(doc.engine.worktreePath!, path), after = content ? digest(content) : null;
        if (before !== after) files.push({ path, before, after, content: content?.toString("base64") ?? null });
      }
      if (!files.length) throw new Error("NO_OUTPUT_CHANGES");
      const manifest: TransferManifest = { version: 1, projectId: input.projectId, token: doc.token, resultId: result.id, fingerprint: result.fingerprint, files };
      const serialized = JSON.stringify(manifest), manifestHash = digest(serialized);
      if (Buffer.byteLength(serialized) > 24 * 1024 * 1024) throw new Error("EXPORT_SIZE_LIMIT");
      await immutable(store.root, this.file(doc.token, result.id), serialized);
      const outputRoot = await this.service.projects.output(input.projectId), folder = [doc.input.outputPath, doc.planName, result.id].filter(Boolean).join("/");
      journal = { key: input.commandKey, kind: "export", payloadHash, state: "pending", phase: "files", outcome: JSON.stringify({ outputRoot, folder, manifestHash }), at: new Date().toISOString() }; doc.journals.push(journal); await store.put(doc);
      }
      const intent = JSON.parse(journal.outcome!), outputRoot = await realpath(intent.outputRoot);
      if (outputRoot.toLowerCase() !== intent.outputRoot.toLowerCase() || inside(store.root, outputRoot) || inside(outputRoot, store.root)) throw new Error("SOURCE_OUTPUT_OVERLAP");
      const serialized = await bytes(store.root, this.file(doc.token, result.id), 24 * 1024 * 1024);
      if (!serialized || digest(serialized) !== intent.manifestHash) throw new Error("EXPORT_REQUIRED_OR_CHANGED");
      const manifest = transferManifest.parse(JSON.parse(serialized.toString("utf8")));
      const root = await safePath(outputRoot, intent.folder); await mkdir(root, { recursive: true });
      for (const file of manifest.files) if (file.content !== null) await immutable(root, file.path, Buffer.from(file.content, "base64"));
      doc.exports.push({ resultId: result.id, root, manifestHash: intent.manifestHash, at: new Date().toISOString() });
      journal.state = "applied"; journal.phase = "done";
      if (journal.key !== input.commandKey) doc.journals.push({ key: input.commandKey, kind: "export", payloadHash, state: "applied", phase: "done", outcome: intent.manifestHash, at: new Date().toISOString() });
      await store.put(doc); return doc;
    });
  }
  async preview(id: string, token: string, resultId: string) { const store = await this.service.store(id); return { files: await previewTransfer(store.root, await this.manifest(id, token, resultId)) }; }
  async transfers(id: string, token: string, resultId: string) {
    const store = await this.service.store(id), manifestHash = digest(JSON.stringify(await this.manifest(id, token, resultId)));
    let files: string[];
    try { files = await readdir(await safePath(store.root, "docs/.orchiva/transfers")); } catch (error) { if (absent(error)) return []; throw error; }
    const result = [];
    for (const file of files.filter(x => x.endsWith(".json"))) { const journal = await readTransfer(store.root, file.slice(0, -5)); if (journal?.manifestHash === manifestHash) result.push(journal); }
    return result;
  }
  async apply(input: Command & { paths: string[] }) {
    return this.service.projects.exclusive(async () => {
      const store = await this.service.store(input.projectId), doc = await this.service.required(input.projectId, input.token);
      const payloadHash = digest(JSON.stringify({ resultId: input.resultId, paths: [...new Set(input.paths)].sort() })), prior = doc.journals.find(x => x.key === input.commandKey);
      if (prior && (prior.kind !== "apply" || prior.payloadHash !== payloadHash)) throw new Error("IDEMPOTENCY_CONFLICT");
      if (prior?.state === "applied") { const result = await readTransfer(store.root, input.commandKey); if (!result) throw new Error("TRANSFER_NOT_FOUND"); return result; }
      if (prior?.state === "failed") throw new Error("TRANSFER_INCOMPLETE");
      await this.service.assertSlot(input); await this.service.projects.own(store.root);
      if (occupiesSlot(doc.engine) || doc.journals.some(x => x.key !== input.commandKey && ["pending", "unknown"].includes(x.state))) throw new Error("TRANSFER_INCOMPLETE");
      if (!prior && !await readTransfer(store.root, input.commandKey) && doc.revision !== input.expectedRevision) throw new Error("REVISION_CONFLICT");
      const manifest = await this.manifest(input.projectId, input.token, input.resultId);
      const journal = prior ?? { key: input.commandKey, kind: "apply", payloadHash, state: "pending" as const, phase: "files", outcome: input.resultId, at: new Date().toISOString() };
      if (!prior) { doc.journals.push(journal); await store.put(doc); }
      try { const result = await applyTransfer(store.root, manifest, input.commandKey, input.paths); journal.state = "applied"; journal.phase = "done"; await store.put(doc); return result; }
      catch (error) { if (!await readTransfer(store.root, input.commandKey)) { journal.state = "failed"; await store.put(doc); } throw error; }
    });
  }
  async undo(id: string, token: string, resultId: string, key: string) {
    return this.service.projects.exclusive(async () => {
      await this.service.assertSlot({ projectId: id, token }); const store = await this.service.store(id), doc = await this.service.required(id, token); await this.service.projects.own(store.root);
      if (occupiesSlot(doc.engine)) throw new Error("GLOBAL_EXECUTION_BUSY");
      const manifest = await this.manifest(id, token, resultId), journal = await readTransfer(store.root, key);
      if (!journal || journal.manifestHash !== digest(JSON.stringify(manifest))) throw new Error("TRANSFER_IDENTITY_MISMATCH");
      const result = await undoTransfer(store.root, key), pending = doc.journals.find(x => x.key === key && x.kind === "apply" && x.state === "pending");
      if (pending) { pending.state = "applied"; pending.phase = "undone"; await store.put(doc); } return result;
    });
  }
}
