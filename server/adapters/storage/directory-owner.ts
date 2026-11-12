import { createServer, type Server } from "node:net";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";

/** Kernel ownership, not an expiring PID file. Windows named pipes avoid port collisions. */
export class DirectoryOwner {
  private server?: Server;
  private opening?: Promise<void>;
  private closed = false;
  constructor(private directory: string) {}
  open() { if (this.closed) return Promise.reject(new Error("STORE_CLOSED")); return this.opening ??= this.acquire(); }
  private async acquire() {
    if (this.closed) throw new Error("STORE_CLOSED");
    await mkdir(this.directory, { recursive: true });
    const path = await realpath(this.directory);
    const digest = createHash("sha256").update(process.platform === "win32" ? path.toLowerCase() : path).digest();
    const port = 30000 + digest.readUInt32BE(0) % 30000;
    const endpoint = process.platform === "win32" ? { path: `\\\\.\\pipe\\orchiva-store-${digest.toString("hex")}`, exclusive: true } : { host: "127.0.0.1", port, exclusive: true };
    const server = createServer(socket => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(new Error("STORE_OWNED: local writer endpoint is occupied or unavailable")));
      server.listen(endpoint, resolve);
    });
    server.unref(); this.server = server;
  }
  async close() {
    this.closed = true;
    await this.opening?.catch(() => undefined);
    if (this.server) {
      const server = this.server; this.server = undefined;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}
