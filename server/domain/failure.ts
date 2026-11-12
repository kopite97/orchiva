import type { RequestRecord } from "../../shared/contracts/feature-request";

export function failureView(record: RequestRecord): NonNullable<RequestRecord["failure"]> | null {
  if (record.commands.some(x => x.status === "unknown") || record.recovery?.pending) return { kind: "delivery-unknown", code: "DELIVERY_UNKNOWN", message: record.deliveryChecks?.at(-1)?.detail ?? record.observationError ?? record.error ?? "생성·전송 결과를 대조해야 합니다. 자동 재전송하지 않습니다." };
  if (record.status !== "failed") return null;
  if (record.failure) return record.failure;
  const kind = !record.agentId ? "setup" : record.decision?.approved === false ? "review-rejected" : record.result?.executionFailure ? "execution" : !record.result || record.result.checks.some(x => x.status === "error" || x.status === "skipped") ? "verification-system" : "validation";
  return { kind, code: kind.toUpperCase().replaceAll("-", "_"), message: record.error ?? "실패 원인과 근거를 확인하세요." };
}
export const isPreparation = (command: RequestRecord["commands"][number]) => ["start", "retry-start"].includes(command.kind);
export function retryablePreparation(record: RequestRecord) {
  const command = record.commands.filter(isPreparation).at(-1);
  return record.status === "failed" && !record.agentId && record.confirmationSource === "confirmed-plan" && record.failure?.kind !== "resource-missing" && command?.status === "failed" && ["accepted", "plans"].includes(command.phase) ? command : null;
}
