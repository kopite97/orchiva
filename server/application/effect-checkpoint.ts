import type { Lookup } from "./ports";

export interface EffectCheckpoint<T> {
  key: string;
  payloadHash: string;
  state: "pending" | "applied" | "unknown";
  value?: T;
}
export interface EffectStore<T> {
  read(key: string): Promise<EffectCheckpoint<T> | null>;
  write(record: EffectCheckpoint<T>): Promise<void>;
}

/** Minimal recovery contract for the M0 probe; callers serialize per key. No queue. */
export async function performEffect<T>(input: { key: string; payloadHash: string }, store: EffectStore<T>, effect: {
  apply(): Promise<T>;
  lookup(): Promise<Lookup<T>>;
  retryAbsent?: boolean;
}): Promise<Lookup<T>> {
  const previous = await store.read(input.key);
  if (previous && previous.payloadHash !== input.payloadHash) throw new Error("IDEMPOTENCY_CONFLICT");
  if (previous?.state === "applied") return { kind: "found", value: previous.value as T };
  if (previous) {
    let observed: Lookup<T>;
    try { observed = await effect.lookup(); } catch { observed = { kind: "unknown", reason: "Resource lookup failed." }; }
    if (observed.kind === "found") {
      await store.write({ ...input, state: "applied", value: observed.value });
      return observed;
    }
    if (observed.kind !== "absent" || !effect.retryAbsent) {
      await store.write({ ...input, state: "unknown" });
      return { kind: "unknown", reason: "Delivery needs reconciliation; no safe retry established." };
    }
  }
  await store.write({ ...input, state: "pending" });
  try {
    const value = await effect.apply();
    await store.write({ ...input, state: "applied", value });
    return { kind: "found", value };
  } catch {
    await store.write({ ...input, state: "unknown" });
    return { kind: "unknown", reason: "Effect or confirmation save was interrupted." };
  }
}
