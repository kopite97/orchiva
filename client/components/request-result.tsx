import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { refreshRpc, resumeRpc, reviewRpc, startRpc, type RequestRecord } from "../../shared/contracts/feature-request";

const labels: Record<RequestRecord["status"], string> = {
  planned: "계획 생성됨", "creating-worktree": "Worktree 생성 중", "writing-plan": "계획 기록 중", "starting-session": "세션 생성 중",
  started: "실행 상태 확인 중", running: "실행 중", "needs-input": "사용자 확인 필요", validating: "검증 중",
  "awaiting-review": "완료 조건 검토 대기", completed: "완료", failed: "실패",
};
export function RequestResult({ record, host, theme, navigation, onChanged }: Pick<PluginScreenProps, "host" | "theme" | "navigation"> & { record: RequestRecord; onChanged: () => Promise<unknown> }) {
  const [expanded, setExpanded] = useState(false), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [record.result?.id]);
  const refresh = useRpc(refreshRpc), resume = useRpc(resumeRpc), review = useRpc(reviewRpc), start = useRpc(startRpc);
  const action = useMutation({ mutationFn: async (kind: "refresh" | "resume" | "approve" | "reject" | "start") => {
    if (kind === "refresh") return refresh({ token: record.token, revalidate: true });
    if (kind === "start") return start({ token: record.token, feature: record.feature, checks: record.checks });
    if (kind === "resume") return resume({ token: record.token, key: `resume-${record.attempt}-${record.token}`.slice(0, 80), instruction: note });
    if (!record.result) throw new Error("검증 결과가 없습니다.");
    return review({ token: record.token, resultId: record.result.id, approved: kind === "approve", note });
  }, onSuccess: () => { setNote(""); setConfirmed(false); }, onSettled: onChanged });
  const color = theme.colors.foreground;
  const text = { color };
  const button = (label: string, kind: Parameters<typeof action.mutate>[0], disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={`${record.feature.title}: ${label}`} disabled={disabled || action.isPending} onPress={() => action.mutate(kind)} style={{ padding: 10, borderRadius: 6, backgroundColor: theme.colors.surface2, opacity: disabled || action.isPending ? 0.5 : 1 }}><Text style={text}>{label}</Text></Pressable>;
  return <View style={{ padding: 20, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, gap: 12 }}>
    <Text style={{ color, fontSize: 18, fontWeight: "600" }}>{record.feature.title}</Text>
    <Text style={{ color, fontWeight: "600" }}>{labels[record.status]} · 시도 {record.attempt}</Text>
    <Text selectable style={{ color: theme.colors.foregroundMuted }}>{record.id}</Text>
    {record.error && <Text selectable style={text}>실패 원인: {record.error}</Text>}
    {record.observationError && <Text selectable style={text}>상태 확인 오류: {record.observationError}</Text>}
    {action.error && <Text accessibilityRole="alert" style={text}>{action.error.message}</Text>}
    {record.result && <Text style={text}>자동 검증: {record.result.checks.length ? `${record.result.checks.filter(c => c.passed).length}/${record.result.checks.length} 통과` : "등록된 검증 없음 · 수동 확인 필요"} · 변경 파일 {record.result.changedFiles.length}개</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {record.agentId && navigation && <Pressable accessibilityRole="button" onPress={() => navigation.openAgent({ agentId: record.agentId!, serverId: host.id })} style={{ padding: 10, backgroundColor: theme.colors.accent, borderRadius: 6 }}><Text style={{ color: theme.colors.accentForeground }}>Codex 세션 열기</Text></Pressable>}
      {button("상태·결과 새로고침", "refresh")}
      <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={{ padding: 10 }}><Text style={text}>{expanded ? "결과 접기" : "결과·검증 근거 보기"}</Text></Pressable>
    </View>
    {expanded && <View style={{ gap: 12 }}>
      <Text selectable style={text}>Worktree: {record.worktreePath ?? "미생성"}</Text>
      <Text selectable style={text}>Validation: {record.feature.validation}</Text>
      <Text selectable style={text}>Completion Criteria: {record.feature.completionCriteria}</Text>
      <Text selectable style={text}>Codex 최종 응답: {record.result?.finalResponse || "아직 수집되지 않았습니다."}</Text>
      {record.result?.checks.map((check, i) => <View key={i} style={{ padding: 12, backgroundColor: theme.colors.surface1, gap: 6 }}>
        <Text style={text}>{check.passed ? "통과" : "실패"} · {check.label} · 종료 코드 {check.exitCode ?? "없음"}</Text>
        <Text selectable style={text}>{check.command}{"\n"}{check.output}</Text>
      </View>)}
      <Text selectable style={text}>변경 파일:{"\n"}{record.result?.changedFiles.join("\n") || "없음"}</Text>
      {!!record.result?.diffStat && <Text selectable style={text}>{record.result.diffStat}</Text>}
      {record.attempts.map(previous => <Text selectable key={previous.attempt} style={text}>이전 시도 {previous.attempt}: {previous.error ?? "검토 후 재개"}{"\n"}{previous.result?.checks.map(check => `${check.label}: ${check.passed ? "통과" : "실패"}\n${check.output}`).join("\n")}</Text>)}
      <Text selectable style={text}>{record.events.slice(-8).map(event => `${event.at} · ${labels[event.status]} · ${event.detail}`).join("\n")}</Text>
    </View>}
    {record.decision && <Text selectable style={text}>판정: {record.decision.approved ? "완료 확정" : "수정 요청"} · {record.decision.note}</Text>}
    {record.status === "needs-input" && <Text style={text}>Paseo 세션에서 질문이나 승인 요청을 확인하세요. 전송 상태가 불확실한 경우 새로고침으로 확인할 수 있습니다.</Text>}
    {record.status === "awaiting-review" && <View style={{ gap: 10 }}>
      <Text style={text}>Validation: {record.feature.validation}{"\n"}Completion Criteria: {record.feature.completionCriteria}</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} onPress={() => setConfirmed(!confirmed)}><Text style={text}>{confirmed ? "☑" : "☐"} 검증 근거를 확인했고 위 완료 조건을 충족합니다.</Text></Pressable>
      <TextInput accessibilityLabel={`${record.feature.title}: 판정 근거`} value={note} onChangeText={setNote} placeholder="완료 조건별 확인 근거 또는 수정할 내용" multiline style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12, minHeight: 64 }} />
      <View style={{ flexDirection: "row", gap: 8 }}>{button("완료 확정", "approve", !confirmed || !note.trim())}{button("수정 요청", "reject", !note.trim())}</View>
    </View>}
    {record.status === "failed" && (record.agentId ? <View style={{ gap: 8 }}>
      <TextInput accessibilityLabel={`${record.feature.title}: 재개 지시`} value={note} onChangeText={setNote} placeholder="실패 원인을 해결하기 위한 지시" multiline style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12, minHeight: 64 }} />
      {button("기존 Worktree에서 재개", "resume", !note.trim())}
    </View> : button("초기 실행 다시 시도", "start"))}
  </View>;
}
