import { checkSchema, featureSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import { payloadHash } from "./record-v2";

export function draftHash(record: Pick<RequestRecord, "feature" | "criteria" | "checks">) { return payloadHash({ feature: record.feature, criteria: record.criteria, checks: record.checks }); }
export function validatePlanInput(record: RequestRecord) {
  const feature = featureSchema.safeParse(record.feature);
  if (!feature.success) throw new Error(`INVALID_INPUT: ${feature.error.issues.map(x => x.path.join(".")).join(", ")}`);
  if (!record.criteria.length) throw new Error("INVALID_INPUT: 완료 조건을 한 개 이상 입력하세요.");
  const ids = new Set<string>();
  for (const check of record.checks) {
    if (!check.id || ids.has(check.id) || !checkSchema.safeParse(check).success || !check.label.trim()) throw new Error("INVALID_INPUT: 검사 ID·경로·설명을 확인하세요.");
    ids.add(check.id);
  }
  const criteria = new Set<string>();
  for (const criterion of record.criteria) {
    if (criteria.has(criterion.id) || !criterion.text.trim() || criterion.checkIds.some(id => !ids.has(id)) || (!criterion.checkIds.length && !criterion.manualMethod.trim())) throw new Error("INVALID_INPUT: 완료 조건과 연결 검사 또는 수동 확인 방법을 확인하세요.");
    criteria.add(criterion.id);
  }
}
export function buildPlan(record: RequestRecord, baseCommit: string, projectSnapshot: NonNullable<RequestRecord["projectSnapshot"]>) {
  const revision = Math.max(0, ...record.plans.map(x => x.revision)) + 1;
  const { feature } = record;
  const content = `# ${feature.title}\n\n## Goal\n${feature.goal}\n\n## Scope\n${feature.scope}\n\n## Constraints\n${feature.constraints}\n\n## Validation\n${feature.validation}\n\n## Completion Criteria\n${record.criteria.map(x => `- [${x.id}] ${x.text}\n  Checks: ${x.checkIds.join(", ") || "none"}\n  Manual: ${x.manualMethod || "none"}`).join("\n")}\n\n## Independent Checks\n${JSON.stringify(record.checks, null, 2)}\n\n## Execution Target\nRepository: ${projectSnapshot.repositoryPath}\nBase ref: ${projectSnapshot.baseRef}\nBase commit: ${baseCommit}\nProvider: ${projectSnapshot.provider}\nPlan revision: ${revision}\n`;
  const requestPlan = { ...record.requestPlan, revision, content };
  const taskPlan = { ...record.taskPlan, revision, content: content + "\n## Execution\n1. Read both plans and inspect this worktree.\n2. Implement only the stated scope.\n3. Run the requested validation.\n4. Report evidence for each criterion.\n\nStay in this sandbox worktree. Do not commit, push, merge, or access other repositories.\n" };
  return { revision, inputHash: draftHash(record), requestPlan, taskPlan, baseCommit, projectSnapshot, createdAt: new Date().toISOString() };
}
