import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { Entry, Settings } from "../../../shared/contracts/milestone-integration";
import type { TransferManifest } from "../../application/desktop/transfers";
import { digest } from "../storage/project-files";

export interface GithubApi {
  call(method: string, path: string, payload?: object): Promise<any>;
  list(path: string): Promise<any[]>;
}
export class GhApi implements GithubApi {
  private invoke(args: string[], payload?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = execFile("gh", ["api", "--hostname", "github.com", ...args], { windowsHide: true, timeout: 45000, maxBuffer: 12 * 1024 * 1024 },
        (error, out, err) => {
          if (error) {
            const status = /HTTP (\d{3})/.exec(err)?.[1];
            reject(new Error(status ? "GITHUB_HTTP_" + status : "GITHUB_RESPONSE_UNKNOWN")); return;
          }
          try { resolve(out.trim() ? JSON.parse(out) : null); } catch { reject(new Error("GITHUB_RESPONSE_UNKNOWN")); }
        });
      child.stdin?.on("error", () => { }); child.stdin?.end(payload ? JSON.stringify(payload) : undefined);
    });
  }
  call(method: string, path: string, payload?: object) { return this.invoke(["--method", method, path, ...(payload ? ["--input", "-"] : [])], payload); }
  async list(path: string) { return (await this.invoke(["--paginate", "--slurp", path])).flat() as any[]; }
}
export const lf = (body: string) => body.replace(/\r\n?/g, "\n").trimEnd() + "\n";
export function publicDocument(body: string, marker: string, previous: string | null) {
  if (previous?.includes(marker) && lf(previous.replace(marker, "")) === lf(body)) return lf(previous);
  return lf(lf(body) + "\n" + marker);
}
const encoded = (path: string) => path.split("/").map(encodeURIComponent).join("/");
type Target = NonNullable<Settings["github"]>;
export class GithubPublication {
  private prefix: string;
  constructor(private api: GithubApi, private target: Target) { this.prefix = "repos/" + target.repo + "/"; }
  private get(path: string) { return this.api.call("GET", this.prefix + path); }
  private send(method: string, path: string, value: object) { return this.api.call(method, this.prefix + path, value); }
  private list(path: string) { return this.api.list(this.prefix + path); }
  async identity() {
    const repo = await this.api.call("GET", "repos/" + this.target.repo);
    if (repo.id !== this.target.repoId || repo.full_name.toLowerCase() !== this.target.repo.toLowerCase() || repo.archived || repo.default_branch === this.target.base)
      throw new Error("GITHUB_TARGET_INVALID");
    return repo;
  }
  async head(branch: string): Promise<string | null> {
    try { return (await this.get("git/ref/heads/" + encoded(branch))).object.sha; }
    catch (e) { if ((e as Error).message === "GITHUB_HTTP_404") return null; throw e; }
  }
  async candidate(entry: Entry, files: TransferManifest["files"], at: string, base = entry.remote!.base!, parents = [base]) {
    const commit = await this.get("git/commits/" + base);
    const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    let tree = commit.tree.sha;
    const updates = [];
    for (const file of files) {
      const parent = file.path.split("/"); const name = parent.pop()!;
      let directory = commit.tree.sha, prior: any;
      for (const [index, segment] of [...parent, name].entries()) {
        if (directory === emptyTree) break;
        const listing = await this.get("git/trees/" + directory);
        if (listing.truncated) throw new Error("GITHUB_TREE_INCOMPLETE");
        prior = listing.tree.find((e: any) => e.path === segment);
        if (!prior) break;
        if (index < parent.length && prior.type !== "tree") throw new Error("GITHUB_FILE_CONFLICT");
        directory = prior.sha;
      }
      if (prior && !["100644", "100755"].includes(prior.mode)) throw new Error("GITHUB_FILE_CONFLICT");
      const before = prior ? await this.get("git/blobs/" + prior.sha) : null;
      if ((before ? digest(Buffer.from(before.content, "base64")) : null) !== file.before) throw new Error("GITHUB_FILE_CONFLICT");
      const blob = file.content === null ? null : await this.send("POST", "git/blobs", { content: file.content, encoding: "base64" });
      if (blob) {
        const data = Buffer.from(file.content!, "base64");
        if (blob.sha !== createHash("sha1").update("blob " + data.length + "\0").update(data).digest("hex")) throw new Error("GITHUB_TREE_MISMATCH");
      }
      updates.push({ path: file.path, mode: prior?.mode ?? "100644", type: "blob", sha: blob?.sha ?? null });
    }
    if (updates.length) tree = (await this.send("POST", "git/trees", { ...(tree === emptyTree ? {} : { base_tree: tree }), tree: updates })).sha;
    const author = { name: "Orchiva", email: "orchiva@localhost", date: at };
    const head = await this.send("POST", "git/commits", { tree, parents, message: "Feature " + entry.feature + "\n\nApproved manifest " + entry.manifest, author, committer: author });
    if (head.tree.sha !== tree || head.parents.length !== parents.length || parents.some((p, i) => head.parents[i].sha !== p)) throw new Error("GITHUB_HEAD_CHANGED");
    return head.sha as string;
  }
  async branch(branch: string, sha: string) {
    if (branch === this.target.base) throw new Error("GITHUB_TARGET_INVALID");
    const head = await this.head(branch);
    if (!head) await this.send("POST", "git/refs", { ref: "refs/heads/" + branch, sha });
    if (await this.head(branch) !== sha) throw new Error("GITHUB_HEAD_CHANGED");
  }
  async sync(entry: Entry, files: TransferManifest["files"], at: string, marker: string, action: string, observedHash: string | undefined,
    save: () => Promise<void>, requireBase: boolean, expectedHead?: string) {
    const repository = await this.identity();
    const r = entry.remote!, title = "[" + entry.feature + "] " + r.body.split("\n")[0].replace(/^#+\s*/, "").slice(0, 140);
    const ownerMerge = action === "owner-merge";
    if (ownerMerge && (!expectedHead || expectedHead !== r.head || !r.pr || !r.issue)) throw new Error("GITHUB_HEAD_CHANGED");
    if (action === "refresh-base" && (!r.pr || !r.head || requireBase)) throw new Error("GITHUB_BASE_MOVED");
    const body = () => publicDocument(r.body, marker, r.lastBody);
    const intent = async (effect: string, operation: () => Promise<any>) => {
      if (r.pending === effect) throw new Error("GITHUB_RECONCILIATION_REQUIRED");
      r.pending = effect; await save();
      try { return await operation(); }
      catch (e) {
        if (/^GITHUB_HTTP_(400|401|403|404|409|422|429)$/.test((e as Error).message)) { r.pending = null; await save(); }
        throw e;
      }
    };
    if (!r.issue) {
      const issues = (await this.list("issues?state=all&per_page=100")).filter(i => !i.pull_request && i.body?.includes(marker));
      if (issues.length > 1) throw new Error("GITHUB_IDENTITY_AMBIGUOUS");
      if (!issues.length && action === "observe" && !r.pending) return;
      const issue = issues[0] ?? await intent("create-issue", () => this.send("POST", "issues", { title, body: body() }));
      r.issue = issue.number; r.lastBody = body(); r.pending = null; await save();
    }
    const issue = await this.get("issues/" + r.issue);
    if (issue.pull_request) throw new Error("GITHUB_IDENTITY_AMBIGUOUS");
    const actual = lf(issue.body ?? ""); const expected = lf(body());
    if (actual !== expected) {
      if (actual !== lf(r.lastBody ?? "")) {
        if (!["adopt", "overwrite"].includes(action) || observedHash !== digest(actual)) {
          r.remoteBody = actual; r.phase = "body-conflict"; await save(); return;
        }
        if (action === "adopt") {
          if (!actual.includes(marker)) throw new Error("GITHUB_MARKER_MISSING");
          const accepted = lf(actual.replace(marker, ""));
          if (!accepted.trim() || accepted.length > 24000 || accepted.includes("<!-- orchiva-plan:") || accepted.includes(marker))
            throw new Error("GITHUB_BODY_CHANGED");
          r.body = accepted; r.lastBody = actual; r.remoteBody = null; r.phase = "adopted"; r.pending = null; await save(); return;
        }
      }
      if (action === "observe") { r.remoteBody = actual; r.phase = "body-conflict"; await save(); return; }
      await intent("update-issue", () => this.send("PATCH", "issues/" + r.issue, { body: body() }));
      if (lf((await this.get("issues/" + r.issue)).body) !== lf(body())) throw new Error("GITHUB_BODY_CHANGED");
    }
    r.lastBody = body(); r.remoteBody = null;
    if (r.pending === "update-issue") r.pending = null;
    if (!r.base) { r.base = await this.head(this.target.base); if (!r.base) throw new Error("GITHUB_BASE_MISSING"); await save(); }
    if (requireBase && r.base !== entry.base) throw new Error("GITHUB_BASE_MOVED");
    if (!r.head) {
      if (action === "observe") return;
      r.head = await this.candidate(entry, files, at); await save();
    }
    if (action !== "observe" && !r.pr) await this.branch(entry.branch, r.head);
    if (!r.pr) {
      const query = "pulls?state=all&per_page=100&head=" + encodeURIComponent(this.target.repo.split("/")[0] + ":" + entry.branch) + "&base=" + encodeURIComponent(this.target.base);
      const prs = (await this.list(query)).filter(p => p.head.repo?.id === this.target.repoId && p.head.ref === entry.branch && p.base.ref === this.target.base);
      if (prs.length > 1) throw new Error("GITHUB_IDENTITY_AMBIGUOUS");
      if (!prs.length && action === "observe") return;
      if (!prs.length && await this.head(this.target.base) !== r.base) throw new Error("GITHUB_BASE_MOVED");
      const pr = prs[0] ?? await intent("create-pr", () => this.send("POST", "pulls", { title, head: entry.branch, base: this.target.base, body: "Tracks #" + r.issue + "\n\n" + marker + "\n\nManifest: " + entry.manifest }));
      r.pr = pr.number; r.pending = null; await save();
    }
    const pr = await this.get("pulls/" + r.pr);
    if (!pr.body?.includes(marker)) throw new Error("GITHUB_IDENTITY_AMBIGUOUS");
    if (pr.head.ref !== entry.branch || pr.head.repo?.id !== this.target.repoId || pr.base.repo?.id !== this.target.repoId || pr.base.ref !== this.target.base) throw new Error("GITHUB_HEAD_CHANGED");
    if (action === "refresh-base" || r.refresh) {
      if (requireBase || pr.state !== "open" || pr.merged || r.pending || entry.branch === this.target.base) throw new Error("GITHUB_RECONCILIATION_REQUIRED");
      if (pr.head.sha !== r.head && pr.head.sha !== r.refresh?.head) throw new Error("GITHUB_HEAD_CHANGED");
      if (!r.refresh) {
        const base = await this.head(this.target.base);
        // GitHub may still report the old base on an open PR until its head is updated.
        if (!base) throw new Error("GITHUB_BASE_MOVED");
        if (base === r.base) return;
        if ((await this.get("compare/" + r.base + "..." + base)).merge_base_commit?.sha !== r.base) throw new Error("GITHUB_BASE_MOVED");
        // Reapply only the approved manifest to the latest base. Both tips become parents.
        const head = await this.candidate(entry, files, at, base, [r.head, base]);
        r.refresh = { head, base }; await save();
      }
      const current = await this.head(entry.branch);
      if (current !== r.refresh.head) {
        if (current !== r.head || action !== "refresh-base") throw new Error("GITHUB_RECONCILIATION_REQUIRED");
        await this.send("PATCH", "git/refs/heads/" + encoded(entry.branch), { sha: r.refresh.head, force: false });
      }
      if (await this.head(entry.branch) !== r.refresh.head) throw new Error("GITHUB_HEAD_CHANGED");
      r.head = r.refresh.head; r.base = r.refresh.base; delete r.refresh; delete r.gate;
      r.phase = "awaiting-checks"; await save(); return;
    }
    if (pr.head.sha !== r.head) throw new Error("GITHUB_HEAD_CHANGED");
    if (!pr.merged) {
      if (pr.state !== "open") throw new Error("GITHUB_PR_CLOSED");
      r.phase = "awaiting-review"; await save();
      if (action !== "merge" && !ownerMerge) return;
      const protect = await this.get("branches/" + encodeURIComponent(this.target.base) + "/protection");
      const contexts: string[] = protect.required_status_checks?.contexts ?? [];
      const reviewRule = protect.required_pull_request_reviews;
      const reviewPolicyValid = ownerMerge ? reviewRule?.required_approving_review_count === 0 :
        reviewRule?.dismiss_stale_reviews && reviewRule.required_approving_review_count >= 1;
      if (!protect.enforce_admins?.enabled || !protect.required_status_checks?.strict || !reviewPolicyValid) throw new Error("GITHUB_PROTECTION_REQUIRED");
      // A completed local run may have published its PR before any CI was configured.
      // Pin the actual protected contexts on its first explicit merge request.
      if (!requireBase && !this.target.checks.length && !r.protectedChecks && contexts.length) {
        r.protectedChecks = [...contexts]; await save();
      }
      const required = this.target.checks.length ? this.target.checks : r.protectedChecks ?? [];
      if (!required.length) throw new Error("GITHUB_CHECKS_REQUIRED");
      if (required.some(c => !contexts.includes(c))) throw new Error("GITHUB_PROTECTION_REQUIRED");
      const actor = await this.api.call("GET", "user");
      if (!Number.isSafeInteger(actor.id)) throw new Error("GITHUB_REVIEW_REQUIRED");
      if (ownerMerge && (repository.owner?.type !== "User" || repository.owner.id !== actor.id || pr.user.id !== actor.id))
        throw new Error("GITHUB_REVIEW_REQUIRED");
      const reviews = await this.list("pulls/" + r.pr + "/reviews?per_page=100");
      const votes = new Map<string, string>();
      for (const v of reviews) if (v.user?.id !== pr.user.id && v.user?.id !== actor.id && v.user?.type === "User" && ["MEMBER", "OWNER", "COLLABORATOR"].includes(v.author_association) && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(v.state))
        votes.set(v.user.login, v.commit_id === r.head ? v.state : "STALE");
      if ((!ownerMerge && ![...votes.values()].includes("APPROVED")) || [...votes.values()].includes("CHANGES_REQUESTED")) throw new Error("GITHUB_REVIEW_REQUIRED");
      const checks = await this.get("commits/" + r.head + "/check-runs?per_page=100");
      if (checks.total_count !== checks.check_runs.length || required.some(n => {
        const source = protect.required_status_checks.checks?.find((c: any) => c.context === n)?.app_id;
        const matches = checks.check_runs.filter((c: any) => c.name === n && (!(source > 0) || c.app?.id === source));
        return matches.length !== 1 || matches[0].head_sha !== r.head || matches[0].status !== "completed" || matches[0].conclusion !== "success";
      })) throw new Error("GITHUB_CHECKS_REQUIRED");
      if (pr.base.sha !== r.base || await this.head(this.target.base) !== r.base || await this.head(entry.branch) !== r.head) throw new Error("GITHUB_BASE_MOVED");
      r.gate = { mode: ownerMerge ? "owner" : "independent", actor: actor.id, reviewers: [...votes].filter(([, vote]) => vote === "APPROVED").map(([login]) => login), head: r.head, base: r.base, checks: [...required], at: new Date().toISOString() };
      await intent("merge", () => this.send("PUT", "pulls/" + r.pr + "/merge", { sha: r.head, merge_method: "merge" }));
    }
    const merged = await this.get("pulls/" + r.pr);
    if (!merged.merged || !merged.merge_commit_sha) throw new Error("GITHUB_MERGE_UNCONFIRMED");
    const verified = await this.get("git/commits/" + merged.merge_commit_sha);
    if (verified.parents.length !== 2 || verified.parents[0].sha !== r.base || verified.parents[1].sha !== r.head ||
      verified.tree.sha !== (await this.get("git/commits/" + r.head)).tree.sha) throw new Error("GITHUB_MERGE_UNCONFIRMED");
    const tip = await this.head(this.target.base);
    if (tip !== verified.sha) {
      if (!tip || (await this.get("compare/" + verified.sha + "..." + tip)).merge_base_commit?.sha !== verified.sha)
        throw new Error("GITHUB_MERGE_UNCONFIRMED");
    }
    // Independently observed merges still require review/check proof before advancing a run.
    if (r.pending !== "merge" && !r.merge) throw new Error("GITHUB_EXTERNAL_MERGE");
    if (!r.gate || r.gate.head !== r.head || r.gate.base !== r.base || merged.merged_by?.id !== r.gate.actor) throw new Error("GITHUB_MERGE_UNCONFIRMED");
    r.merge = verified.sha; if (r.pending === "merge") r.pending = null; await save();
    if (issue.state !== "closed" && action === "observe") { r.phase = "awaiting-issue-close"; await save(); return; }
    if (issue.state !== "closed") await intent("close-issue", () => this.send("PATCH", "issues/" + r.issue, { state: "closed" }));
    const closed = await this.get("issues/" + r.issue);
    if (closed.state !== "closed" || lf(closed.body) !== lf(body())) throw new Error("GITHUB_CLOSE_UNCONFIRMED");
    r.phase = "merged"; r.pending = null; await save();
  }
}
