import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHostClient } from "@getpaseo/client/node";
import { OwnedConnection } from "../server/adapters/paseo/connection";
import { readRuntimeSettings } from "../server/config/runtime-settings";
import { BridgeSession, LineFrames } from "./protocol";
import { runIsolatedDaemon } from "./launcher";

async function main() {
  const settings = readRuntimeSettings();
  if (!settings.isolationRoot) throw new Error("ISOLATED_SETTINGS_REQUIRED");
  if (process.argv.includes("--run-daemon")) { await runIsolatedDaemon(settings, () => process.stdout.write("DAEMON_READY\n")); return; }
  const owner = new OwnedConnection(() => {
    const client = createHostClient(settings.endpoint, { clientId: `orchiva-desktop-${process.pid}`, clientType: "cli", appVersion: "0.15.4", connectTimeoutMs: 3000, reconnect: { enabled: false }, localCredential: async () => (await readFile(join(settings.paseoHome, "local-credential"), "utf8")).trim() });
    return { api: client, connect: () => client.connect(), close: () => client.close() };
  }, { attempts: 2, retryMs: 250 });
  const session = new BridgeSession({ invoke: async (method, params) => (await owner.start()).invokePluginRpc("orchiva-plugin", method, params), close: () => owner.dispose() }, settings);
  const frames = new LineFrames();
  let closing = false;
  const close = async () => { if (closing) return; closing = true; process.stdin.destroy(); await owner.dispose(); };
  const stop = () => { void close(); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  // Await write completion as well as SDK responses: a stalled reader cannot
  // accumulate an unbounded stdout queue. At most eight responses are in flight.
  const respond = async (frame: string) => {
    const result = await session.handle(frame);
    if (!closing) await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(result) + "\n", error => error ? reject(error) : resolve()));
  };
  process.stdout.on("error", stop);
  try {
    for await (const chunk of process.stdin) {
      const batch = frames.push(chunk as Buffer);
      for (let offset = 0; offset < batch.length && !closing; offset += 8) await Promise.all(batch.slice(offset, offset + 8).map(respond));
    }
  } catch { if (!closing) { process.stderr.write("BRIDGE_FRAME_REJECTED\n"); process.exitCode = 2; } }
  finally { await close(); process.off("SIGTERM", stop); process.off("SIGINT", stop); }
}
main().catch(() => { process.stderr.write("BRIDGE_START_FAILED: check isolated settings\n"); process.exitCode = 1; });
