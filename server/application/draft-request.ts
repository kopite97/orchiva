import { saveDraftSchema, preparePlanSchema } from "../../shared/contracts/feature-request";
import type { RequestStore, Runtime } from "./ports";
import { createRequest } from "../domain/request";
import { assertRevision, beginCommand, finishCommand, previousCommand } from "./execution-slot";
import { buildPlan, validatePlanInput } from "../domain/request-plan";

export class DraftRequest {
  constructor(private store: RequestStore) {}
  async save(input: unknown) {
    const parsed = saveDraftSchema.parse(input);
    return this.store.exclusive(async () => {
      let record = await this.store.get(parsed.token);
      const payload = { feature: parsed.feature, criteria: parsed.criteria, checks: parsed.checks };
      if (record && previousCommand(record, parsed.commandKey, "save-draft", payload)) return record;
      if (record && !["draft", "ready"].includes(record.status)) throw new Error("INVALID_STATE: 실행된 요청은 수정할 수 없습니다.");
      if (record) assertRevision(record, parsed.expectedRevision); else if (parsed.expectedRevision !== 0) throw new Error("REVISION_CONFLICT");
      record ??= createRequest(parsed.token, parsed.feature);
      record.feature = { ...parsed.feature, completionCriteria: parsed.criteria.map(x => x.text).join("\n") };
      record.criteria = parsed.criteria; record.checks = parsed.checks;
      record.status = "draft"; record.confirmationSource = null; record.confirmedPlanRevision = null; record.error = null;
      const command = beginCommand(record, parsed.commandKey, "save-draft", payload); finishCommand(command, record.token);
      await this.store.save(record); return record;
    });
  }
  async prepare(input: unknown, runtime: Runtime) {
    const parsed = preparePlanSchema.parse(input);
    return this.store.exclusive(async () => {
      const record = await this.store.get(parsed.token); if (!record) throw new Error("NOT_FOUND");
      const payload = { revision: parsed.expectedRevision };
      if (previousCommand(record, parsed.commandKey, "prepare-plan", payload)) return record;
      assertRevision(record, parsed.expectedRevision);
      if (!["draft", "ready"].includes(record.status)) throw new Error("INVALID_STATE");
      validatePlanInput(record);
      if (!runtime.preflight) throw new Error("ENVIRONMENT_NOT_READY");
      const { baseCommit, projectSnapshot } = await runtime.preflight(record.checks);
      const plan = buildPlan(record, baseCommit, projectSnapshot);
      record.plans.push(plan); record.requestPlan = plan.requestPlan; record.taskPlan = plan.taskPlan;
      record.projectSnapshot = projectSnapshot; record.status = "ready";
      const command = beginCommand(record, parsed.commandKey, "prepare-plan", payload); finishCommand(command, `plan:${plan.revision}`);
      await this.store.save(record); return record;
    });
  }
}
