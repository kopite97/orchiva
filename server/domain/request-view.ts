import { z } from "zod";
import { pageInputSchema, type RequestRecord, actionSchema } from "../../shared/contracts/feature-request";
import { occupiesSlot } from "./record-v2";

export function allowedActions(record: RequestRecord): z.infer<typeof actionSchema>[] {
  if (record.status === "draft") return ["edit"];
  if (record.status === "ready") return ["edit", "plan"];
  const actions: z.infer<typeof actionSchema>[] = ["observe"];
  if (record.agentId) actions.push("open-session");
  if (record.recovery?.pending || record.commands.some(x => ["pending", "unknown"].includes(x.status))) return actions;
  if (record.agentId && ["awaiting-review", "failed"].includes(record.status)) {
    actions.push("resume"); if (record.result) actions.push("revalidate");
    if (record.status === "awaiting-review") actions.push("review");
  }
  return actions;
}
export function summarize(record: RequestRecord) {
  return { token: record.token, title: record.feature.title, status: record.status, statusReason: record.statusReason, attempt: record.attempt, updatedAt: record.updatedAt, createdAt: record.createdAt, active: occupiesSlot(record), allowedActions: allowedActions(record) };
}
export function requestPage(records: RequestRecord[], raw: unknown) {
  const input = pageInputSchema.parse(raw);
  const sorted = records.map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.token.localeCompare(b.token));
  const filtered = sorted.filter(x => input.filter === "all" || (input.filter === "draft" && ["draft", "ready"].includes(x.status)) || (input.filter === "active" && x.active) || (input.filter === "attention" && ["needs-input", "awaiting-review", "failed"].includes(x.status)) || (input.filter === "completed" && x.status === "completed"));
  let cursor: { at: string; token: string } | undefined;
  if (input.cursor) { try { cursor = z.object({ at: z.string(), token: z.string() }).parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))); } catch { throw new Error("INVALID_CURSOR"); } }
  const after = filtered.filter(x => !cursor || x.updatedAt < cursor.at || (x.updatedAt === cursor.at && x.token > cursor.token));
  const items = after.slice(0, input.limit), last = items.at(-1);
  return { items, nextCursor: after.length > items.length && last ? Buffer.from(JSON.stringify({ at: last.updatedAt, token: last.token })).toString("base64url") : null, active: sorted.filter(x => x.active), total: filtered.length };
}
