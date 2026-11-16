import { envelopeSchema, maxFrameBytes, desktopContracts, runtimeInfoSchema } from "../shared/contracts/desktop-protocol";
import type { RuntimeSettings } from "../server/config/runtime-settings";
import { desktopError } from "../shared/contracts/desktop-errors";

export interface BridgeTransport { invoke(method: string, params: unknown): Promise<unknown>; close(): Promise<void>; }
export class BridgeSession {
  private seen = new Set<string>();
  private active = 0;
  private ready = false;
  private capabilities = new Set<string>();
  constructor(private transport: BridgeTransport, private settings: RuntimeSettings, private timeoutMs = 15000) {}
  async handle(raw: string): Promise<object> {
    let id: string | null = null;
    const failure = (code: string) => ({ protocolVersion: 1, id, error: { code, message: code, retryable: ["CONNECTION_FAILED", "TIMEOUT"].includes(code) } });
    try {
      if (Buffer.byteLength(raw) > maxFrameBytes) return failure("FRAME_TOO_LARGE");
      let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return failure("INVALID_JSON"); }
      const checked = envelopeSchema.safeParse(parsed);
      if (!checked.success) return failure("INVALID_ENVELOPE");
      const request = checked.data; id = request.id;
      if (this.seen.has(id)) return failure("DUPLICATE_ID");
      if (this.seen.size >= 10000) return failure("SESSION_LIMIT");
      this.seen.add(id);
      if (this.active >= 8) return failure("BUSY");
      if (request.method !== "handshake" && !Object.hasOwn(desktopContracts, request.method)) return failure("METHOD_DENIED");
      if (request.method !== "handshake" && !this.ready) return failure("HANDSHAKE_REQUIRED");
      if (request.method.startsWith("desktop.") && !this.capabilities.has(request.method)) return failure("CAPABILITY_UNAVAILABLE");
      const method = request.method === "handshake" ? "runtime.info" : request.method as keyof typeof desktopContracts;
      const contract = desktopContracts[method];
      const input = contract.input.safeParse(request.params);
      if (!input.success) return failure("INVALID_PARAMS");
      this.active++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([this.transport.invoke(method, input.data), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), this.timeoutMs); })]);
        const output = contract.output.safeParse(response);
        if (!output.success) return failure("INVALID_RESPONSE");
        if (method === "runtime.info") {
          const info = runtimeInfoSchema.parse(output.data);
          const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
          if (!info.isolated || !equal(info.dataHome, this.settings.dataHome) || !equal(info.paseoHome, this.settings.paseoHome) || info.endpoint !== this.settings.endpoint) { this.ready = false; return failure("ENVIRONMENT_MISMATCH"); }
          this.ready = true;
          this.capabilities = new Set(info.capabilities);
        }
        const result = { protocolVersion: 1, id, result: output.data };
        return Buffer.byteLength(JSON.stringify(result)) > maxFrameBytes ? failure("RESPONSE_TOO_LARGE") : result;
      } finally { clearTimeout(timer); this.active--; }
    } catch (error) { const code = desktopError(error); if (code) return failure(code); this.ready = false; return failure(error instanceof Error && error.message === "TIMEOUT" ? "TIMEOUT" : "CONNECTION_FAILED"); }
  }
}

/** Byte limit applies before decoding, including split UTF-8 and missing newlines. */
export class LineFrames {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): string[] {
    const frames: string[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index++) if (chunk[index] === 10) {
      this.append(chunk.subarray(start, index));
      frames.push(new TextDecoder("utf-8", { fatal: true }).decode(this.buffer).replace(/\r$/, ""));
      this.buffer = Buffer.alloc(0); start = index + 1;
    }
    this.append(chunk.subarray(start)); return frames;
  }
  private append(part: Buffer) { if (this.buffer.length + part.length > maxFrameBytes) throw new Error("FRAME_TOO_LARGE"); this.buffer = Buffer.concat([this.buffer, part]); }
}
