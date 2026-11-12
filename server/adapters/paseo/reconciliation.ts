import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import type { Lookup } from "../../application/ports";
export type { Lookup } from "../../application/ports";

/** Absence is useful evidence, never by itself a guarantee that a send can be retried. */
export async function findMessage(timeline: Pick<PaseoAgentTimelineHandle, "refetch">, messageId: string, expectedText?: string, maxPages = 20): Promise<Lookup<{ seq: number; epoch: string }>> {
  let cursor: Parameters<PaseoAgentTimelineHandle["refetch"]>[0];
  let epoch: string | undefined;
  let identitiesMissing = false;
  const visited = new Set<string>();
  try {
    for (let index = 0; index < maxPages; index++) {
      const page = await timeline.refetch(cursor ?? { direction: "tail", limit: 100 });
      if (page.gap || page.staleCursor || (index > 0 && page.reset)) return { kind: "unknown", reason: "Timeline is incomplete or reset." };
      if (epoch && epoch !== page.epoch) return { kind: "unknown", reason: "Timeline epoch changed." };
      epoch = page.epoch;
      identitiesMissing ||= page.entries.some(entry => entry.item.type === "user_message" && !entry.item.clientMessageId);
      const matches = page.entries.filter(entry => entry.item.type === "user_message" && entry.item.clientMessageId === messageId);
      if (matches.length > 1) return { kind: "unknown", reason: "Duplicate message ID." };
      const entry = matches[0];
      if (entry) {
        if (entry.item.type !== "user_message" || (expectedText !== undefined && entry.item.text !== expectedText)) return { kind: "unknown", reason: "Message payload mismatch." };
        return { kind: "found", value: { seq: entry.seqEnd, epoch: page.epoch } };
      }
      if (!page.hasOlder) return identitiesMissing
        ? { kind: "unknown", reason: "Restored history lacks client message identities." }
        : { kind: "absent" };
      if (!page.startCursor) return { kind: "unknown", reason: "Missing history cursor." };
      const key = JSON.stringify(page.startCursor);
      if (visited.has(key)) return { kind: "unknown", reason: "History cursor did not advance." };
      visited.add(key);
      cursor = { direction: "before", cursor: page.startCursor, limit: 100 };
    }
    return { kind: "unknown", reason: "History page budget exceeded." };
  } catch { return { kind: "unknown", reason: "History unavailable." }; }
}

export function reconcileCandidates<T>(candidates: T[], matches: (item: T) => boolean, complete: boolean): Lookup<T> {
  const found = candidates.filter(matches);
  if (found.length > 1) return { kind: "unknown", reason: "Multiple matching resources." };
  if (found.length === 1 && complete) return { kind: "found", value: found[0] };
  if (!complete) return { kind: "unknown", reason: "Incomplete resource inventory." };
  return { kind: "absent" };
}
