import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import type { PaseoApi } from "@getpaseo/client";
import { productionSchema, productionInput, type Production, type ProductionInput } from "../../../shared/contracts/desktop-production";
import { recordSchema, type RequestRecord } from "../../../shared/contracts/feature-request";
import type { RequestStore } from "../ports";
import { Projects } from "./projects";
import { ProductionStore } from "../../adapters/storage/production-store";
import { createRequest } from "../../domain/request";
import { captureHistory, occupiesSlot, payloadHash } from "../../domain/record-v2";
import { buildPlan } from "../../domain/request-plan";
import { StartFeatureRequest } from "../start-feature-request";
import { TrackExecution } from "../track-execution";
import { RequestLocks } from "../request-locks";
import { RecoverRequest } from "../recover-request";
import { DesktopRuntime, desktopModels } from "../../adapters/paseo/desktop-runtime";
import { CodexPlanGenerator, validateGeneratedPlan, type PlanGenerator } from "../../adapters/paseo/plan-generator";
import { captureInput, loadSnapshot, sameInput, storeSnapshot, type InputSnapshot } from "./snapshots";
import { atomic, bytes, digest, immutable, relativeFile, safePath } from "../../adapters/storage/project-files";

type Command = { projectId: string; token: string; commandKey: string; expectedRevision: number };
const now = () => new Date().toISOString();
export class ProductionService {
  private engineLocks = new RequestLocks();
  private stores = new Map<string, ProductionStore>();
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  restoring = true;
  constructor(readonly projects: Projects, private legacy: RequestStore, private api: () => Promise<PaseoApi>, private generator: PlanGenerator = new CodexPlanGenerator(), private cancel?: (id: string) => Promise<void>) {}
  async store(id: string) {
    const p = await this.projects.project(id);
    let store = this.stores.get(id);
    if (!store || store.root !== p.sourceRoot) { store = new ProductionStore(p.sourceRoot, id, () => this.projects.own(p.sourceRoot)); this.stores.set(id, store); }
    return store;
  }
  async required(id: string, token: string) { const doc = await (await this.store(id)).envelope(token); if (!doc) throw new Error("NOT_FOUND"); return doc; }
  async list(id: string) { const all = await (await this.store(id)).all(); return { issues: all.issues, records: all.records.map(x => ({ token: x.token, input: { title: x.input.title }, engine: { status: x.engine.status, result: x.engine.result ? { id: x.engine.result.id } : null }, legacy: !!x.legacy })) }; }
  async assertSlot(except?: { projectId: string; token: string }, allowLegacyToken?: string) {
    const legacy = await this.legacy.diagnostics();
    if (legacy.issues.length || legacy.activeTokens.some(x => x !== allowLegacyToken)) throw new Error("LEGACY_EXECUTION_BUSY_OR_INVALID");
    for (const view of await this.projects.list()) {
      if (!view.available) throw new Error("PROJECT_UNAVAILABLE_OR_INVALID");
      if (!view.initialized) continue;
      const state = await (await this.store(view.projectId)).diagnostics();
      if (state.issues.length) throw new Error("PROJECT_RECORD_INVALID");
      if (state.activeTokens.some(token => view.projectId !== except?.projectId || token !== except.token)) throw new Error("GLOBAL_EXECUTION_BUSY");
    }
  }
  async legacyCommand<T>(token: string, action: () => Promise<T>) { return this.projects.exclusive(async () => { await this.assertSlot(undefined, token); return action(); }); }
  async models(id: string) { const p = await this.projects.project(id); return desktopModels(await this.api(), p.sourceRoot); }
  private async validateModel(id: string, input: ProductionInput) {
    const catalog = await this.models(id), model = catalog.models.find(x => x.provider === input.provider);
    if (!catalog.ready || !model || (input.thinkingOptionId && !model.levels.some(x => x.id === input.thinkingOptionId))) throw new Error("MODEL_SELECTION_UNAVAILABLE");
  }
  private replay(doc: Production, key: string, kind: string, payload: unknown) {
    const previous = doc.journals.find(x => x.key === key);
    if (previous && (previous.kind !== kind || previous.payloadHash !== payloadHash(payload))) throw new Error("IDEMPOTENCY_CONFLICT");
    return previous;
  }
  private revision(doc: Production, expected: number) { if (doc.revision !== expected) throw new Error("REVISION_CONFLICT"); if (doc.legacy) throw new Error("LEGACY_ARCHIVE_ONLY"); }
  private command(doc: Production, key: string, kind: string, payload: unknown, state: "pending" | "applied" = "applied") {
    const item: Production["journals"][number] = { key, kind, payloadHash: payloadHash(payload), state, phase: "accepted", outcome: null as string | null, at: now() }; doc.journals.push(item); return item;
  }
  async save(input: Command & { input: ProductionInput }) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId); let doc = await store.envelope(input.token);
      if (doc && this.replay(doc, input.commandKey, "draft", input.input)) return doc;
      if (doc) { this.revision(doc, input.expectedRevision); if (!["draft", "ready"].includes(doc.engine.status) || ["pending", "running", "unknown"].includes(doc.planning?.state ?? "")) throw new Error("REQUEST_NOT_EDITABLE"); }
      else if (input.expectedRevision !== 0) throw new Error("REVISION_CONFLICT");
      const value = productionInput.parse(input.input); if (value.outputPath) relativeFile(value.outputPath);
      if (value.mode === "modify") {
        if (!value.parentToken) throw new Error("PARENT_REQUEST_REQUIRED");
        const parent = await store.envelope(value.parentToken);
        if (!parent || (value.parentResultId && !parent.engine.results.some(x => x.id === value.parentResultId))) throw new Error("PARENT_RESULT_INVALID");
      }
      const feature = { title: value.title, goal: value.goal, scope: value.scope || "요청한 범위", constraints: value.constraints || "프로젝트 지침 준수", validation: "자동 근거와 사용자 품질 확인", completionCriteria: value.goal || "결과 검토" };
      if (!doc) {
        const engine = createRequest(input.token, { ...feature, title: feature.title || "제목 없음", goal: feature.goal || "작성 중" }); engine.revision = 1; engine.updatedAt = now(); engine.status = "draft";
        doc = productionSchema.parse({ schemaVersion: 3, projectId: input.projectId, token: input.token, revision: 1, input: value, planName: "plan-" + input.token, planVersions: [], engine, journals: [], planning: null, documentIntent: null, legacy: null, reviews: [], exports: [] });
      }
      doc.input = value; doc.engine.feature = feature; doc.engine.status = "draft"; doc.engine.confirmationSource = null; doc.engine.confirmedPlanRevision = null;
      doc.engine.criteria = [{ id: "quality", text: value.goal || "요청 결과 검토", checkIds: [], manualMethod: "결과 검토 화면에서 사용자가 품질을 확인", legacy: false }];
      this.command(doc, input.commandKey, "draft", value); await store.put(doc); return doc;
    });
  }
  async plan(input: Command) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId), doc = await this.required(input.projectId, input.token);
      if (this.replay(doc, input.commandKey, "plan", { revision: input.expectedRevision })) return doc;
      this.revision(doc, input.expectedRevision); await this.assertSlot(input);
      if (["pending", "running", "unknown"].includes(doc.planning?.state ?? "")) throw new Error("PLANNING_IN_PROGRESS");
      if (!["draft", "ready"].includes(doc.engine.status) || !doc.input.title.trim() || !doc.input.goal.trim()) throw new Error("PLAN_INPUT_REQUIRED");
      await this.validateModel(input.projectId, doc.input); await this.projects.output(input.projectId);
      const snapshot = await captureInput(this.projects, input.projectId, doc.input), snapshotId = await storeSnapshot(store.root, snapshot);
      doc.planning = { key: input.commandKey, agentId: null, directory: join(this.projects.directory, "planning", input.projectId, input.commandKey), snapshotId, prompt: "정형 입력과 고정 snapshot의 읽기 전용 AI 계획 작성", state: "pending", error: null };
      this.command(doc, input.commandKey, "plan", { revision: input.expectedRevision }, "pending");
      await store.put(doc); this.wake(); return doc;
    });
  }
  private async publishPlan(store: ProductionStore, doc: Production, content: string, snapshot: InputSnapshot, origin: "ai" | "external") {
    validateGeneratedPlan(content);
    const checks = doc.input.validationProfile === "node-test" ? snapshot.files.filter(x => /(^|\/)(test[s]?\/.*|[^/]+\.test)\.(mjs|cjs|js)$/.test(x.path) && x.hash).slice(0, 8).map((x, i) => ({ id: `auto-${i + 1}`, kind: "node-test" as const, path: x.path, label: "프로젝트 테스트: " + x.path })) : [];
    if (doc.input.validationProfile === "node-test" && !checks.length) throw new Error("VALIDATION_PROFILE_HAS_NO_TESTS");
    doc.engine.checks = checks;
    doc.engine.criteria[0].checkIds = checks.map(x => x.id);
    const project = await this.projects.project(doc.projectId);
    const runtimeConfig = { repositoryPath: project.sourceRoot, baseRef: project.config.baseRef, provider: doc.input.provider, maxActiveTasks: 1 as const };
    const plan = buildPlan(doc.engine, snapshot.baseCommit, runtimeConfig);
    plan.requestPlan.content = content;
    plan.taskPlan.content = content + "\n\n## 실행 경계\n승인한 범위만 이 Worktree에서 수행한다. 원본 소스·다른 저장소 접근, commit/push/merge, 요청하지 않은 README·지침 생성은 금지한다. 검증 실패는 숨기지 않는다.\n";
    doc.engine.plans.push(plan); doc.engine.requestPlan = plan.requestPlan; doc.engine.taskPlan = plan.taskPlan; doc.engine.projectSnapshot = runtimeConfig; doc.engine.status = "ready";
    const path = `docs/plans/${doc.planName}.md`, before = await bytes(store.root, path), snapshotId = await storeSnapshot(store.root, snapshot);
    doc.planVersions.push({ revision: plan.revision, path, content, hash: digest(content), inputHash: snapshot.inputHash, snapshotId, createdAt: now(), origin });
    doc.documentIntent = { path, before: before ? digest(before) : null, content };
    if (doc.planning) doc.planning.state = "complete";
    await store.put(doc); await this.publishDocument(store, doc);
  }
  private async publishDocument(store: ProductionStore, doc: Production) {
    const intent = doc.documentIntent; if (!intent) return;
    const current = await bytes(store.root, intent.path), hash = current ? digest(current) : null;
    if (hash !== digest(intent.content)) {
      if (hash !== intent.before) throw new Error("PLAN_DOCUMENT_CONFLICT");
      if (current) await immutable(store.root, `docs/.orchiva/backups/plans/${hash}.md`, current);
      await atomic(await safePath(store.root, intent.path), intent.content);
    }
    doc.documentIntent = null; await store.put(doc);
  }
  async syncPlan(input: Command) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId), doc = await this.required(input.projectId, input.token);
      if (this.replay(doc, input.commandKey, "sync-plan", { revision: input.expectedRevision })) return doc;
      this.revision(doc, input.expectedRevision); if (["pending", "running", "unknown"].includes(doc.planning?.state ?? "")) throw new Error("PLANNING_IN_PROGRESS"); if (!["draft", "ready"].includes(doc.engine.status)) throw new Error("PLAN_ALREADY_EXECUTED");
      const latest = doc.planVersions.at(-1); if (!latest) throw new Error("PLAN_REQUIRED");
      const content = (await bytes(store.root, latest.path))?.toString("utf8"); if (!content) throw new Error("PLAN_MISSING");
      const snapshot = await captureInput(this.projects, input.projectId, doc.input);
      this.command(doc, input.commandKey, "sync-plan", { revision: input.expectedRevision });
      await this.publishPlan(store, doc, content, snapshot, "external"); return doc;
    });
  }
  async runtime(doc: Production) {
    const project = await this.projects.project(doc.projectId), plan = doc.planVersions.find(x => x.revision === doc.engine.confirmedPlanRevision) ?? doc.planVersions.at(-1);
    if (!plan) throw new Error("PLAN_REQUIRED");
    const snapshot = await loadSnapshot(project.sourceRoot, plan.snapshotId);
    return new DesktopRuntime(await this.api(), { name: "PoC Sandbox", repositoryPath: project.sourceRoot, registeredRoot: project.sourceRoot, baseRef: doc.engine.projectSnapshot?.baseRef ?? project.config.baseRef, provider: doc.input.provider }, doc, snapshot);
  }
  async importLegacy(id: string, token: string, key: string, original: string) {
    return this.projects.exclusive(async () => {
      const store = await this.store(id), existing = await store.envelope(token), hash = digest(original);
      if (existing) { if (existing.legacy?.sourceHash !== hash) throw new Error("IMPORT_CONFLICT"); return existing; }
      const raw = JSON.parse(original); if (raw.schemaVersion !== 2) throw new Error("LEGACY_V2_REQUIRED");
      const engine = recordSchema.parse(raw);
      if (engine.token !== token || occupiesSlot(engine)) throw new Error("LEGACY_ACTIVE_OR_INVALID");
      captureHistory(engine);
      await immutable(store.root, `docs/.orchiva/backups/legacy/${token}-${hash}.json`, original);
      const input = productionInput.parse({ title: engine.feature.title, goal: engine.feature.goal, scope: engine.feature.scope, constraints: engine.feature.constraints, discipline: "coding", mode: "new", parentToken: null, parentResultId: null, provider: engine.projectSnapshot?.provider ?? "codex/default", thinkingOptionId: null, outputPath: "" });
      const doc = productionSchema.parse({ schemaVersion: 3, projectId: id, token, revision: 1, input, planName: "plan-" + token, planVersions: [], engine, journals: [], planning: null, documentIntent: null, legacy: { sourceHash: hash, importedAt: now(), archiveOnly: true }, reviews: [], exports: [] });
      this.command(doc, key, "import-legacy", { hash }); await store.put(doc); return doc;
    });
  }
  async start(input: Command & { planHash: string }) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId), doc = await this.required(input.projectId, input.token), payload = { planHash: input.planHash };
      if (this.replay(doc, input.commandKey, "start", payload)) return doc;
      this.revision(doc, input.expectedRevision); await this.assertSlot(input);
      if (doc.documentIntent) throw new Error("PLAN_DOCUMENT_PENDING");
      if (["pending", "running", "unknown"].includes(doc.planning?.state ?? "")) throw new Error("PLANNING_IN_PROGRESS");
      const plan = doc.planVersions.at(-1); if (!plan || plan.hash !== input.planHash) throw new Error("PLAN_STALE");
      const actual = await bytes(store.root, plan.path); if (!actual || digest(actual) !== plan.hash) throw new Error("PLAN_EXTERNAL_CHANGE");
      const expected = await loadSnapshot(store.root, plan.snapshotId), current = await captureInput(this.projects, input.projectId, doc.input);
      if (!sameInput(expected, current)) throw new Error("PLAN_INPUT_CHANGED");
      await this.validateModel(input.projectId, doc.input); await this.projects.output(input.projectId);
      const enginePlan = doc.engine.plans.at(-1)!;
      this.command(doc, input.commandKey, "start", payload, "pending"); await store.put(doc);
      await new StartFeatureRequest(store).accept({ token: doc.token, commandKey: input.commandKey, expectedRevision: doc.engine.revision, planRevision: enginePlan.revision, inputHash: enginePlan.inputHash }, await this.runtime(doc));
      const latest = await this.required(input.projectId, input.token); latest.journals.find(x => x.key === input.commandKey)!.state = "applied"; await store.put(latest); this.wake(); return latest;
    });
  }
  async engineCommand(kind: "resume" | "revalidate" | "retry" | "reconcile", input: Command & { resultId?: string | null; instruction?: string; targetCommandKey?: string }) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId), doc = await this.required(input.projectId, input.token);
      const { expectedRevision, ...payload } = input;
      if (this.replay(doc, input.commandKey, kind, payload)) return doc;
      this.revision(doc, expectedRevision); await this.assertSlot(input); const runtime = await this.runtime(doc), tracker = new TrackExecution(store, this.engineLocks);
      this.command(doc, input.commandKey, kind, payload, "pending"); await store.put(doc);
      if (kind === "resume") await tracker.resume({ token: input.token, key: input.commandKey, instruction: input.instruction, resultId: input.resultId, expectedRevision: doc.engine.revision }, runtime);
      else if (kind === "revalidate") await tracker.refresh(input.token, runtime, undefined, true, { commandKey: input.commandKey, resultId: input.resultId ?? null, expectedRevision: doc.engine.revision });
      else if (kind === "retry") await new RecoverRequest(store, this.engineLocks).retry({ ...input, expectedRevision: doc.engine.revision });
      else await new RecoverRequest(store, this.engineLocks).reconcile({ ...input, expectedRevision: doc.engine.revision }, runtime);
      const next = await this.required(input.projectId, input.token); next.journals.find(x => x.key === input.commandKey)!.state = "applied"; await store.put(next); this.wake(); return next;
    });
  }
  async observe(id: string, token: string) { this.wake(); return this.required(id, token); }
  async attention(id: string, token: string) {
    const doc = await this.required(id, token); if (!doc.engine.agentId) return [];
    await (await this.runtime(doc)).verifyResources(doc.engine);
    const agent = (await this.api()).agents.ref(doc.engine.agentId); if (!await agent.refresh()) throw new Error("RESOURCE_MISSING");
    return (agent.pendingPermissions ?? []).slice(0, 20).map(request => ({ id: request.id, hash: payloadHash(request), kind: request.kind, title: request.title ?? request.name, details: JSON.stringify({ description: request.description, input: request.input, detail: request.detail }).slice(0, 30000), actions: request.actions?.map(x => ({ id: x.id, label: x.label, behavior: x.behavior })) ?? [{ id: "allow", label: "이번 요청 허용", behavior: "allow" as const }, { id: "deny", label: "거부", behavior: "deny" as const }] }));
  }
  async permission(input: Command & { requestId: string; requestHash: string; actionId: string; behavior: "allow" | "deny" }) {
    return this.projects.exclusive(async () => {
      const doc = await this.required(input.projectId, input.token), store = await this.store(input.projectId), payload = { requestId: input.requestId, requestHash: input.requestHash, actionId: input.actionId, behavior: input.behavior };
      if (this.replay(doc, input.commandKey, "permission", payload)) return doc;
      this.revision(doc, input.expectedRevision);
      const request = (await this.attention(input.projectId, input.token)).find(x => x.id === input.requestId);
      if (!request || request.hash !== input.requestHash || !request.actions.some(x => x.id === input.actionId && x.behavior === input.behavior)) throw new Error("PERMISSION_CHANGED");
      if (request.kind === "question" && input.behavior === "allow") throw new Error("QUESTION_ANSWER_REQUIRED");
      if (doc.journals.some(x => x.kind === "permission" && x.phase === request.id && ["pending", "unknown"].includes(x.state))) throw new Error("DELIVERY_UNKNOWN");
      const journal = this.command(doc, input.commandKey, "permission", payload, "pending"); journal.phase = request.id; await store.put(doc);
      const agent = (await this.api()).agents.ref(doc.engine.agentId!);
      try { await agent.respondToPermission({ requestId: request.id, response: { behavior: input.behavior, selectedActionId: ["allow", "deny"].includes(input.actionId) ? undefined : input.actionId } }); }
      catch { journal.state = "unknown"; }
      await store.put(doc); this.wake(); return doc;
    });
  }
  async stop(input: Command) {
    return this.projects.exclusive(async () => {
      const doc = await this.required(input.projectId, input.token), store = await this.store(input.projectId);
      if (this.replay(doc, input.commandKey, "stop", {})) return doc;
      this.revision(doc, input.expectedRevision);
      if (!this.cancel || !doc.engine.agentId || !["started", "running", "needs-input"].includes(doc.engine.status) || doc.engine.commands.some(x => ["pending", "unknown"].includes(x.status))) throw new Error("INVALID_STATE");
      if (doc.journals.some(x => x.kind === "stop" && ["pending", "unknown"].includes(x.state))) throw new Error("DELIVERY_UNKNOWN");
      await (await this.runtime(doc)).verifyResources(doc.engine);
      const journal = this.command(doc, input.commandKey, "stop", {}, "pending"); journal.phase = "requested"; await store.put(doc);
      try { await this.cancel(doc.engine.agentId); journal.phase = "sent"; }
      catch { journal.state = "unknown"; }
      await store.put(doc); this.wake(); return doc;
    });
  }
  async review(input: Command & { resultId: string; approved: boolean; qualityConfirmed: boolean; checksAcknowledged: boolean; note: string }) {
    return this.projects.exclusive(async () => {
      const store = await this.store(input.projectId), doc = await this.required(input.projectId, input.token), { expectedRevision, ...payload } = input;
      if (this.replay(doc, input.commandKey, "review", payload)) return doc;
      this.revision(doc, expectedRevision); await this.assertSlot(input);
      const result = doc.engine.result;
      if (!result || result.id !== input.resultId || !["awaiting-review", "failed"].includes(doc.engine.status)) throw new Error("STALE_RESULT");
      const runtime = await this.runtime(doc), observed = await runtime.observe(doc.engine);
      if (["running", "needs-input"].includes(observed.status) || observed.sourceKey !== result.sourceKey || await runtime.fingerprint(doc.engine) !== result.fingerprint) throw new Error("RESULT_CHANGED");
      if (input.approved && (!input.qualityConfirmed || !input.checksAcknowledged || result.failure || result.executionFailure || result.checks.some(x => !x.passed || (x.status && x.status !== "passed")))) throw new Error("REVIEW_NOT_READY");
      if (!input.approved && !input.note.trim()) throw new Error("REVIEW_REASON_REQUIRED");
      doc.reviews.push({ id: randomUUID(), resultId: result.id, fingerprint: result.fingerprint, approved: input.approved, qualityConfirmed: input.qualityConfirmed, checksAcknowledged: input.checksAcknowledged, note: input.note, at: now() });
      doc.engine.status = input.approved ? "completed" : "failed";
      doc.engine.failure = input.approved ? null : { kind: "review-rejected", code: "REVIEW_REJECTED", message: input.note };
      this.command(doc, input.commandKey, "review", payload); await store.put(doc);
      await this.evidence(store, doc); return doc;
    });
  }
  async evidence(store: ProductionStore, doc: Production) {
    const result = doc.engine.result; if (!result) return;
    const directory = `docs/evidence/${doc.planName}/${result.id}`;
    await immutable(store.root, `${directory}/verification.json`, JSON.stringify({ plan: doc.planName, resultId: result.id, attempt: doc.engine.attempt, files: result.files, checks: result.checks.map(({ output, ...check }) => check), failure: result.failure, executionFailure: result.executionFailure, at: result.collectedAt }, null, 2));
    for (const review of doc.reviews.filter(x => x.resultId === result.id)) {
      await immutable(store.root, `${directory}/review-${review.id}.json`, JSON.stringify(review, null, 2));
      await immutable(store.root, `docs/decisions/${doc.planName}-${review.id}.md`, `# ${doc.input.title} 검토\n\n- PLAN: [${doc.planName}](../plans/${doc.planName}.md)\n- 결과: ${result.id}\n- 판정: ${review.approved ? "완료 승인" : "수정 필요"}\n- 일시: ${review.at}\n- 검증 근거: [verification.json](../evidence/${doc.planName}/${result.id}/verification.json)\n\n## 근거\n${review.note || "자동 검사와 결과 품질 확인란을 확인했습니다."}\n`);
    }
  }
  private async index(store: ProductionStore) {
    const file = "docs/plans/README.md", old = await bytes(store.root, file); if (!old) return;
    const start = "<!-- orchiva:plans:start -->", end = "<!-- orchiva:plans:end -->", text = old.toString("utf8");
    if (!text.includes(start) || !text.includes(end)) return; // User-owned index remains untouched.
    const { records, issues } = await store.all(); if (issues.length) return;
    const rows = records.filter(doc => doc.planVersions.length).map(doc => `| [${doc.input.title.replaceAll("|", "\\|").replaceAll("\n", " ")}](./${doc.planName}.md) | ${doc.engine.status === "ready" || doc.engine.status === "draft" ? "proposed" : doc.engine.status === "completed" ? "completed" : doc.engine.status === "failed" ? "failed" : "active"} |`).join("\n");
    const content = text.slice(0, text.indexOf(start)) + start + "\n| PLAN | 상태 |\n| --- | --- |\n" + rows + "\n" + text.slice(text.indexOf(end));
    if (content !== text) {
      await immutable(store.root, `docs/.orchiva/backups/index/${digest(old)}.md`, old);
      if (digest((await bytes(store.root, file))!) !== digest(old)) throw new Error("PLAN_DOCUMENT_CONFLICT");
      await atomic(await safePath(store.root, file), content);
    }
  }
  startWorker() { this.wake(); }
  wake() {
    if (this.stopped || this.running) return; clearTimeout(this.timer);
    this.running = this.projects.exclusive(() => this.cycle()).catch(() => undefined).finally(() => { this.running = undefined; if (!this.stopped) { this.timer = setTimeout(() => this.wake(), 3000); this.timer.unref(); } });
  }
  async settle() { await this.running; }
  async close() { this.stopped = true; clearTimeout(this.timer); await this.running; }
  private async cycle() {
    for (const p of await this.projects.list()) {
      if (!p.available || !p.initialized) continue;
      const store = await this.store(p.projectId), all = await store.all(); if (all.issues.length) continue;
      for (let doc of all.records) {
        if (doc.legacy) continue;
        try {
          for (const j of doc.journals.filter(x => x.state === "pending" && ["start", "resume", "retry", "reconcile", "revalidate"].includes(x.kind))) {
            // The engine owns the durable external-effect checkpoint. Never repeat
            // a command whose wrapper response was lost.
            j.state = doc.engine.commands.some(x => x.key === j.key) ? "applied" : "failed";
            j.outcome = "engine-checkpoint"; await store.put(doc);
          }
          if (doc.documentIntent) await this.publishDocument(store, doc);
          if (doc.planning?.state === "complete") {
            const journal = doc.journals.find(x => x.key === doc.planning!.key);
            if (journal?.state === "pending") { journal.state = "applied"; journal.outcome = doc.planVersions.at(-1)?.hash ?? null; await store.put(doc); }
          }
          if (doc.planning && ["pending", "running", "unknown"].includes(doc.planning.state)) {
            const journal = doc.journals.find(x => x.key === doc.planning!.key)!;
            if (journal.phase !== "accepted") {
              const complete = await bytes(doc.planning.directory, "completion.json"), failed = await bytes(doc.planning.directory, "failure.json");
              if (complete) {
                const content = (await bytes(doc.planning.directory, "answer.md"))?.toString("utf8");
                if (!content || JSON.parse(complete.toString("utf8")).hash !== digest(content)) throw new Error("PLAN_COMPLETION_INVALID");
                const snapshot = await loadSnapshot(store.root, doc.planning.snapshotId);
                if (!sameInput(snapshot, await captureInput(this.projects, doc.projectId, doc.input))) { doc.planning.state = "failed"; doc.planning.error = "PLANNING_INPUT_CHANGED"; journal.state = "failed"; await store.put(doc); }
                else { journal.state = "applied"; journal.outcome = digest(content); await this.publishPlan(store, doc, content, snapshot, "ai"); }
              } else if (failed) { doc.planning.state = "failed"; doc.planning.error = "PLAN_PROVIDER_FAILED"; journal.state = "failed"; await store.put(doc); }
              else {
                const processInfo = await bytes(doc.planning.directory, "process.json"), pid = processInfo ? JSON.parse(processInfo.toString("utf8")).pid : null;
                let ended = false;
                if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 0); } catch (error) { ended = (error as NodeJS.ErrnoException).code === "ESRCH"; }
                if (ended) { doc.planning.state = "failed"; doc.planning.error = "PLAN_PROCESS_ENDED_WITHOUT_RESULT"; journal.state = "failed"; await store.put(doc); }
                else if (doc.planning.state !== "unknown") { doc.planning.state = "unknown"; journal.state = "unknown"; await store.put(doc); }
              }
              continue;
            }
            await this.assertSlot(doc); const snapshot = await loadSnapshot(store.root, doc.planning.snapshotId);
            doc.planning.state = "running"; journal.phase = "model"; await store.put(doc);
            try {
              const content = await this.generator.generate(doc.planning.directory, doc.input, snapshot);
              if (!sameInput(snapshot, await captureInput(this.projects, doc.projectId, doc.input))) throw new Error("PLANNING_INPUT_CHANGED");
              journal.state = "applied"; journal.outcome = digest(content);
              await this.publishPlan(store, doc, content, snapshot, "ai");
            } catch (error) {
              doc.planning.state = "failed"; doc.planning.error = error instanceof Error ? error.message : "PLAN_FAILED"; journal.state = "failed"; await store.put(doc);
            }
            continue;
          }
          if (doc.planVersions.length && (occupiesSlot(doc.engine) || doc.journals.some(x => ["stop", "permission"].includes(x.kind) && ["pending", "unknown"].includes(x.state)))) {
            const runtime = await this.runtime(doc);
            const replies = doc.journals.filter(x => x.kind === "permission" && ["pending", "unknown"].includes(x.state));
            if (replies.length && doc.engine.agentId) {
              const agent = (await this.api()).agents.ref(doc.engine.agentId); if (!await agent.refresh()) throw new Error("RESOURCE_MISSING");
              for (const reply of replies) if (!(agent.pendingPermissions ?? []).some(x => x.id === reply.phase)) { reply.state = "applied"; reply.outcome = "request-no-longer-pending"; await store.put(doc); }
            }
            const stop = doc.journals.find(x => x.kind === "stop" && ["pending", "unknown"].includes(x.state));
            if (stop && doc.engine.agentId) {
              const observed = await runtime.observe(doc.engine);
              if (!["running", "needs-input"].includes(observed.status)) {
                await new TrackExecution(store, this.engineLocks).refresh(doc.token, runtime, { kind: "canceled", reason: "사용자 중단 요청 후 실행 종료를 확인했습니다." });
                doc = await this.required(doc.projectId, doc.token); const journal = doc.journals.find(x => x.key === stop.key)!; journal.state = "applied"; journal.phase = "stopped"; journal.outcome = doc.engine.result?.id ?? "stopped"; await store.put(doc); await this.evidence(store, doc); continue;
              }
            }
            if (doc.engine.commands.some(x => ["start", "retry-start"].includes(x.kind) && x.status === "pending")) await new StartFeatureRequest(store).advance(doc.token, runtime);
            doc = await this.required(doc.projectId, doc.token);
            if (doc.engine.agentId) await new TrackExecution(store, this.engineLocks).refresh(doc.token, runtime);
            await this.evidence(store, await this.required(doc.projectId, doc.token));
          }
        } catch {
          const latest = await store.envelope(doc.token);
          if (latest && latest.engine.observationError !== "DESKTOP_OBSERVATION_UNAVAILABLE") { latest.engine.observationError = "DESKTOP_OBSERVATION_UNAVAILABLE"; await store.put(latest); }
        }
      }
      await this.index(store);
    }
    this.restoring = false;
  }
}
