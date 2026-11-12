import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNodeTest } from "../adapters/storage/evidence";

test("independent Node runner handles Windows paths with spaces, assertion failures and write denial", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orchiva evidence ")));
  try {
    const path = join(root, "feature.test.mjs");
    await writeFile(path, "import assert from 'node:assert/strict'; import {writeFileSync} from 'node:fs'; assert.equal(2+3,5); assert.throws(()=>writeFileSync('forbidden.txt','x'),{code:'ERR_ACCESS_DENIED'});");
    assert.match((await runNodeTest(root, path, 10000)).stdout, /pass 1/);
    await writeFile(path, "import assert from 'node:assert/strict'; assert.equal(1,2);");
    await assert.rejects(runNodeTest(root, path, 10000), (error: any) => error.code === 1 && /ERR_ASSERTION/.test(error.stdout + error.stderr));
  } finally {
    // Only remove the verified, newly created fixture under the OS temp directory.
    assert.ok(root.toLowerCase().startsWith((await realpath(tmpdir())).toLowerCase() + "\\") || root.startsWith((await realpath(tmpdir())) + "/"));
    await rm(root, { recursive: true, force: true });
  }
});
