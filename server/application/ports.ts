import type { ExecutionResult, RequestRecord } from "../../shared/contracts/feature-request";
export interface RequestStore {
  get(token: string): Promise<RequestRecord | null>;
  save(record: RequestRecord): Promise<void>;
  list(): Promise<RequestRecord[]>;
}
export interface Observation {
  status: "running" | "needs-input" | "ended" | "failed";
  agentStatus: string; sourceKey: string; finalResponse: string; failure: string | null;
  seenRecovery: boolean;
  turnId?: string;
}
export interface LifecycleRuntime {
  observe(record: RequestRecord): Promise<Observation>;
  collect(record: RequestRecord, observation: Observation): Promise<ExecutionResult>;
  fingerprint(record: RequestRecord): Promise<string>;
  resume(record: RequestRecord): Promise<void>;
}
export interface Runtime {
  validate(): Promise<void>;
  createWorkspace(record: RequestRecord): Promise<{ id: string; directory: string }>;
  writePlans(record: RequestRecord): Promise<void>;
  startAgent(record: RequestRecord): Promise<string>;
}
