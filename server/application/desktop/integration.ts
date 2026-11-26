import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { z } from "zod";
import { type Integration, type Settings, type Entry, settings as policySchema, integrationRecord, publication } from "../../../shared/contracts/milestone-integration";
import type { Run } from "../../../shared/contracts/milestone-run";
import type { ProductionArtifacts } from "./artifacts";
import type { ProductionService } from "./production";
import { atomic, bytes, digest, immutable, safePath } from "../../adapters/storage/project-files";
import { payloadHash } from "../../domain/record-v2";
import { advanceRef, featureCommit, gitText, initializeRepo, ref, treeFile, verifiedFiles } from "../../adapters/storage/integration-git";
import { GhApi, GithubPublication, lf, publicDocument, type GithubApi } from "../../adapters/github/milestone-github";

import { loadSnapshot } from "./snapshots";
import { validateParallelBase } from "./milestone-validation";

export class Integrations {
  constructor(readonly production: ProductionService, private artifacts: ProductionArtifacts, private github: GithubApi = new GhApi()) { }
  private dir(project: string, run: string) { return join(this.production.projects.directory, "integrations", project, run); }
  repo(project: string) { return join(this.production.projects.directory, "integrations", project, "repository.git"); }
  async get(project: string, run: string): Promise<Integration | null> {
    const directory = this.dir(project, run);
    let data;
    try { data = await bytes(directory, "integration.json", 8 * 1024 * 1024); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    if (!data) return null;
    const value = integrationRecord.parse(JSON.parse(data.toString()));
    if (value.projectId !== project || value.runId !== run) throw new Error("INTEGRATION_IDENTITY_INVALID");
    return value;
  }
  private async save(state: Integration) {
    await atomic(await safePath(this.dir(state.projectId, state.runId), "integration.json"), JSON.stringify(state));
  }
  async policy(project: string) {
    await this.production.projects.project(project);
    const raw = await bytes(this.production.projects.directory, "integrations/" + project + "/policy.json");
    return raw ? policySchema.parse(JSON.parse(raw.toString())) : null;
  }
  async configure(run: Run, settings: Settings) {
    if (run.integration && payloadHash(run.integration) !== payloadHash(settings)) throw new Error("INTEGRATION_POLICY_LOCKED");
    const existing = await this.get(run.projectId, run.runId);
    if (existing) {
      if (payloadHash(existing.settings) !== payloadHash(settings) || existing.scopeHash !== run.scopeHash) throw new Error("INTEGRATION_POLICY_LOCKED");
      const { sourceRoot } = await this.production.projects.project(run.projectId);
      await this.ensureRepo(existing, sourceRoot);
      if (!await this.policy(run.projectId)) await this.savePolicy(run.projectId, settings);
      return existing;
    }
    if (settings.target === settings.headPrefix || settings.target.startsWith(settings.headPrefix + "/") || settings.github?.base.startsWith(settings.headPrefix + "/")) throw new Error("INTEGRATION_POLICY_INVALID");
    const { sourceRoot } = await this.production.projects.project(run.projectId);
    const dir = this.dir(run.projectId, run.runId); await mkdir(dir, { recursive: true });
    const repo = this.repo(run.projectId);
    await initializeRepo(repo, sourceRoot, run.scope.baseCommit);
    const initial = await ref(repo, settings.target) ?? run.scope.baseCommit;
    if (initial !== run.scope.baseCommit) {
      await gitText(repo, ["merge-base", "--is-ancestor", run.scope.baseCommit, initial]);
      if (run.integration) await gitText(sourceRoot, ["fetch", "--no-tags", "--no-write-fetch-head", repo, initial]);
    }
    const state: Integration = { version: 1, projectId: run.projectId, runId: run.runId, scopeHash: run.scopeHash, initial, settings, entries: [] };
    await this.save(state); await this.ensureRepo(state, sourceRoot);
    await this.savePolicy(run.projectId, settings);
    return state;
  }
  private async savePolicy(project: string, settings: Settings) {
    await atomic(await safePath(this.production.projects.directory, "integrations/" + project + "/policy.json"), JSON.stringify(settings));
  }
  private async ensureRepo(state: Integration, source: string) {
    const repo = this.repo(state.projectId);
    if (!existsSync(join(repo, "HEAD"))) await initializeRepo(repo, source, state.initial);
    else try { await gitText(repo, ["cat-file", "-e", state.initial + "^{commit}"]); }
    catch { await initializeRepo(repo, source, state.initial); }
    if (!state.entries.length) await advanceRef(repo, state.settings.target, null, state.initial);
    return repo;
  }
  async outputs(run: Run) {
    const state = await this.get(run.projectId, run.runId);
    if (!state) throw new Error("INTEGRATION_REQUIRED");
    return state.entries.filter(e => e.integrated);
  }
  private async approved(run: Run, node: Run["nodes"][number]) {
    const doc = await this.production.required(run.projectId, node.token);
    const result = doc.engine.result, review = doc.reviews.at(-1), bound = doc.milestone;
    if (!bound || Boolean(run.integration)!==Boolean(bound.integrationBase) || bound.coordinator || bound.runId !== run.runId || bound.item !== node.id || bound.scopeHash !== run.scopeHash ||
      !result || doc.engine.status !== "completed" || result.failure || result.executionFailure ||
      !review?.approved || review.resultId !== result.id || review.fingerprint !== result.fingerprint ||
      (node.status === "accepted" && (node.resultId !== result.id || node.fingerprint !== result.fingerprint)) ||
      bound.checks.length !== result.checks.length || result.checks.some((c, i) => !c.passed || c.inputFingerprint !== bound.checks[i].hash)) throw new Error("INTEGRATION_APPROVAL_REQUIRED");
    const plan = doc.planVersions.find(p => p.revision === doc.engine.confirmedPlanRevision);
    const exported = doc.exports.find(e => e.resultId === result.id);
    if (!plan || !exported) throw new Error("EXPORT_REQUIRED_OR_CHANGED");
    const manifest = await this.artifacts.manifest(run.projectId, node.token, result.id);
    if (manifest.fingerprint !== result.fingerprint) throw new Error("INTEGRATION_MANIFEST_INVALID");
    const spec = run.scope.nodes.find(n => n.id === node.id)!;
    if (payloadHash(spec.outputs) !== payloadHash(bound.outputs)) throw new Error("INTEGRATION_MANIFEST_INVALID");
    const files = verifiedFiles(manifest, spec.outputs);
    if (!bound.integrationBase && node.status === "accepted") {
      const applied = (await this.artifacts.transfers(run.projectId, node.token, result.id)).filter(t => node.transfers.includes(t.key) && t.state === "applied");
      if (files.some(f => !node.files.some(p => p.path === f.path && p.hash === f.after) || !applied.some(t => t.files.some(p => p.path === f.path && p.after === f.after)))) throw new Error("MILESTONE_TRANSFER_CHANGED");
    }
    return { result, review, plan, exported, files, bound };
  }
  // Called inside the project writer lock. Each intent survives a lost RPC response.
  async advance(run: Run, state: Integration, feature?: string) {
    const { sourceRoot } = await this.production.projects.project(run.projectId);
    if (state.scopeHash !== run.scopeHash) throw new Error("INTEGRATION_IDENTITY_INVALID");
    const repo = await this.ensureRepo(state, sourceRoot);
    const integrated = new Set(state.entries.filter(e => e.integrated).map(e => e.feature));
    const node = feature ? run.nodes.find(n => n.id === feature) : run.nodes.find(n => run.integration ? n.status !== "accepted" : !integrated.has(n.id));
    if (!node) return state;
    if ((!run.integration && node.status !== "accepted") || run.scope.nodes.find(f => f.id === node.id)!.dependsOn.some(dep => run.nodes.some(n => n.id === dep) && !integrated.has(dep))) throw new Error("INTEGRATION_PREDECESSOR_REQUIRED");
    const proof = await this.approved(run, node);
    const committed = state.entries.find(e => e.feature === node.id && e.integrated);
    if (committed?.integrated) {
      if (committed.manifest !== proof.exported.manifestHash || committed.review !== proof.review.id) throw new Error("INTEGRATION_IDENTITY_INVALID");
      await gitText(repo, ["merge-base", "--is-ancestor", committed.integrated, "refs/heads/" + state.settings.target]);
      return state;
    }
    const base = state.entries.filter(e => e.integrated).at(-1)?.integrated ?? state.initial;
    if (run.workers===2 && (!node.lease || proof.bound.generation!==node.lease.generation || node.id!==run.nodes.find(n=>!integrated.has(n.id))?.id))
      throw new Error("INTEGRATION_PREDECESSOR_REQUIRED");
    if (proof.bound.integrationBase && proof.bound.integrationBase !== base) {
      if (run.workers!==2 || node.lease?.base!==proof.bound.integrationBase) throw new Error("INTEGRATION_BASE_MOVED");
      const store=await this.production.store(run.projectId);
      await validateParallelBase(repo,base,proof.bound,await loadSnapshot(store.root,proof.plan.snapshotId),proof.files);
    }
    let entry = state.entries.find(e => e.feature === node.id);
    if (!entry) {
      entry = {
        feature: node.id, token: node.token, result: proof.result.id, fingerprint: proof.result.fingerprint, manifest: proof.exported.manifestHash,
        planHash: proof.plan.hash, review: proof.review.id, base, head: null, integrated: null,
        branch: state.settings.headPrefix + "/" + run.runId + "-" + node.id + "-" + node.token.slice(-10)
      };
      state.entries.push(entry); await this.save(state);
    }
    if (entry.base !== base || entry.manifest !== proof.exported.manifestHash || entry.result !== proof.result.id || entry.review !== proof.review.id) throw new Error("INTEGRATION_IDENTITY_INVALID");
    const current = await ref(repo, state.settings.target);
    if (current !== base && current !== (entry.remote?.merge ?? entry.head)) throw new Error("INTEGRATION_BASE_MOVED");
    if (!entry.head) {
      if (!run.integration) {
        for (const file of node.files.filter(f => !proof.files.some(change => change.path === f.path))) {
          const prior = await treeFile(repo, base, file.path);
          if ((prior ? digest(prior.bytes) : null) !== file.hash) throw new Error("MILESTONE_TRANSFER_CHANGED");
        }
      }
      entry.head = await featureCommit(repo, base, entry.branch, proof.files, "Feature " + node.id + "\n\nResult " + entry.result + "\nManifest " + entry.manifest, proof.review.at);
      await this.save(state);
    }
    let next = entry.head;
    if (state.settings.mode === "github") {
      if (!entry.remote?.merge || entry.remote.phase !== "merged") return state;
      const remote = state.settings.github!;
      next = entry.remote.merge;
      await gitText(repo, ["fetch", "--no-tags", "--no-write-fetch-head", "https://github.com/" + remote.repo + ".git", next]);
      if (await gitText(repo, ["rev-parse", next + "^{tree}"]) !== await gitText(repo, ["rev-parse", entry.head + "^{tree}"])) throw new Error("GITHUB_MERGE_UNCONFIRMED");
    }
    await advanceRef(repo, state.settings.target, base, next);
    if (run.integration) await gitText(sourceRoot, ["fetch", "--no-tags", "--no-write-fetch-head", repo, next]);
    entry.integrated = next; await this.save(state); return state;
  }
  async sync(run: Run, input: z.infer<typeof publication>) {
    const state = await this.get(run.projectId, run.runId), target = state?.settings.github;
    if (!state || !target) throw new Error("GITHUB_TARGET_REQUIRED");
    const entry = state.entries.find(e => e.feature === input.feature);
    if (!entry?.head) throw new Error("INTEGRATION_REQUIRED");
    const node = run.nodes.find(n => n.id === entry.feature)!;
    const proof = await this.approved(run, node);
    if (proof.exported.manifestHash !== entry.manifest || proof.review.id !== entry.review) throw new Error("INTEGRATION_IDENTITY_INVALID");
    if (["merge", "owner-merge"].includes(input.action) && run.scope.nodes.find(n => n.id === node.id)!.dependsOn.some(dep => run.nodes.some(n => n.id === dep) && !state.entries.find(e => e.feature === dep)?.remote?.merge)) throw new Error("INTEGRATION_PREDECESSOR_REQUIRED");
    const body = lf(input.body);
    if (body.includes("<!-- orchiva-plan:")) throw new Error("GITHUB_PUBLIC_PLAN_REQUIRED");
    if (entry.remote?.pending && entry.remote.body !== body && (input.action === "publish" || input.action === "overwrite")) throw new Error("GITHUB_RECONCILIATION_REQUIRED");
    if (!entry.remote) {
      if (input.action !== "publish") throw new Error("GITHUB_PUBLIC_PLAN_REQUIRED");
      entry.remote = { body, lastBody: null, remoteBody: null, issue: null, pr: null, base: null, head: null, merge: null, phase: "queued", pending: null }; await this.save(state);
    } else if (input.action === "publish" || input.action === "overwrite") {
      entry.remote.body = body; await this.save(state);
    }
    const marker = "<!-- orchiva-plan:" + digest(target.repoId + "/" + node.token) + " -->";
    const publisher = new GithubPublication(this.github, target);
    const checkpoint = async () => {
      const r = entry.remote!, canonical = publicDocument(r.body, marker, r.lastBody), hash = digest(canonical);
      if (!r.versions?.some(v => v.hash === hash)) {
        await immutable(this.dir(run.projectId, run.runId), "public/" + entry.token + "/" + hash + ".md", canonical);
        (r.versions ??= []).push({ hash, at: new Date().toISOString(), origin: input.action === "adopt" ? "github" : "local" });
      }
      await this.save(state);
    };
    await checkpoint();
    try {
      await publisher.sync(entry, proof.files, proof.review.at, marker, input.action, input.observedHash, checkpoint, state.settings.mode === "github", input.expectedHead);
      if (entry.remote.lastError) { delete entry.remote.lastError; await this.save(state); }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      entry.remote.lastError = /^GITHUB_[A-Z_0-9]+$/.test(code) ? code : "GITHUB_RESPONSE_UNKNOWN";
      await this.save(state); throw error;
    }
    return state;
  }
}
