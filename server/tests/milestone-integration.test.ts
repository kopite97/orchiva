import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry } from "../../shared/contracts/milestone-integration";
import { GithubPublication, type GithubApi, lf } from "../adapters/github/milestone-github";
import { advanceRef, featureCommit, gitText, initializeRepo, ref, treeFile, verifiedFiles } from "../adapters/storage/integration-git";
import { digest } from "../adapters/storage/project-files";
import { captureInput } from "../application/desktop/snapshots";
import type { Projects } from "../application/desktop/projects";
import type { ProductionInput } from "../../shared/contracts/desktop-production";

const base = "1".repeat(40), head = "2".repeat(40), merged = "3".repeat(40), tree = "4".repeat(40);
const stamp = "2026-11-26T00:00:00Z", marker = "<!-- test-plan -->";
function sample(): Entry {
  return {
    feature: "A", token: "sample-001", result: "result", manifest: digest("manifest"), fingerprint: "fingerprint", planHash: digest("plan"), review: "review", base,
    head, branch: "feature/A", integrated: null, remote: { issue: null, pr: null, base: null, head: null, merge: null, pending: null, phase: "queued", lastBody: null, remoteBody: null, body: "Public PLAN\n" }
  };
}
class Transport implements GithubApi {
  contexts = ["hud"]; checkApp = 15368; requiredReviews = 1; owner = 1;
  advertisedBase?: string;
  issue: any; pr: any; approved = true; checks = true; latest = base; featureHead: string | null = null;
  votes: any[] = []; lost = ""; denied = ""; deniedCode = 429; readonly effects: string[] = [];
  async list(path: string) {
    if (path.includes("/reviews?")) return this.votes;
    if (path.includes("/issues?")) return this.issue ? [this.issue] : [];
    if (path.includes("/pulls?")) return this.pr ? [this.pr] : [];
    throw Error(path);
  }
  async call(method: string, path: string, value: any = {}): Promise<any> {
    const route = path.replace("repos/org/test", "");
    let result: any;
    if (method === "GET") {
      if (route === "user") return { id: 1 };
      if (route === "") return { id: 1, full_name: "org/test", default_branch: "main", owner: {type: "User", id: this.owner} };
      if (route.startsWith("/git/ref/heads/")) {
        const sha = route.endsWith("/integration") ? this.latest : this.featureHead;
        if (!sha) throw Error("GITHUB_HTTP_404"); return { object: { sha } };
      }
      if (route.startsWith("/git/commits/")) return { sha: route.slice(-40), tree: { sha: tree }, parents: route.endsWith(merged) ? [{ sha: base }, { sha: head }] : [{ sha: base }] };
      if (route === "/issues/1") return this.issue;
      if (route.startsWith("/compare/")) return { merge_base_commit: { sha: base } };
      if (route === "/pulls/2") return { ...this.pr, base: { ...this.pr.base, sha: this.advertisedBase ?? this.latest } };
      if (route.includes("/check-runs")) return { total_count: 1, check_runs: [{ name: "hud", status: "completed", conclusion: this.checks ? "success" : "failure", head_sha: head, app: { id: this.checkApp } }] };
      if (route.includes("/protection")) return { enforce_admins: { enabled: true }, required_status_checks: { strict: true, contexts: this.contexts, checks: this.contexts.map(context => ({context, app_id: 15368})) }, required_pull_request_reviews: { dismiss_stale_reviews: true, required_approving_review_count: this.requiredReviews } };
      throw Error(route);
    }
    const effect = method + " " + route;
    if (this.denied === effect) throw Error("GITHUB_HTTP_" + this.deniedCode);
    this.effects.push(effect);
    if (effect === "POST /issues") result = this.issue = { number: 1, state: "open", body: value.body };
    else if (effect === "PATCH /issues/1") result = Object.assign(this.issue, value);
    else if (effect === "POST /git/commits") result = { sha: value.parents.length === 1 ? head : "5".repeat(40), tree: { sha: tree }, parents: value.parents.map((sha: string) => ({sha})) };
    else if (effect === "PATCH /git/refs/heads/feature/A") { assert.equal(value.force,false); this.featureHead=this.pr.head.sha=value.sha; result={}; }
    else if (effect === "POST /git/refs") { this.featureHead = value.sha; result = {}; }
    else if (effect === "POST /pulls") result = this.pr = { number: 2, user: { id: 1 }, state: "open", body: value.body, head: { repo: { id: 1 }, ref: "feature/A", sha: head }, base: { repo: { id: 1 }, ref: "integration", sha: base } };
    else if (effect === "PUT /pulls/2/merge") { Object.assign(this.pr, { merged: true, merged_by: { id: 1 }, merge_commit_sha: merged, state: "closed" }); this.latest = merged; result = { merged: true }; }
    else throw Error(effect);
    if (this.lost === effect) { this.lost = ""; throw Error("GITHUB_RESPONSE_UNKNOWN"); }
    return result;
  }
}
test("remote journal reconciles lost issue, PR and merge responses; rejects stale bases, review and check failures", async () => {
  const api = new Transport(), target = { repo: "org/test", repoId: 1, base: "integration", checks: ["hud"] };
  const folder = await mkdtemp(join(tmpdir(), "ma3-queue-")), journal = join(folder, "entry.json"); let e = sample();
  await writeFile(journal, JSON.stringify(e));
  const sync = async (action: string, hash?: string) => {
    e = JSON.parse(await readFile(journal, "utf8"));
    await new GithubPublication(api, target).sync(e, [], stamp, marker, action, hash, async () => { await writeFile(journal, JSON.stringify(e)); }, true);
  };
  api.denied = "POST /issues"; await assert.rejects(sync("publish"), /429/); assert.equal(e.remote!.pending, null);
  api.deniedCode = 401; await assert.rejects(sync("publish"), /401/);
  api.denied = ""; api.lost = "POST /issues"; await assert.rejects(sync("publish"), /UNKNOWN/);
  api.lost = "POST /pulls"; await assert.rejects(sync("publish"), /UNKNOWN/);
  await sync("publish"); assert.equal(e.remote!.pr, 2);
  api.issue.body = api.issue.body.replace("Public", "Edited"); await sync("observe"); assert.equal(e.remote!.phase, "body-conflict");
  await sync("adopt", digest(lf(api.issue.body))); assert.match(e.remote!.body, /Edited/);
  api.issue.body += "\nReviewer clarification after the marker.\n";
  await sync("observe"); await sync("adopt", digest(lf(api.issue.body))); await sync("observe");
  assert.equal(e.remote!.lastBody, lf(api.issue.body));
  await assert.rejects(sync("merge"), /REVIEW_REQUIRED/);
  const vote = { user: { id: 2, login: "other", type: "User" }, author_association: "COLLABORATOR", state: "APPROVED", commit_id: head };
  api.votes = [{ ...vote, user: { ...vote.user, id: 1 } }]; await assert.rejects(sync("merge"), /REVIEW_REQUIRED/);
  api.votes = [vote]; api.pr.head.sha = merged; await assert.rejects(sync("merge"), /HEAD_CHANGED/); api.pr.head.sha = head; api.checks = false; await assert.rejects(sync("merge"), /CHECKS_REQUIRED/);
  api.checks = true; api.latest = "5".repeat(40); await assert.rejects(sync("merge"), /BASE_MOVED/);
  api.latest = base; api.lost = "PUT /pulls/2/merge"; await assert.rejects(sync("merge"), /UNKNOWN/);
  api.latest = base; await assert.rejects(sync("merge"), /MERGE_UNCONFIRMED/);
  assert.equal(api.issue.state, "open");
  api.latest = merged; await sync("merge");
  assert.equal(e.remote!.merge, merged); assert.equal(api.issue.state, "closed");
  for (const effect of ["POST /issues", "POST /pulls", "PUT /pulls/2/merge"]) assert.equal(api.effects.filter(x => x === effect).length, 1);
});
test("a local publication pins protected checks on explicit merge and requires the designated app and independent review", async () => {
  const e = sample(), api = new Transport();
  const publisher = new GithubPublication(api, { repo: "org/test", repoId: 1, base: "integration", checks: [] });
  const sync = (action: string) => publisher.sync(e, [], stamp, marker, action, undefined, async () => {}, false);
  await sync("publish");
  assert.equal(e.remote!.protectedChecks, undefined);
  api.contexts = []; await assert.rejects(sync("merge"), /CHECKS_REQUIRED/);
  api.contexts = ["hud"]; await assert.rejects(sync("merge"), /REVIEW_REQUIRED/);
  assert.deepEqual(e.remote!.protectedChecks, ["hud"]);
  api.contexts = ["other"]; await assert.rejects(sync("merge"), /PROTECTION_REQUIRED/);
  api.contexts = ["hud"]; api.votes = [{user: {id: 2, login: "reviewer", type: "User"}, author_association: "COLLABORATOR", commit_id: head, state: "APPROVED"}];
  api.checkApp = 5; await assert.rejects(sync("merge"), /CHECKS_REQUIRED/);
  assert.equal(api.issue.state, "open");
  api.checkApp = 15368; await sync("merge");
  assert.equal(e.remote!.phase, "merged");
});
test("owner merge requires explicit current head, owner identity, solo branch policy and successful checks", async () => {
  const e = sample(), api = new Transport();
  const publisher = new GithubPublication(api, { repo: "org/test", repoId: 1, base: "integration", checks: ["hud"] });
  const sync = (action: string, expected?: string) => publisher.sync(e, [], stamp, marker, action, undefined, async () => {}, false, expected);
  await sync("publish");
  await assert.rejects(sync("owner-merge", head), /PROTECTION_REQUIRED/);
  api.requiredReviews = 0;
  await assert.rejects(sync("merge"), /PROTECTION_REQUIRED/);
  await assert.rejects(sync("owner-merge", base), /HEAD_CHANGED/);
  api.owner = 2; await assert.rejects(sync("owner-merge", head), /REVIEW_REQUIRED/);
  api.owner = 1; api.checks = false;
  await assert.rejects(sync("owner-merge", head), /CHECKS_REQUIRED/);
  assert.equal(api.issue.state, "open");
  api.checks = true; await sync("owner-merge", head);
  assert.equal(e.remote?.gate?.mode, "owner"); assert.deepEqual(e.remote?.gate?.reviewers, []);
  assert.equal(e.remote?.merge, merged); assert.equal(api.issue.state, "closed");
});
test("a published PR can reconcile a lost non-forced base refresh without reusing an old approval", async () => {
  const e = sample(), api = new Transport();
  const publisher = new GithubPublication(api, {repo:"org/test", repoId:1, base:"integration", checks:["hud"]});
  const sync = (action: string, expected?: string) => publisher.sync(e, [], stamp, marker, action, undefined, async () => {}, false, expected);
  await sync("publish"); api.latest = merged; api.advertisedBase = base; api.lost = "PATCH /git/refs/heads/feature/A";
  await assert.rejects(sync("refresh-base"), /UNKNOWN/);
  assert.ok(e.remote?.refresh); await sync("refresh-base");
  assert.equal(e.remote?.base, merged); assert.equal(e.remote?.head, api.pr.head.sha);
  await assert.rejects(sync("owner-merge", head), /HEAD_CHANGED/);
  assert.equal(api.effects.filter(x => x === "PATCH /git/refs/heads/feature/A").length, 1);
});
test("ambiguous response with no visible candidate is not resent; changed repo and default branch are refused", async () => {
  const e = sample(), api = new Transport(); e.remote!.pending = "create-issue";
  const target = { repo: "org/test", repoId: 1, base: "integration", checks: [] };
  await assert.rejects(new GithubPublication(api, target).sync(e, [], stamp, marker, "publish", undefined, async () => { }, false), /RECONCILIATION_REQUIRED/);
  assert.equal(api.effects.length, 0);
  await assert.rejects(new GithubPublication(api, { ...target, repoId: 2 }).identity(), /TARGET_INVALID/);
  await assert.rejects(new GithubPublication(api, { ...target, base: "main" }).identity(), /TARGET_INVALID/);
});
test("clean Git integration preserves deletion, binary and empty bytes, indirection and successor SHA", async () => {
  const temp = await mkdtemp(join(tmpdir(), "orchiva-ma3-")), source = join(temp, "source"), repo = join(temp, "git");
  await mkdir(source); await gitText(source, ["init", "-b", "main"]); await writeFile(join(source, "remove.txt"), "old");
  await gitText(source, ["add", "remove.txt"]); await gitText(source, ["-c", "user.name=fixture", "-c", "user.email=f@localhost", "commit", "-m", "base"]);
  const initial = await gitText(source, ["rev-parse", "HEAD"]); await initializeRepo(repo, source, initial); await advanceRef(repo, "develop", null, initial);
  const data = Buffer.from([0, 127, 255, 13, 10]);
  const manifest = {
    version: 1 as const, projectId: "fixture", token: "node-001", resultId: "r", fingerprint: "f", files: [
      { path: "remove.txt", before: digest("old"), after: null, content: null },
      { path: "binary.dat", before: null, after: digest(data), content: data.toString("base64") },
      { path: "empty.txt", before: null, after: digest(""), content: "" }]
  };
  const allowed = manifest.files.map(f => f.path);
  for (const path of [".env", ".git/config", "docs/agents/workflow.md", "key.pem", "../outside", "AGENTS.md"]) assert.throws(() => verifiedFiles({ ...manifest, files: [{ ...manifest.files[0], path }] }, [path]), /DENIED|INVALID/);
  const files = verifiedFiles(manifest, allowed);
  const commit = await featureCommit(repo, initial, "feature/A", files, "A", stamp);
  assert.equal(await featureCommit(repo, initial, "feature/A", files, "A", stamp), commit);
  await advanceRef(repo, "develop", initial, commit); assert.equal(await ref(repo, "develop"), commit);
  assert.equal(await treeFile(repo, commit, "remove.txt"), null); assert.deepEqual((await treeFile(repo, commit, "binary.dat"))?.bytes, data);
  await assert.rejects(featureCommit(repo, commit, "feature/B", files, "B", stamp), /FILE_CONFLICT/);
  await assert.rejects(advanceRef(repo, "develop", initial, base), /BASE_MOVED/);
  await writeFile(join(source, "private.txt"), "dirty"); await writeFile(join(source, "remove.txt"), "user edit");
  await gitText(source, ["fetch", "--no-tags", "--no-write-fetch-head", repo, commit]);
  const projects = { project: async () => ({ sourceRoot: source, config: { revision: 1, baseRef: "main" } }), instructions: async () => ({ ready: true, files: [], fingerprint: "test" }) } as unknown as Projects;
  const snapshot = await captureInput(projects, "fixture", { mode: "new" } as ProductionInput, { runId: "sample-run", milestone: "M", item: "B", scopeHash: digest("scope"), coordinator: false, checks: [], outputs: ["next.txt"], inputs: [{ path: "binary.dat", hash: digest(data) }], integrationBase: commit });
  assert.equal(snapshot.baseCommit, commit); assert.deepEqual(snapshot.files.map(f => f.path), ["binary.dat", "empty.txt"]);
  assert.equal(await gitText(source, ["rev-parse", "HEAD"]), initial);
});
