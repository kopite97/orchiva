import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { inspectRpc, revalidateRpc, resumeRpc, reviewRpc, type RequestRecord, type ExecutionResult, criterionReviewSchema } from "../../shared/contracts/feature-request";
import type { z } from "zod";

export const labels: Record<RequestRecord["status"], string> = {
  draft: "초안", ready: "계획 확인 대기", planned: "실행 접수됨", "creating-worktree": "Worktree 생성 중", "writing-plan": "계획 기록 중", "starting-session": "세션 생성 중",
  started: "실행 상태 확인 중", running: "실행 중", "needs-input": "사용자 확인 필요", validating: "검증 중", "awaiting-review": "완료 조건 검토 대기", completed: "완료", failed: "실패",
};
type Props = Pick<PluginScreenProps, "host" | "theme" | "navigation"> & { record: RequestRecord; actions?: string[]; onChanged: () => Promise<unknown>; selectedResultId?: string | null };
export function RequestResult(props: Props) {
  const result = props.selectedResultId ? props.record.results.find(x => x.id === props.selectedResultId) : props.record.result;
  if (!result) return <MissingResult {...props} />;
  return <ResultPanel key={result.id} {...props} result={result} />;
}
function MissingResult({ record, theme, onChanged, actions }: Props) {
  const [instruction, setInstruction] = useState("");
  const resume = useRpc(resumeRpc);
  const action = useMutation({ mutationFn: () => resume({ token: record.token, key: `resume-${globalThis.crypto.randomUUID()}`, expectedRevision: record.revision, instruction }), onSettled: onChanged });
  return <View style={{ gap: 12 }}><Text style={{ color: theme.colors.foreground }}>{record.error ?? "아직 수집된 결과가 없습니다. 진행 탭에서 상태를 확인하세요."}</Text>{record.status === "failed" && actions?.includes("resume") && <><TextInput accessibilityLabel="같은 작업 재개 지시" value={instruction} onChangeText={setInstruction} multiline style={{ color: theme.colors.foreground, padding: 12, borderWidth: 1, borderColor: theme.colors.border }} /><Pressable accessibilityRole="button" disabled={!instruction.trim() || action.isPending} onPress={() => action.mutate()}><Text style={{ color: theme.colors.foreground }}>같은 작업에서 재개</Text></Pressable></>}{action.error && <Text style={{ color: theme.colors.foreground }}>{action.error.message}</Text>}</View>;
}
function reviewError(message: string) {
  if (message.includes("STALE_RESULT")) return "결과 또는 파일이 변경되었습니다. 최신 결과를 선택하고 검증을 다시 실행하세요.";
  if (message.includes("REVISION_CONFLICT")) return "다른 화면에서 작업이 갱신되었습니다. 입력을 확인한 뒤 다시 시도하세요.";
  if (message.includes("REVIEW_REQUIRED")) return "모든 조건의 판정과 근거를 입력하세요. 수동 확인 내용은 10자 이상 필요합니다.";
  if (message.includes("TEST_CHANGE_REQUIRED")) return "검사 파일 변경 확인과 구체적인 사유가 필요합니다.";
  if (message.includes("execution changed")) return "세션 상태가 바뀌었습니다. 진행 탭에서 상태를 확인하세요.";
  return message;
}
function ResultPanel({ record, theme, onChanged, actions, result }: Props & { result: ExecutionResult }) {
  const color = theme.colors.foreground, text = { color }, muted = { color: theme.colors.foregroundMuted };
  const latest = result.id === record.result?.id;
  const editable = latest && record.status === "awaiting-review" && (!actions || actions.includes("review"));
  const [reviews, setReviews] = useState<z.infer<typeof criterionReviewSchema>[]>(() => record.criteria.map(c => ({ criterionId: c.id, satisfied: false, evidenceRefs: [], note: "" })));
  const [note, setNote] = useState(record.decision?.approved === false ? record.decision.note : ""), [ack, setAck] = useState(false), [changeNote, setChangeNote] = useState("");
  const review = useRpc(reviewRpc), revalidate = useRpc(revalidateRpc), resume = useRpc(resumeRpc), inspect = useRpc(inspectRpc);
  const comparison = useMutation({ mutationFn: () => inspect({ token: record.token, resultId: result.id }) });
  const command = useRef({ signature: "", key: "" });
  const action = useMutation({ mutationFn: async (kind: "approve" | "reject" | "revalidate" | "resume") => {
    const signature = JSON.stringify({ kind, resultId: result.id, revision: record.revision, reviews, note, ack, changeNote });
    if (command.current.signature !== signature) command.current = { signature, key: `m4-${globalThis.crypto.randomUUID()}` };
    const commandKey = command.current.key;
    if (kind === "revalidate") return revalidate({ token: record.token, resultId: result.id, expectedRevision: record.revision, commandKey });
    if (kind === "resume") return resume({ token: record.token, key: commandKey, instruction: note, expectedRevision: record.revision });
    return review({ token: record.token, resultId: result.id, expectedRevision: record.revision, commandKey, approved: kind === "approve", note, criteriaReviews: reviews, testChangesAcknowledged: ack, testChangeNote: changeNote });
  }, onSettled: onChanged });
  const update = (id: string, patch: Partial<z.infer<typeof criterionReviewSchema>>) => setReviews(old => old.map(x => x.criterionId === id ? { ...x, ...patch } : x));
  const button = (label: string, press: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || action.isPending }} disabled={disabled || action.isPending} onPress={press} style={{ padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface2, opacity: disabled || action.isPending ? .5 : 1 }}><Text style={text}>{label}</Text></Pressable>;
  const checkbox = (label: string, checked: boolean, press: () => void) => <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled: action.isPending }} disabled={action.isPending} onPress={press} style={{ paddingVertical: 8 }}><Text style={text}>{checked ? "☑" : "☐"} {label}</Text></Pressable>;
  const input = (label: string, value: string, onChangeText: (s: string) => void) => <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={theme.colors.foregroundMuted} value={value} onChangeText={onChangeText} editable={!action.isPending} multiline style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12, minHeight: 70 }} />;
  const grounded = reviews.length > 0 && reviews.every(x => (x.evidenceRefs.length > 0 || x.note.trim().length >= 10) && (result.checks.length > 0 || x.note.trim().length >= 10));
  const canApprove = grounded && reviews.every(x => x.satisfied) && !!note.trim() && !result.failure && !result.executionFailure && result.checks.every(x => x.passed && (!x.status || x.status === "passed")) && (!result.testChanges?.length || (ack && changeNote.trim().length >= 10));
  const decisions = record.decisions.filter(x => x.resultId === result.id);
  const version = record.results.find(x => x.id === result.id);
  return <View style={{ gap: 16, padding: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12 }}>
    <Text style={{ color, fontSize: 18, fontWeight: "700" }}>{latest ? "최신 결과" : "과거 결과 · 읽기 전용"} · 시도 {version?.attemptNumber ?? record.attempt} · 검증 {version?.validationRun ?? 1}</Text>
    <Text selectable style={muted}>{result.collectedAt}{"\n"}{result.id}</Text>
    {result.failure && <Text style={text}>검증 실패: {result.failure}</Text>}
    {action.error && <Text accessibilityRole="alert" style={text}>{reviewError(action.error.message)}</Text>}
    <Text style={{ color, fontSize: 17, fontWeight: "600" }}>완료 조건</Text>
    {record.criteria.map(c => {
      const draft = reviews.find(x => x.criterionId === c.id)!;
      const verdict = decisions.at(-1)?.criteriaReviews?.find(x => x.criterionId === c.id);
      return <View key={c.id} style={{ gap: 8, padding: 12, backgroundColor: theme.colors.surface1 }}>
        <Text style={{ color, fontWeight: "600" }}>{c.text}</Text>
        {!!c.manualMethod && <Text style={muted}>확인 방법: {c.manualMethod}</Text>}
        {!!c.checkIds.length && <Text style={muted}>계획에 연결한 검사: {c.checkIds.map(id => record.checks.find(x => x.id === id)?.label ?? id).join(", ")}</Text>}
        {editable ? <>
          {checkbox(`조건 충족: ${c.text}`, draft.satisfied, () => update(c.id, { satisfied: !draft.satisfied }))}
          <Text style={muted}>근거를 선택하거나 수동 확인 내용을 10자 이상 입력하세요. 자동 검사 0건이면 수동 근거가 필요합니다.</Text>
          {result.checks.filter(x => x.checkId).map(x => {
            const checked = draft.evidenceRefs.some(r => r.kind === "check" && r.id === x.checkId);
            return <View key={x.checkId}>{checkbox(`${c.id} 검사 근거: ${x.label}`, checked, () => update(c.id, { evidenceRefs: checked ? draft.evidenceRefs.filter(r => !(r.kind === "check" && r.id === x.checkId)) : [...draft.evidenceRefs, { kind: "check", id: x.checkId! }] }))}</View>;
          })}
          {result.files?.map(x => {
            const checked = draft.evidenceRefs.some(r => r.kind === "file" && r.id === x.path);
            return <View key={x.path}>{checkbox(`${c.id} 파일 근거: ${x.path}`, checked, () => update(c.id, { evidenceRefs: checked ? draft.evidenceRefs.filter(r => !(r.kind === "file" && r.id === x.path)) : [...draft.evidenceRefs, { kind: "file", id: x.path }] }))}</View>;
          })}
          {input(`${c.id} 수동 확인 근거`, draft.note, value => update(c.id, { note: value }))}
        </> : <Text selectable style={text}>{verdict ? `${verdict.satisfied ? "충족" : "미충족"} · ${verdict.evidenceRefs.map(x => `${x.kind}: ${x.id}`).join(", ")}\n${verdict.note}` : "조건별 판정 기록 없음"}</Text>}
      </View>;
    })}
    <Text style={{ color, fontSize: 17, fontWeight: "600" }}>자동 검사 · 파일 단위 {result.checks.filter(x => x.passed).length}/{result.checks.length} 통과</Text>
    {!result.checks.length && <Text style={text}>등록된 자동 검사 없음 · 조건마다 수동 확인이 필요합니다.</Text>}
    {result.checks.map((x, i) => <Text key={i} style={text}>{({ passed: "통과", failed: "실패", error: "검증기 오류", skipped: "미실행" })[x.status ?? (x.passed ? "passed" : "failed")]} · {x.label} · {x.failureKind ?? "정상"}</Text>)}
    {!!result.testChanges?.length && <View style={{ gap: 8 }}><Text style={{ color, fontWeight: "700" }}>검사 파일이 변경되었습니다</Text>{result.testChanges.map(x => <Text key={x.checkId} selectable style={text}>{x.path}{"\n"}최초 {x.before ?? "없음"}{"\n"}현재 {x.after ?? "없음"}</Text>)}{editable && <>{checkbox("검사 파일 변경을 확인했습니다", ack, () => setAck(!ack))}{input("검사 변경 확인 사유 (10자 이상)", changeNote, setChangeNote)}</>}</View>}
    <Text style={{ color, fontSize: 17, fontWeight: "600" }}>변경 파일 {result.changedFiles.length}개 · 검사 입력 포함 근거</Text>
    {result.files ? result.files.map(x => <View key={x.path} style={{ gap: 4 }}><Text selectable style={text}>{x.path} · {x.deleted ? "삭제" : x.changeType === "untracked" ? "미추적" : x.changeType === "check-input" ? "검사 입력" : "변경"}{x.isCheckInput ? " · 검사 대상" : ""} · {x.size} bytes</Text><Text selectable style={muted}>{x.sha256 ?? "파일 없음"}</Text></View>) : <Text selectable style={text}>{result.changedFiles.join("\n")} {"\n"}기존 결과: 파일 해시·검사 입력 정보 미수집</Text>}
    {!!result.diffStat && <Text selectable style={text}>{result.diffStat}</Text>}
    {result.truncation?.diffStat && <Text style={text}>diff 요약이 잘렸습니다.</Text>}
    <Text style={{ color, fontSize: 17, fontWeight: "600" }}>최종 응답</Text>
    <Text selectable style={text}>{result.finalResponse || "최종 응답 없음"}</Text>
    {result.truncation?.finalResponse && <Text style={text}>최종 응답 앞부분이 잘렸습니다.</Text>}
    <Text style={{ color, fontSize: 17, fontWeight: "600" }}>상세 로그 · 파일 내부 테스트 개수는 로그에서 확인</Text>
    {result.checks.map((x, i) => <View key={i} style={{ gap: 6, padding: 12, backgroundColor: theme.colors.surface1 }}><Text selectable style={text}>{x.label} · 종료 코드 {x.exitCode ?? "없음"} · {x.durationMs}ms{"\n"}{x.command}{"\n"}{x.output}</Text>{x.truncated && <Text style={text}>출력 앞부분이 잘렸습니다 (마지막 16,000자).</Text>}</View>)}
    {decisions.map(d => <View key={d.id} style={{ gap: 8 }}><Text selectable style={text}>{d.approved ? "완료 확정" : "수정 요청"} · {d.at}{"\n"}{d.note}</Text>{d.testChangesAcknowledged && <Text style={text}>검사 변경 확인: {d.testChangeNote}</Text>}{!d.criteriaReviews && <Text style={muted}>기존 판정: 조건별 근거 미수집</Text>}</View>)}
    {editable && <View style={{ gap: 10 }}>{input("최종 판정 메모", note, setNote)}{!canApprove && <Text style={muted}>모든 조건 충족·조건별 근거·최종 메모가 있어야 완료할 수 있습니다. 검사 변경 시 확인과 10자 이상의 사유도 필요합니다.</Text>}<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{button("완료 확정", () => action.mutate("approve"), !canApprove)}{button("수정 요청", () => action.mutate("reject"), !grounded || !note.trim())}</View></View>}
    {latest && record.status === "failed" && actions?.includes("resume") && <View style={{ gap: 8 }}>{input("같은 작업 재개 지시", note, setNote)}{button("같은 작업에서 재개", () => action.mutate("resume"), !note.trim())}</View>}
    {latest && actions?.includes("revalidate") && button("검증 다시 실행", () => action.mutate("revalidate"))}
    {button("현재 파일과 비교", () => comparison.mutate(), comparison.isPending)}
    {comparison.error && <Text accessibilityRole="alert" style={text}>{comparison.error.message}</Text>}
    {comparison.data && <Text style={text}>{comparison.data.matches ? "현재 파일이 선택한 결과와 일치합니다." : "현재 파일이 선택한 결과와 다릅니다. 저장된 결과와 판정은 유지됩니다."}{"\n"}비교 시각: {comparison.data.inspectedAt}</Text>}
  </View>;
}
