import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPaseoApi, type PaseoApi } from "@getpaseo/client";
import { createHostClient } from "@getpaseo/client/node";

export interface OwnedClient<T> {
  api: T;
  connect(): Promise<void>;
  close(): Promise<void>;
}

function cancelled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Connection disposed."));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Connection disposed."));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** One owner, one start promise, bounded retries, terminal and idempotent disposal. */
export class OwnedConnection<T> {
  private controller = new AbortController();
  private resource?: OwnedClient<T>;
  private starting?: Promise<T>;
  private stopping?: Promise<void>;
  private closed = new WeakMap<OwnedClient<T>, Promise<void>>();
  state: "idle" | "connecting" | "connected" | "failed" | "disposed" = "idle";

  constructor(private factory: () => OwnedClient<T>, private options = { attempts: 6, retryMs: 500 }) {
    if (!Number.isInteger(options.attempts) || options.attempts < 1 || options.retryMs < 0) throw new Error("Invalid connection retry policy.");
  }

  start(): Promise<T> {
    if (this.controller.signal.aborted) return Promise.reject(new Error("Connection disposed."));
    return this.starting ??= this.connect();
  }

  private release(resource: OwnedClient<T>) {
    let closing = this.closed.get(resource);
    if (!closing) {
      closing = Promise.resolve().then(() => resource.close());
      this.closed.set(resource, closing);
    }
    return closing;
  }

  private async connect(): Promise<T> {
    const signal = this.controller.signal;
    this.state = "connecting";
    for (let attempt = 0; attempt < this.options.attempts; attempt++) {
      if (signal.aborted) throw new Error("Connection disposed.");
      try {
        const resource = this.factory();
        this.resource = resource;
        await cancelled(resource.connect(), signal);
        if (signal.aborted) throw new Error("Connection disposed.");
        this.state = "connected";
        return resource.api;
      } catch (error) {
        if (this.resource) await this.release(this.resource);
        this.resource = undefined;
        if (signal.aborted) throw new Error("Connection disposed.");
        if (attempt + 1 === this.options.attempts) { this.state = "failed"; throw error; }
        await delay(Math.min(this.options.retryMs * 2 ** attempt, 5000), undefined, { signal });
      }
    }
    throw new Error("Connection attempts exhausted.");
  }

  dispose(): Promise<void> {
    return this.stopping ??= this.stop();
  }

  private async stop() {
    this.controller.abort();
    this.state = "disposed";
    const resource = this.resource;
    if (resource) await this.release(resource);
    await this.starting?.catch(() => undefined);
    this.resource = undefined;
  }
}

export function localConnection(clientId: string, endpoint = "127.0.0.1:6767") {
  return new OwnedConnection<PaseoApi>(() => {
    const client = createHostClient(endpoint, {
      clientId, clientType: "cli", appVersion: "0.15.4", connectTimeoutMs: 3000,
      localCredential: async () => (await readFile(join(homedir(), ".paseo-orchiva", "local-credential"), "utf8")).trim(),
      reconnect: { enabled: false },
    });
    const api = createPaseoApi(client);
    return { api, connect: () => client.connect(), close: async () => { try { await api.dispose(); } finally { await client.close(); } } };
  });
}
