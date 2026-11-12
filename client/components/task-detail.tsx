import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { refreshRpc, type RequestRecord, actionSchema } from "../../shared/contracts/feature-request";
import type { z } from "zod";
import { RequestResult, labels } from "./request-result";

export function TaskDetail(props: PluginScreenProps & { record: RequestRecord; actions: z.infer<typeof actionSchema>[]; onChanged(): Promise<unknown> }) {
  const { record, theme, actions } = props, color = theme.colors.foreground;
  const [tab, setTab] = useState("progress"), [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const refresh = useRpc(refreshRpc);
  const button = (label: string, action: () => void, selected = false, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled: disabled || busy }} disabled={disabled || busy} onPress={action} style={{ padding: 12, borderRadius: 8, backgroundColor: selected ? theme.colors.accent : theme.colors.surface2, opacity: disabled || busy ? .5 : 1 }}><Text style={{ color: selected ? theme.colors.accentForeground : color }}>{label}</Text></Pressable>;
  const start = record.commands.find(x => x.kind === "start")?.createdAt ?? record.createdAt;
  const pending = record.commands.some(x => ["pending", "unknown"].includes(x.status));
  const reason = pending && record.status === "needs-input" ? "전달 확인 필요 · 자동 재전송 중지" : labels[record.status];
  const observation = record.observation;
  const delayed = !!observation?.lastSuccessAt && Date.now() - Date.parse(observation.lastSuccessAt) > 15000 && ["running", "started", "needs-input", "validating"].includes(record.status);
  return <View style={{ gap: 16 }}>
    <Text style={{ color, fontSize: 22, fontWeight: "700" }}>{record.feature.title}</Text>
    <Text style={{ color }}>{reason} · 시도 {record.attempt}</Text>
    <Text style={{ color }}>접수 {new Date(start).toLocaleString()} · {Math.max(0, Math.floor(((record.result ? Date.parse(record.result.collectedAt) : Date.now()) - Date.parse(start)) / 1000))}초 경과</Text>
    <Text style={{ color }}>마지막 관측: {observation?.lastSuccessAt ? new Date(observation.lastSuccessAt).toLocaleString() : "아직 관측 기록 없음"}{delayed ? " · 상태 확인 지연" : ""}</Text>
    {observation?.error && <Text accessibilityRole="alert" style={{ color }}>관측 오류 · 마지막 확정 상태를 유지합니다. {observation.error}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color }}>{error}</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {actions.includes("open-session") && button("Codex 세션 열기", () => props.navigation?.openAgent({ agentId: record.agentId!, serverId: props.host.id }))}
      {actions.includes("observe") && button("상태 확인", () => { setBusy(true); setError(""); void refresh({ token: record.token, revalidate: false }).then(props.onChanged).catch(() => setError("상태를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.")).finally(() => setBusy(false)); })}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{button("진행", () => setTab("progress"), tab === "progress")}{button("결과", () => setTab("result"), tab === "result")}{button("이력", () => setTab("history"), tab === "history")}</View>
    <View style={{ display: tab === "progress" ? "flex" : "none", gap: 12 }}>
      <Text style={{ color }}>{record.status === "awaiting-review" ? "결과 탭에서 검사와 완료 조건을 검토하세요." : record.status === "needs-input" ? "Codex 세션과 전달 상태를 확인하세요." : record.status === "failed" ? "결과 탭에서 실패 원인과 근거를 확인하세요." : record.status === "completed" ? "저장된 완료 판정과 결과를 확인할 수 있습니다." : "화면을 닫아도 daemon이 실행 상태를 확인합니다."}</Text>
      {record.error && <Text selectable style={{ color }}>확인할 내용: {record.error}</Text>}
      {record.commands.filter(x => x.kind === "start").map(x => <Text key={x.key} style={{ color }}>준비 단계: {({ accepted: "실행 접수", workspace: "Worktree 생성", plans: "PLAN 기록", agent: "세션 생성", done: "준비 완료" } as Record<string, string>)[x.phase] ?? x.phase} · {x.status === "unknown" ? "전달 결과 미확정" : x.status === "applied" ? "완료" : x.status === "failed" ? "실패" : "진행 중"}</Text>)}
      {record.events.slice(-8).map((event, i) => <Text key={i} style={{ color }}>{new Date(event.at).toLocaleTimeString()} · {labels[event.status]} · {event.detail}</Text>)}
      {button(expanded ? "작업 정보 접기" : "작업 정보 펼치기", () => setExpanded(!expanded))}
      {expanded && <View style={{ gap: 12 }}><Text selectable style={{ color }}>Worktree: {record.worktreePath ?? "미생성"}{"\n"}세션: {record.agentId ?? "미생성"}{"\n"}기준 커밋: {record.plans.find(x => x.revision === record.confirmedPlanRevision)?.baseCommit ?? "기존 실행"}</Text>{[record.requestPlan, record.taskPlan].map(x => <Text key={x.id} selectable style={{ color }}>{x.content}</Text>)}</View>}
    </View>
    <View style={{ display: tab === "result" ? "flex" : "none" }}><RequestResult {...props} /></View>
    <View style={{ display: tab === "history" ? "flex" : "none", gap: 12 }}>
      <Text style={{ color }}>시도 {record.attemptHistory.length}건 · 검증 결과 {record.results.length}건 · 판정 {record.decisions.length}건</Text>
      {record.attemptHistory.map(x => <View key={x.number} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.colors.border }}><Text style={{ color }}>시도 {x.number} · {x.trigger === "resume" ? "수정 재개" : x.trigger === "legacy" ? "기존 실행" : "최초 실행"}</Text>{x.instruction && <Text style={{ color }}>{x.instruction}</Text>}{record.results.filter(r => r.attemptNumber === x.number).map(r => <Text key={r.id} selectable style={{ color }}>검증 {r.validationRun} · {r.failure ? "실패" : "검토 가능"} · {r.collectedAt}{"\n"}{r.id}</Text>)}</View>)}
      {record.decisions.map(x => <Text key={x.id} style={{ color }}>{x.approved ? "완료 판정" : "수정 요청"} · {x.at}{"\n"}{x.note}</Text>)}
      <Text style={{ color, opacity: .7 }}>각 시도의 검증 회차와 판정 기록을 보존합니다.</Text>
    </View>
  </View>;
}
