import type { ExecutionResult, RequestRecord } from "../../shared/contracts/feature-request";
export type Lookup<T> = { kind: "found"; value: T } | { kind: "absent" } | { kind: "unknown"; reason: string };
export interface RequestStore {
  exclusive<T>(action: () => Promise<T>): Promise<T>;
  diagnostics(): Promise<{ issues: { file: string; code: string }[]; activeTokens: string[] }>;
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
  verifyResources?(record: RequestRecord): Promise<void>;
  observe(record: RequestRecord): Promise<Observation>;
  collect(record: RequestRecord, observation: Observation): Promise<ExecutionResult>;
  fingerprint(record: RequestRecord): Promise<string>;
  resume(record: RequestRecord): Promise<void>;
}
export interface Runtime {
  projectSnapshot?: RequestRecord["projectSnapshot"];
  validate(): Promise<void>;
  preflight?(checks: RequestRecord["checks"]): Promise<{ baseCommit: string; projectSnapshot: NonNullable<RequestRecord["projectSnapshot"]> }>;
  createWorkspace(record: RequestRecord): Promise<{ id: string; directory: string }>;
  writePlans(record: RequestRecord): Promise<void>;
  startAgent(record: RequestRecord): Promise<string>;
}

export interface RecoveryRuntime {
  lookupDelivery(record: RequestRecord, command: RequestRecord["commands"][number]): Promise<Lookup<{ id: string; directory?: string }>>;
}
