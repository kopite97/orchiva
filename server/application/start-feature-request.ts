import { startSchema, type RequestRecord } from "../../shared/contracts/feature-request";
import { createRequest } from "../domain/request";
import type { RequestStore, Runtime } from "./ports";
import { RequestLocks } from "./request-locks";
export class StartFeatureRequest {
  constructor(private store: RequestStore, readonly locks = new RequestLocks()) {}
  async start(input: unknown, runtime: Runtime): Promise<RequestRecord> {
    const parsed = startSchema.parse(input);
    return this.locks.run(parsed.token, () => this.execute(parsed, runtime));
  }
  private async execute(input: ReturnType<typeof startSchema.parse>, runtime: Runtime) {
    let record = await this.store.get(input.token);
    if (record && (JSON.stringify(record.feature) !== JSON.stringify(input.feature) || JSON.stringify(record.checks) !== JSON.stringify(input.checks))) throw new Error("This request key belongs to different input. Start a new request.");
    if (record?.agentId) return record;
    await runtime.validate();
    record ??= createRequest(input.token, input.feature, input.checks);
    record.error = null;
    await this.store.save(record);
    try {
      if (!record.workspaceId) {
        record.status = "creating-worktree"; await this.store.save(record);
        const workspace = await runtime.createWorkspace(record);
        record.workspaceId = workspace.id; record.worktreePath = workspace.directory;
      }
      record.status = "writing-plan"; await this.store.save(record);
      await runtime.writePlans(record);
      record.status = "starting-session"; await this.store.save(record);
      record.agentId ??= await runtime.startAgent(record);
      record.status = "started"; await this.store.save(record);
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      await this.store.save(record);
    }
    return record;
  }
}
