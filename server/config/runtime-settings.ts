import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

export interface RuntimeSettings { dataHome: string; paseoHome: string; endpoint: string; isolationRoot: string | null; }
const directory = (path: string) => {
  if (!isAbsolute(path)) throw new Error("RUNTIME_SETTINGS: absolute directory required");
  const actual = realpathSync(path);
  if (!statSync(actual).isDirectory()) throw new Error("RUNTIME_SETTINGS: directory required");
  return actual;
};
export function readRuntimeSettings(env: NodeJS.ProcessEnv = process.env): RuntimeSettings {
  const keys = ["ORCHIVA_DATA_HOME", "ORCHIVA_PASEO_HOME", "ORCHIVA_PASEO_ENDPOINT", "ORCHIVA_ISOLATION_ROOT"] as const;
  if (!keys.some(key => env[key] !== undefined)) return { dataHome: join(homedir(), ".orchiva"), paseoHome: join(homedir(), ".paseo-orchiva"), endpoint: "127.0.0.1:6767", isolationRoot: null };
  if (keys.some(key => !env[key])) throw new Error("RUNTIME_SETTINGS: all isolated settings are required; no fallback");
  const isolationRoot = directory(env.ORCHIVA_ISOLATION_ROOT!), dataHome = directory(env.ORCHIVA_DATA_HOME!), paseoHome = directory(env.ORCHIVA_PASEO_HOME!);
  const protectedHomes = [join(homedir(), ".orchiva"), join(homedir(), ".paseo-orchiva")].map(path => existsSync(path) ? realpathSync(path) : path);
  for (const actual of [dataHome, paseoHome]) {
    const rel = relative(isolationRoot, actual);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("RUNTIME_SETTINGS: home outside isolation root");
    for (const forbidden of protectedHomes) {
      const diff = relative(forbidden, actual);
      if (!diff || (!diff.startsWith(`..${sep}`) && diff !== ".." && !isAbsolute(diff))) throw new Error("RUNTIME_SETTINGS: production home excluded");
    }
  }
  if (dataHome.toLowerCase() === paseoHome.toLowerCase()) throw new Error("RUNTIME_SETTINGS: distinct homes required");
  const endpoint = env.ORCHIVA_PASEO_ENDPOINT!;
  const port = /^127\.0\.0\.1:(\d{4,5})$/.exec(endpoint)?.[1];
  if (!port || +port < 1024 || +port > 65535 || +port === 6767) throw new Error("RUNTIME_SETTINGS: isolated loopback endpoint required");
  return { dataHome, paseoHome, endpoint, isolationRoot };
}
