import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { atomic, bytes, digest, immutable } from "../storage/project-files";
import type { InputSnapshot } from "../../application/desktop/snapshots";
import type { ProductionInput } from "../../../shared/contracts/desktop-production";
const execute = promisify(execFile);
export const planSections = ["목표", "범위", "작업 순서", "산출물", "검증", "검토", "실패 복구"];
export function validateGeneratedPlan(content: string) {
  if (content.length > 100000 || content.length < 80 || planSections.some(section => !content.includes("## " + section))) throw new Error("PLAN_TEMPLATE_INCOMPLETE");
}
export interface PlanGenerator { generate(directory: string, input: ProductionInput, snapshot: InputSnapshot, token: string, includeInputs?: boolean): Promise<string>; }
export class CodexPlanGenerator implements PlanGenerator {
  async generate(directory: string, input: ProductionInput, snapshot: InputSnapshot, token: string, includeInputs=false) {
    await mkdir(directory, { recursive: true });
    const source = join(directory, "input"); await mkdir(source, { recursive: true });
    for (const file of snapshot.files) if (file.base64 !== null) await immutable(source, file.path, Buffer.from(file.base64, "base64"));
    // A staging directory can be nested in Orchiva's own checkout. Keep its
    // repository instructions scoped to this project's materialized input.
    await execute("git",["-C",source,"init","--quiet"],{windowsHide:true});
    // Public CLI exposes read-only planning; Paseo 0.15.4 modes do not.
    const paths = (await execute("where.exe", ["codex"], { windowsHide: true, timeout: 10000 })).stdout.split(/\r?\n/);
    const executable = paths.find(path => isAbsolute(path) && path.toLowerCase().endsWith(".exe"));
    if (!executable) throw new Error("CODEX_EXECUTABLE_REQUIRED");
    let budget=160*1024;
    const excerpts=includeInputs ? snapshot.files.flatMap(f=>{
      if (f.base64===null) return [];
      const data=Buffer.from(f.base64,"base64"), content=data.toString("utf8");
      if (data.length>budget || data.includes(0) || !data.equals(Buffer.from(content))) return [];
      budget-=data.length;
      return [{path:f.path,hash:f.hash,content}];
    }) : [];
    const output = join(directory, "answer.md"), prompt = `현재는 계획 작성 단계입니다. 구현·파일 쓰기·네트워크·하위 에이전트 생성은 금지합니다. 현재 snapshot 내부 파일을 읽는 로컬 도구만 허용합니다. 현재 폴더는 승인된 입력 snapshot 사본입니다. 프로젝트 지침을 읽고 요청을 분석하여 구체적인 한국어 PLAN 원문만 답변하세요. 파일 이름은 프로젝트 지침에 따라 제안하고 요청하지 않은 README·지침서를 산출물에 추가하지 마세요. 다음 절을 모두 사용하세요: ${planSections.map(x => "## " + x).join(", ")}. 검증 명령은 제안만 하며 지금 실행하지 마세요. PLAN 본문은 사용자가 확인한 뒤 제작 에이전트가 수행할 지침입니다. 현재 계획 작성 단계에만 해당하는 구현 금지·도구 금지·이번 응답은 계획만 작성 같은 메타 지시를 PLAN 본문에 넣지 마세요. 제작 단계의 로컬 편집·검증을 금지하지 마세요.\n${input.media ? `미디어 산출물 경로: media/${token}/ (shape.png 또는 tone.wav 또는 effect.png·effect.json). 이 경로를 정확히 쓰세요.` : ""}\n미디어 범위: ${input.media ? "임시 로컬 절차적 생성기 orchiva-procedural-v1이 사용자가 확인한 PLAN 실행 직후 규격대로 파일을 만듭니다. art=shape.png 도형, sound=tone.wav 합성 단음, effect=effect.png 확산 링 가로 시트와 effect.json입니다. 제작 Agent는 생성 파일을 변경하지 않고 검사·보고만 합니다. 자유 문장에 화풍·음악·Unity 파티클 등 미지원 요구가 있으면 한계를 명시하세요. 별도 코드·README·생성기를 작성하지 마세요. 이미지 PNG RGBA8, WAV PCM16만 지원합니다." : "해당 없음"}\n${excerpts.length ? "고정 입력 원문 (검토 자료): "+JSON.stringify(excerpts) : ""}\n입력: ${JSON.stringify(input)}\n기준 SHA: ${snapshot.baseCommit}\n이전 결과 맥락: ${snapshot.parentContext ?? "새 요청"}\n`;
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", source, "--model", input.provider.slice("codex/".length), "--output-last-message", output];
    if (input.thinkingOptionId) args.push("-c", `model_reasoning_effort=${JSON.stringify(input.thinkingOptionId)}`);
    args.push("-");
    await atomic(join(directory, "intent.json"), JSON.stringify({ promptHash: digest(prompt), inputHash: snapshot.inputHash, startedAt: new Date().toISOString() }));
    try {
      await new Promise<void>((ok, fail) => {
        const child = execFile(executable, args, { cwd: source, windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 }, error => error ? fail(new Error("PLAN_PROVIDER_FAILED")) : ok());
        void atomic(join(directory, "process.json"), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), output })).then(() => child.stdin?.end(prompt), () => { child.kill(); fail(new Error("PLAN_CHECKPOINT_FAILED")); });
      });
      const content = (await bytes(directory, "answer.md"))?.toString("utf8") ?? "";
      validateGeneratedPlan(content);
      for (const file of snapshot.files) { const actual = await bytes(source, file.path); if ((actual ? digest(actual) : null) !== file.hash) throw new Error("PLANNING_INPUT_CHANGED"); }
      await atomic(join(directory, "completion.json"), JSON.stringify({ hash: digest(content), succeeded: true, at: new Date().toISOString() }));
      return content;
    } catch (error) { await atomic(join(directory, "failure.json"), JSON.stringify({ code: error instanceof Error ? error.message : "PLAN_FAILED", at: new Date().toISOString() })); throw error; }
  }
}
