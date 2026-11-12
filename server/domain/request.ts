import { recordSchema, type Check, type Feature, type RequestRecord } from "../../shared/contracts/feature-request";
export function createRequest(token: string, feature: Feature, checks: Check[] = []): RequestRecord {
  const id = `REQ-${token}`, taskId = `TASK-${token}`;
  const content = [`# ${feature.title}`, `## Goal\n${feature.goal}`, `## Scope\n${feature.scope}`, `## Constraints\n${feature.constraints}`, `## Validation\n${feature.validation}`, `## Completion Criteria\n${feature.completionCriteria}`].join("\n\n") + "\n";
  return recordSchema.parse({
    checks,
    token, id, taskId, createdAt: new Date().toISOString(), feature, status: "planned", error: null, workspaceId: null, worktreePath: null, agentId: null,
    requestPlan: { id: `PLAN-${id}`, ownerType: "request", ownerId: id, revision: 1, content },
    taskPlan: { id: `PLAN-${taskId}`, ownerType: "task", ownerId: taskId, revision: 1,
      content: content + "\n## Execution\n1. Inspect this worktree and the request plan.\n2. Implement only the stated scope.\n3. Run the requested validation.\n4. Report results and any incomplete criteria.\n\nWork only in this sandbox worktree. Do not push, merge, or access production repositories.\n" },
  });
}
