import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { configRpc, pageRpc, detailRpc, serviceStatusRpc, startRpc, saveDraftRpc, preparePlanRpc, getRpc, preflightRpc, diagnosticsRpc, type RequestRecord } from "../../shared/contracts/feature-request";
import { DraftEditor, emptyDraft, newKey, type DraftValues } from "../components/draft-editor";
import { labels } from "../components/request-result";
import { TaskDetail } from "../components/task-detail";

function explainError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const messages: Record<string, string> = {
    INVALID_INPUT: "필수 입력과 완료 조건을 확인하세요. 각 조건에 자동 검사 또는 수동 확인 방법이 필요합니다. 검사 경로와 설명도 확인하세요.",
    PLAN_STALE: "입력, 기준 커밋 또는 프로젝트 설정이 바뀌었습니다. 계획을 다시 생성하고 확인하세요.",
    PLAN_REQUIRED: "초안을 저장하고 계획을 확인한 뒤 실행하세요.",
    REVISION_CONFLICT: "다른 화면에서 요청이 변경됐습니다. 현재 입력을 보관한 뒤 작업 목록에서 요청을 다시 여세요.",
    IDEMPOTENCY_CONFLICT: "이전 요청과 입력이 일치하지 않습니다. 작업 목록에서 저장된 요청을 다시 확인하세요.",
    BUSY: "다른 작업이 실행 중이거나 전달 확인을 기다리고 있습니다. 진행 중인 작업을 먼저 확인하세요.",
    ENVIRONMENT_NOT_READY: "실행 환경을 확인할 수 없습니다. 프로젝트 연결과 Codex 실행 경로를 확인한 뒤 계획을 다시 생성하세요.",
    INVALID_STATE: "현재 상태에서는 이 동작을 할 수 없습니다. 작업 목록에서 최신 상태를 확인하세요.",
  };
  return Object.entries(messages).find(([code]) => message.includes(code))?.[1]
    ?? "요청을 처리하지 못했습니다. 입력은 유지됩니다. 연결 상태를 확인한 뒤 같은 동작을 다시 시도하세요.";
}

export function FeatureRequestScreen(props: PluginScreenProps) {
  const { theme, layout, host } = props, color = theme.colors.foreground;
  const list = useRpc(pageRpc), readDetail = useRpc(detailRpc), status = useRpc(serviceStatusRpc), get = useRpc(getRpc), save = useRpc(saveDraftRpc), prepare = useRpc(preparePlanRpc), start = useRpc(startRpc), project = useRpc(configRpc), preflight = useRpc(preflightRpc), diagnostics = useRpc(diagnosticsRpc);
  const cache = useQueryClient(), requestKey = ["orchiva", host.id, "requests"];
  const [filter, setFilter] = useState<"all" | "draft" | "active" | "attention" | "completed">("all"), [cursor, setCursor] = useState<string | null>(null);
  const history = useQuery({ queryKey: [...requestKey, "page", filter, cursor], queryFn: () => list({ filter, cursor, limit: 20 }), refetchInterval: 2000, placeholderData: previous => previous });
  const service = useQuery({ queryKey: ["orchiva", host.id, "service"], queryFn: () => status({}), refetchInterval: 2000, retry: false });
  const config = useQuery({ queryKey: ["orchiva", host.id, "project"], queryFn: () => project({}) });
  const environment = useQuery({ queryKey: ["orchiva", host.id, "preflight"], queryFn: () => preflight({}), retry: false });
  const storage = useQuery({ queryKey: ["orchiva", host.id, "storage"], queryFn: () => diagnostics({}), refetchInterval: 3000 });
  const [screen, setScreen] = useState<"list" | "edit" | "plan" | "detail">("list");
  const [token, setToken] = useState(newKey), [record, setRecord] = useState<RequestRecord | null>(null);
  const selected = useQuery({ queryKey: [...requestKey, "detail", token], queryFn: () => readDetail({ token }), enabled: screen === "detail", refetchInterval: screen === "detail" ? 2000 : false });
  const [values, setValues] = useState<DraftValues>(emptyDraft), [baseline, setBaseline] = useState(() => JSON.stringify(emptyDraft()));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [showErrors, setShowErrors] = useState(false);
  const working = useRef(false), retry = useRef<{ signature: string; key: string } | null>(null);
  const [leaving, setLeaving] = useState<{ action: () => void } | null>(null);
  const dirty = screen === "edit" && JSON.stringify(values) !== baseline;
  const refresh = () => cache.invalidateQueries({ queryKey: requestKey });
  const keyFor = (action: string, payload: unknown) => { const signature = JSON.stringify([action, payload]); if (retry.current?.signature !== signature) retry.current = { signature, key: newKey() }; return retry.current.key; };
  const adopt = (item: RequestRecord) => { setRecord(item); setToken(item.token); const v = { feature: item.feature, criteria: item.criteria, checks: item.checks }; setValues(v); setBaseline(JSON.stringify(v)); };
  const run = async (action: () => Promise<void>) => { if (working.current) return; working.current = true; setBusy(true); setError(""); try { await action(); } catch (cause) { setError(explainError(cause)); } finally { working.current = false; setBusy(false); void refresh(); } };
  const navigate = (action: () => void) => { if (dirty) setLeaving({ action }); else action(); };
  const fresh = () => { setToken(newKey()); setRecord(null); const v = emptyDraft(); setValues(v); setBaseline(JSON.stringify(v)); retry.current = null; setError(""); setShowErrors(false); setScreen("edit"); };
  const open = (item: { token: string }) => void run(async () => { const saved = await get({ token: item.token }); if (!saved) throw Error("요청을 찾을 수 없습니다."); adopt(saved); retry.current = null; setShowErrors(false); setScreen(saved.status === "draft" ? "edit" : saved.status === "ready" ? "plan" : "detail"); if (saved.status === "ready") void environment.refetch(); });
  const saveCurrent = async () => {
    if (record && JSON.stringify(values) === baseline) return record;
    const payload = { token, expectedRevision: record?.revision ?? 0, ...values, criteria: values.criteria.map(item => ({ ...item, legacy: false as const })) };
    const saved = await save({ ...payload, commandKey: keyFor("save", payload) }); adopt(saved); retry.current = null; return saved;
  };
  const prepareCurrent = () => void run(async () => { setShowErrors(true); const saved = screen === "edit" ? await saveCurrent() : record!; const payload = { token: saved.token, expectedRevision: saved.revision }; const ready = await prepare({ ...payload, commandKey: keyFor("prepare", payload) }); adopt(ready); retry.current = null; setScreen("plan"); void environment.refetch(); });
  const plan = record?.plans.at(-1);
  const active = storage.data?.activeTokens.filter(item => item !== record?.token) ?? [];
  const blocked = !!storage.error || !storage.data || !!storage.data.issues.length || active.length > 0 || service.data?.state !== "connected" || !!service.data?.restoring || !!service.error;
  const button = (label: string, action: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={action} style={{ padding: 12, borderRadius: 8, backgroundColor: primary ? theme.colors.accent : theme.colors.surface2, opacity: busy || disabled ? 0.45 : 1 }}><Text style={{ color: primary ? theme.colors.accentForeground : color, fontWeight: "600" }}>{label}</Text></Pressable>;
  const detail = selected.data?.record ?? record;
  const staleConnection = !!service.data?.lastSuccessAt && Date.now() - Date.parse(service.data.lastSuccessAt) > 15000;
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 32, gap: 20, maxWidth: 1100, width: "100%", alignSelf: "center" }}>
    <View style={{ gap: 8 }}><Text style={{ color, opacity: 0.7 }}>ORCHIVA · {config.data?.name ?? "프로젝트 연결 중"}</Text><Text style={{ color, fontSize: 28, fontWeight: "700" }}>{({ list: "작업 목록", edit: "요청 작성", plan: "계획 확인", detail: "작업 상세" })[screen]}</Text><Text style={{ color }}>요청 작성 → 계획 확인 → 실행 → 결과 검토</Text></View>
    <View style={{ gap: 8 }}><Text style={{ color }}>기준 브랜치: {config.data?.baseRef ?? "확인 중"} · {service.error || staleConnection ? "연결 지연 · 마지막 상태 표시" : service.data?.restoring ? "실행 상태 복원 중" : service.data?.state === "connected" ? "백그라운드 관측 연결됨" : "연결 재확인 중"}</Text>{(service.error || staleConnection || service.data?.state === "reconnecting") && button("연결 재확인", () => { void service.refetch(); void refresh(); })}</View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{screen !== "list" && button("작업 목록", () => navigate(() => setScreen("list")))}{screen !== "edit" && button("새 요청", () => navigate(fresh))}</View>
    {leaving && <View accessibilityRole="alert" style={{ padding: 14, borderWidth: 1, borderColor: theme.colors.border, gap: 10 }}><Text style={{ color }}>저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?</Text><View style={{ flexDirection: "row", gap: 8 }}>{button("계속 작성", () => setLeaving(null))}{button("입력 버리고 이동", () => { leaving.action(); setLeaving(null); })}</View></View>}
    {!!error && <Text accessibilityRole="alert" selectable style={{ color }}>{error}</Text>}
    {busy && <Text style={{ color }}>처리 중입니다. 같은 요청을 확인하고 있습니다.</Text>}
    {screen === "list" && <View style={{ gap: 12 }}>
      {history.error && <Text accessibilityRole="alert" style={{ color }}>{explainError(history.error)}</Text>}
      {history.isLoading && <Text style={{ color }}>작업을 불러오는 중입니다.</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{([["all", "전체"], ["draft", "초안"], ["active", "진행 중"], ["attention", "확인 필요"], ["completed", "완료"]] as const).map(([value, label]) => <View key={value}>{button(`필터: ${label}`, () => { setFilter(value); setCursor(null); }, false, filter === value)}</View>)}</View>
      {!!history.data?.active.length && <View style={{ padding: 14, borderWidth: 1, borderColor: theme.colors.accent, gap: 8 }}><Text style={{ color, fontWeight: "700" }}>진행 중 작업</Text>{history.data.active.map(item => <View key={item.token}>{button(`${item.title} · ${labels[item.status]} · 진행 보기`, () => open(item))}</View>)}</View>}
      {history.data?.items.length === 0 && <Text style={{ color }}>이 필터에 해당하는 요청이 없습니다. 새 요청에서 초안을 작성할 수 있습니다.</Text>}
      {button("목록 새로고침", () => void refresh())}
      {history.data?.items.map(item => <Pressable key={item.token} accessibilityRole="button" accessibilityLabel={`요청 열기: ${item.title || "제목 없는 초안"}`} disabled={busy} onPress={() => open(item)} style={{ padding: 16, gap: 7, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10 }}><Text style={{ color, fontSize: 18, fontWeight: "600" }}>{item.title || "제목 없는 초안"}</Text><Text style={{ color }}>{labels[item.status]}{["draft", "ready"].includes(item.status) ? "" : ` · 시도 ${item.attempt}`} · {new Date(item.updatedAt).toLocaleString()}</Text><Text style={{ color }}>{item.status === "draft" ? "이어서 작성" : item.status === "ready" ? "계획 확인" : item.active ? "진행 확인" : "결과 확인"}</Text></Pressable>)}
      <View style={{ flexDirection: "row", gap: 8 }}>{cursor && button("처음 페이지", () => setCursor(null))}{history.data?.nextCursor && button("다음 20건", () => setCursor(history.data!.nextCursor), history.isFetching)}</View>
    </View>}
    {screen === "edit" && <View style={{ gap: 16 }}>
      <Text style={{ color }}>{record ? `저장됨 · ${record.updatedAt}${dirty ? " · 저장하지 않은 변경 있음" : ""}` : "초안은 일부 항목만 입력해도 저장할 수 있습니다."}</Text>
      <DraftEditor value={values} onChange={setValues} theme={theme} disabled={busy} showErrors={showErrors} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{button("초안 저장", () => void run(async () => { await saveCurrent(); }))}{button("계획 확인", prepareCurrent, false, true)}</View>
    </View>}
    {screen === "plan" && record && plan && <View style={{ gap: 16 }}>
      <Text style={{ color, fontSize: 20, fontWeight: "600" }}>{record.feature.title}</Text><Text style={{ color }}>목표: {record.feature.goal}</Text><Text style={{ color }}>범위: {record.feature.scope}</Text>
      <Text selectable style={{ color }}>대상: {plan.projectSnapshot?.repositoryPath}{"\n"}기준: {plan.projectSnapshot?.baseRef}{"\n"}커밋: {plan.baseCommit}{"\n"}계획 버전: {plan.revision}</Text>
      {environment.data?.checks.map(item => <Text key={item.label} style={{ color }}>{item.passed ? "✓" : "!"} {item.detail}</Text>)}
      {environment.error && <Text style={{ color }}>{explainError(environment.error)}</Text>}
      {record.checks.length ? <Text style={{ color }}>자동 검사 {record.checks.length}개 · 완료 조건 {record.criteria.length}개</Text> : <Text style={{ color }}>자동 검증 없음 · 수동 검토 필요</Text>}
      {record.criteria.map(x => <Text key={x.id} style={{ color }}>• {x.text} · {x.checkIds.length ? `연결 검사 ${x.checkIds.length}개` : `수동: ${x.manualMethod}`}</Text>)}
      {record.checks.map(x => <Text key={x.id} style={{ color }}>{x.label} · {x.path}</Text>)}
      {[plan.requestPlan, plan.taskPlan].map((p, i) => <View key={p.id} style={{ gap: 8, padding: 14, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}><Text style={{ color, fontSize: 18, fontWeight: "600" }}>{i ? "Task PLAN" : "Request PLAN"}</Text><Text selectable style={{ color, fontSize: 13, lineHeight: 20 }}>{p.content}</Text></View>)}
      {!!active.length && <View style={{ gap: 8 }}><Text style={{ color }}>다른 작업이 실행 슬롯을 사용 중입니다.</Text>{active.map(id => <View key={id}>{button(`진행 중 작업 열기: ${history.data?.active.find(x => x.token === id)?.title ?? id}`, () => open({ token: id }))}</View>)}</View>}
      {(!!storage.error || !!storage.data?.issues.length) && <Text style={{ color }}>저장소 상태를 확인해야 실행할 수 있습니다.</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {button("입력 수정", () => setScreen("edit"))}{button("계획 다시 생성", prepareCurrent)}
        {button("이 계획으로 실행", () => void run(async () => { const payload = { token: record.token, expectedRevision: record.revision, planRevision: plan.revision, inputHash: plan.inputHash }; const started = await start({ ...payload, commandKey: keyFor("start", payload) }); adopt(started); retry.current = null; setScreen("detail"); }), blocked || environment.data?.ready !== true, true)}
      </View><Text style={{ color, opacity: 0.7 }}>실행하면 현재 요청·조건·검사·계획을 고정합니다. 기준 커밋이나 설정이 바뀌면 계획 재생성이 필요합니다.</Text>
    </View>}
    {screen === "detail" && selected.error && <Text accessibilityRole="alert" style={{ color }}>상세 조회가 지연됩니다. 마지막 저장 상태를 표시합니다.</Text>}
    {screen === "detail" && detail && <TaskDetail key={token} {...props} record={detail} failure={selected.data?.failure} onCopy={() => { fresh(); setValues({ feature: { ...detail.feature, title: `${detail.feature.title} (복사)` }, criteria: detail.criteria.map(c => ({ ...c, legacy: false })), checks: detail.checks }); }} actions={selected.data?.allowedActions ?? ["observe"]} onChanged={refresh} />}
  </ScrollView>;
}
