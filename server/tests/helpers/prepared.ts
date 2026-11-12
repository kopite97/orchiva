import { DraftRequest } from "../../application/draft-request";
import type { RequestStore, Runtime } from "../../application/ports";
import type { Feature, RequestRecord } from "../../../shared/contracts/feature-request";
export const project = { repositoryPath: "sandbox", baseRef: "main", provider: "codex/test", maxActiveTasks: 1 as const };
export const commit = "a".repeat(40);
export async function prepare(store: RequestStore, runtime: Runtime, token: string, feature: Feature, checks: RequestRecord["checks"] = []) {
  const app = new DraftRequest(store);
  const draft = await app.save({ token, commandKey: `${token}-save`, expectedRevision: 0, feature, checks, criteria: [{ id: "criterion-1", text: feature.completionCriteria, checkIds: [], manualMethod: feature.validation }] });
  const ready = await app.prepare({ token, commandKey: `${token}-prepare`, expectedRevision: draft.revision }, runtime);
  return { token, commandKey: `${token}-start`, expectedRevision: ready.revision, planRevision: ready.plans.at(-1)!.revision, inputHash: ready.plans.at(-1)!.inputHash };
}
