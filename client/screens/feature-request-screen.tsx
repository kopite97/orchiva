import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { configRpc, listRpc, startRpc, featureSchema, startSchema, type Feature, type Check } from "../../shared/contracts/feature-request";
import { RequestResult } from "../components/request-result";

const empty: Feature = { title: "", goal: "", scope: "", constraints: "", validation: "", completionCriteria: "" };
const fields: [keyof Feature, string, string][] = [
  ["title", "Title", "요청 이름"], ["goal", "Goal", "달성하려는 결과"],
  ["scope", "Scope", "포함할 작업과 제외할 작업"], ["constraints", "Constraints", "지켜야 할 제약"],
  ["validation", "Validation", "결과를 검증하는 방법"], ["completionCriteria", "Completion Criteria", "완료를 판단할 조건"],
];
const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export function FeatureRequestScreen({ theme, layout, navigation, host }: PluginScreenProps) {
  const [feature, setFeature] = useState<Feature>(empty);
  const [token, setToken] = useState(newToken);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");
  const [testPaths, setTestPaths] = useState(""), [requiredPath, setRequiredPath] = useState(""), [requiredText, setRequiredText] = useState("");
  const start = useRpc(startRpc), list = useRpc(listRpc), project = useRpc(configRpc);
  const cache = useQueryClient();
  const requestKey = ["orchiva", host.id, "requests"];
  const config = useQuery({ queryKey: ["orchiva", host.id, "project"], queryFn: () => project({}) });
  const history = useQuery({ queryKey: requestKey, queryFn: () => list({}), refetchInterval: 2000 });
  const refreshRequests = () => cache.invalidateQueries({ queryKey: requestKey });
  const mutation = useMutation({ mutationFn: start, onSettled: refreshRequests });
  const color = theme.colors.foreground;
  const button = { padding: 12, borderRadius: 8, backgroundColor: theme.colors.accent };
  const buttonText = { color: theme.colors.accentForeground, fontWeight: "600" as const };
  const panel = { padding: 20, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, gap: 14 };
  const submit = () => {
    const parsed = featureSchema.safeParse(feature);
    if (!parsed.success) { setFormError("여섯 항목을 모두 입력해 주세요. Title은 160자, 각 항목은 12,000자까지 입력할 수 있어요."); return; }
    const checks: Check[] = testPaths.split(/\r?\n/).map(path => path.trim()).filter(Boolean).map(path => ({ kind: "node-test", path, label: `Node test: ${path}` }));
    if (requiredPath.trim() || requiredText.trim()) checks.push({ kind: "file-contains", path: requiredPath.trim(), text: requiredText.trim(), label: `Required content: ${requiredPath.trim()}` });
    const request = startSchema.safeParse({ token, feature: parsed.data, checks });
    if (!request.success) { setFormError("자동 검증은 Worktree 상대 경로로 입력하세요. 파일 내용 검증은 경로와 내용을 모두 입력해야 합니다. 최대 8개입니다."); return; }
    setFormError(""); setSubmitted(true); mutation.mutate(request.data);
  };
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 32, gap: 24 }}>
    <View style={{ gap: 8 }}>
      <Text style={{ color, fontSize: 13 }}>ORCHIVA / PoC Sandbox / Development</Text>
      <Text style={{ color, fontSize: 30, fontWeight: "700" }}>Feature Request</Text>
      <Text style={{ color }}>요청과 계획을 만들고, 전용 Worktree에서 Codex 작업을 시작하세요.</Text>
      <Text style={{ color, opacity: 0.65 }}>{config.data ? `${config.data.baseRef} · ${config.data.provider}` : "프로젝트 설정을 불러오는 중…"}</Text>
      {config.error && <Text style={{ color }}>{config.error.message}</Text>}
    </View>
    <View style={panel}>
      {fields.map(([key, label, placeholder]) => <View key={key} style={{ gap: 6 }}>
        <Text style={{ color, fontWeight: "600" }}>{label}</Text>
        <TextInput accessibilityLabel={label} value={feature[key]} placeholder={placeholder}
          editable={!submitted && !mutation.isPending} multiline={key !== "title"} maxLength={key === "title" ? 160 : 12000}
          onChangeText={value => setFeature(prev => ({ ...prev, [key]: value }))}
          style={{ color, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, minHeight: key === "title" ? 44 : 76, textAlignVertical: "top" }} />
      </View>)}
      <Text style={{ color, fontWeight: "600" }}>자동 검증 (선택)</Text>
      <Text style={{ color }}>Node 테스트 파일을 한 줄에 하나씩 입력하세요. 각 검증은 최대 10초, 전체 20초이며 파일 읽기만 허용됩니다.</Text>
      <TextInput accessibilityLabel="Node test paths" value={testPaths} onChangeText={setTestPaths} editable={!submitted} multiline placeholder="예: tests/feature.test.mjs" style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12 }} />
      <TextInput accessibilityLabel="Required file path" value={requiredPath} onChangeText={setRequiredPath} editable={!submitted} placeholder="내용을 확인할 파일 경로 (선택)" style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12 }} />
      <TextInput accessibilityLabel="Required file content" value={requiredText} onChangeText={setRequiredText} editable={!submitted} placeholder="파일에 반드시 포함되어야 할 내용" style={{ color, borderWidth: 1, borderColor: theme.colors.border, padding: 12 }} />
      {!!formError && <Text accessibilityRole="alert" style={{ color }}>{formError}</Text>}
      {mutation.error && <Text accessibilityRole="alert" style={{ color }}>{mutation.error.message}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Create request and start Codex" disabled={mutation.isPending || !config.data || mutation.data?.status === "started"} onPress={submit} style={[button, { opacity: mutation.isPending || mutation.data?.status === "started" ? 0.5 : 1 }]}>
        <Text style={buttonText}>{mutation.isPending ? "실행 준비 중…" : mutation.data?.status === "started" ? "Codex 세션 시작됨" : submitted ? "같은 요청 다시 시도" : "요청 생성 및 Codex 시작"}</Text>
      </Pressable>
      {submitted && !mutation.isPending && <Pressable accessibilityRole="button" onPress={() => { setFeature(empty); setTestPaths(""); setRequiredPath(""); setRequiredText(""); setToken(newToken()); setSubmitted(false); setFormError(""); mutation.reset(); }}><Text style={{ color }}>새 요청 작성</Text></Pressable>}
    </View>
    <Text style={{ color, fontSize: 20, fontWeight: "600" }}>최근 요청</Text>
    {history.error && <Text style={{ color }}>{history.error.message}</Text>}
    {history.data?.length === 0 && <Text style={{ color }}>아직 요청이 없어요. 위 양식에서 첫 작업을 시작하세요.</Text>}
    {history.data?.map(record => <RequestResult key={record.id} record={record} theme={theme} host={host} navigation={navigation} onChanged={refreshRequests} />)}
  </ScrollView>;
}
