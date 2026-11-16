import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHostClient } from "@getpaseo/client/node";
import { readRuntimeSettings, type RuntimeSettings } from "../server/config/runtime-settings";
import { BridgeSession } from "./protocol";

async function isReady(settings: RuntimeSettings) {
  const client = createHostClient(settings.endpoint, {
    clientId: `orchiva-launch-${process.pid}`, clientType: "cli", appVersion: "0.15.4",
    connectTimeoutMs: 1000, reconnect: { enabled: false },
    localCredential: async () => (await readFile(join(settings.paseoHome, "local-credential"), "utf8")).trim(),
  });
  try {
    await client.connect();
    const session = new BridgeSession({ invoke: (method, params) => client.invokePluginRpc("orchiva-plugin", method, params), close: () => client.close() }, settings, 1000);
    const response = await session.handle(JSON.stringify({ protocolVersion: 1, id: "ready", method: "handshake", params: {} }));
    return "result" in response;
  } catch { return false; }
  finally { await client.close(); }
}

/** Only starts the explicitly configured isolated home. Never stops another daemon. */
export async function runIsolatedDaemon(settings: RuntimeSettings, ready: () => void) {
  if (!settings.isolationRoot) throw new Error("ISOLATED_SETTINGS_REQUIRED");
  const config = JSON.parse(await readFile(join(settings.paseoHome, "config.json"), "utf8"));
  if (config.daemon?.listen !== settings.endpoint) throw new Error("DAEMON_ENDPOINT_MISMATCH");
  const cli = process.env.ORCHIVA_PASEO_CLI;
  if (!cli || !isAbsolute(cli)) throw new Error("PASEO_CLI_REQUIRED");
  const cliPath = await realpath(cli);
  const env: NodeJS.ProcessEnv = { ...process.env, ORCHIVA_DATA_HOME: settings.dataHome, ORCHIVA_PASEO_HOME: settings.paseoHome, ORCHIVA_PASEO_ENDPOINT: settings.endpoint, ORCHIVA_ISOLATION_ROOT: settings.isolationRoot };
  settings = readRuntimeSettings(env); // Also protect callers other than bridge/index.ts.
  delete env.CODEX_WINDOWS_REGISTERED_CORE; delete env.CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY;
  // `run` accepts deployment overrides. The selected home's config is authoritative.
  for (const key of Object.keys(env)) if (key.startsWith("PASEO_")) delete env[key];
  if (await isReady(settings)) { ready(); return; }
  // `daemon start` uses detached:true internally, which creates a Windows console.
  // The public foreground command keeps its own supervisor/lock/stop protocol,
  // while our non-detached, hidden child has no console or inherited pipe handles.
  const child = spawn(process.execPath, [cliPath, "daemon", "run", "--home", settings.paseoHome], {
    env, windowsHide: true, detached: false, stdio: "ignore",
  });
  let exited = false;
  const finished = new Promise<number>(resolve => {
    child.once("exit", code => { exited = true; resolve(code ?? 1); });
    child.once("error", () => { exited = true; resolve(1); });
  });
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (await isReady(settings)) {
        ready();
        // Windows libuv kills non-detached children when their Node parent exits.
        // The .NET-created hidden host therefore remains alive until daemon stop.
        if (await finished !== 0) throw new Error("DAEMON_EXIT_FAILED");
        return;
      }
      if (exited) throw new Error("DAEMON_START_FAILED");
      await delay(200);
    }
    throw new Error("DAEMON_START_TIMEOUT");
  } catch (error) {
    // Only the child created here and its descendants; never stop an existing home.
    if (!exited && child.pid) {
      if (process.platform === "win32") await promisify(execFile)("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => { if (!exited) throw new Error("DAEMON_CLEANUP_FAILED"); });
      else child.kill("SIGTERM");
    }
    throw error;
  }
}
