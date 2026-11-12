import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DirectoryOwner } from "../adapters/storage/directory-owner";

test("kernel ownership rejects a second writer and is released on normal close", async t => {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-owner-"));
  const first = new DirectoryOwner(directory), second = new DirectoryOwner(directory);
  t.after(async () => { await first.close(); await second.close(); await rm(directory, { recursive: true, force: true }); });
  await first.open(); await assert.rejects(second.open(), /STORE_OWNED/);
  await first.close(); const third = new DirectoryOwner(directory); await third.open(); await third.close();
});

test("an owned child crash releases the kernel lock without guessing stale PID age", async t => {
  const directory = await mkdtemp(join(tmpdir(), "orchiva-owner-crash-"));
  const module = new URL("../adapters/storage/directory-owner.ts", import.meta.url).href;
  const source = `import {DirectoryOwner} from ${JSON.stringify(module)}; process.on('message', () => {}); const owner = new DirectoryOwner(process.argv[1]); await owner.open(); process.send({ready:true,pid:process.pid});`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, directory], { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exit = once(child, "exit"); let timeout: ReturnType<typeof setTimeout> | undefined;
  t.after(async () => { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) child.kill(); await exit; await rm(directory, { recursive: true, force: true }); });
  const [ready] = await Promise.race([once(child, "message"), exit.then(() => { throw Error("Child exited before ownership"); }), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(Error("Child ownership timeout")), 10000); })]);
  clearTimeout(timeout); assert.equal(ready.pid, child.pid);
  const blocked = new DirectoryOwner(directory); await assert.rejects(blocked.open(), /STORE_OWNED/); await blocked.close();
  assert.ok(child.kill("SIGKILL")); await exit;
  const recovered = new DirectoryOwner(directory); await recovered.open(); await recovered.close();
});
