import { Pressable, Text, TextInput, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { RequestRecord } from "../../shared/contracts/feature-request";
import { checkboxKeyboard } from "./checkbox-keyboard";
export type DraftValues = Pick<RequestRecord, "feature" | "criteria" | "checks">;
export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const emptyDraft = (): DraftValues => ({ feature: { title: "", goal: "", scope: "", constraints: "", validation: "", completionCriteria: "" }, criteria: [], checks: [] });
export function DraftEditor({ value, onChange, theme, disabled, showErrors }: { value: DraftValues; onChange(value: DraftValues): void; theme: PluginScreenProps["theme"]; disabled: boolean; showErrors: boolean }) {
  const color = theme.colors.foreground;
  const input = (label: string, text: string, change: (text: string) => void, maxLength = 12000) => <View style={{ gap: 5 }}><Text style={{ color }}>{label}</Text><TextInput accessibilityLabel={label} value={text} onChangeText={change} editable={!disabled} multiline maxLength={maxLength} style={{ color, padding: 10, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, minHeight: 48, textAlignVertical: "top" }} /></View>;
  const button = (label: string, action: () => void, blocked = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || blocked} onPress={action} style={{ padding: 10, backgroundColor: theme.colors.surface2, borderRadius: 6, opacity: disabled || blocked ? 0.45 : 1 }}><Text style={{ color }}>{label}</Text></Pressable>;
  const updateCriterion = (index: number, patch: Partial<RequestRecord["criteria"][number]>) => onChange({ ...value, criteria: value.criteria.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const toggleCheck = (index: number, id: string) => { const ids = value.criteria[index].checkIds; updateCriterion(index, { checkIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] }); };
  return <View style={{ gap: 18 }}>
    {([["title", "Title · 요청 이름"], ["goal", "Goal · 목표"], ["scope", "Scope · 범위"], ["constraints", "Constraints · 제약"], ["validation", "Validation · 검증 방법"]] as const).map(([key, label]) => <View key={key} style={{ gap: 4 }}>{input(label, value.feature[key], text => onChange({ ...value, feature: { ...value.feature, [key]: text } }), key === "title" ? 160 : 12000)}{showErrors && !value.feature[key].trim() && <Text style={{ color }}>계획을 만들려면 이 항목을 입력하세요.</Text>}</View>)}
    <Text style={{ color, fontSize: 20, fontWeight: "600" }}>완료 조건 · {value.criteria.length}/20</Text>
    {!value.criteria.length && <Text style={{ color }}>조건을 추가하고 자동 검사 또는 수동 확인 방법을 연결하세요.</Text>}
    {value.criteria.map((criterion, index) => <View key={criterion.id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}>
      {input(`완료 조건 ${index + 1}`, criterion.text, text => updateCriterion(index, { text }), 1000)}
      {value.checks.map((check, c) => <Pressable key={check.id} {...checkboxKeyboard(disabled, () => toggleCheck(index, check.id!))} accessibilityRole="checkbox" accessibilityLabel={`조건 ${index + 1}에 검사 ${c + 1} 연결`} aria-checked={criterion.checkIds.includes(check.id!)} aria-disabled={disabled} accessibilityState={{ checked: criterion.checkIds.includes(check.id!), disabled }} disabled={disabled} onPress={() => toggleCheck(index, check.id!)} style={{ paddingVertical: 8 }}><Text style={{ color }}>{criterion.checkIds.includes(check.id!) ? "☑" : "☐"} 검사 {c + 1}: {check.label || check.path || "작성 중"}</Text></Pressable>)}
      {input(`수동 확인 방법 ${index + 1}`, criterion.manualMethod, manualMethod => updateCriterion(index, { manualMethod }), 4000)}
      {showErrors && (!criterion.text.trim() || (!criterion.checkIds.length && !criterion.manualMethod.trim())) && <Text style={{ color }}>조건 문장과 연결 검사 또는 수동 확인 방법이 필요합니다.</Text>}
      {button(`조건 ${index + 1} 삭제`, () => onChange({ ...value, criteria: value.criteria.filter((_, i) => i !== index) }))}
    </View>)}
    {button("완료 조건 추가", () => onChange({ ...value, criteria: [...value.criteria, { id: newKey(), text: "", checkIds: [], manualMethod: "", legacy: false }] }), value.criteria.length >= 20)}
    <Text style={{ color, fontSize: 20, fontWeight: "600" }}>자동 검사 · {value.checks.length}/8</Text>
    {!value.checks.length && <Text style={{ color }}>자동 검증 없음 · 수동 검토 필요</Text>}
    {value.checks.map((check, index) => {
      const update = (patch: object) => onChange({ ...value, checks: value.checks.map((item, i) => i === index ? { ...item, ...patch } : item) });
      return <View key={check.id} style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8 }}>
        <Text style={{ color }}>검사 {index + 1} · {check.kind === "node-test" ? "Node 테스트" : "파일 문자열"}</Text>
        {input(`검사 ${index + 1} 설명`, check.label, label => update({ label }), 200)}
        {input(`검사 ${index + 1} 상대 경로`, check.path, path => update({ path }), 200)}
        {check.kind === "file-contains" && input(`검사 ${index + 1} 필수 문자열`, check.text, text => update({ text }), 4000)}
        {showErrors && (!check.path.trim() || !check.label.trim() || (check.kind === "file-contains" && !check.text.trim())) && <Text style={{ color }}>검사 경로·설명·필수 문자열을 확인하세요.</Text>}
        {button(`검사 ${index + 1} 삭제`, () => onChange({ ...value, checks: value.checks.filter((_, i) => i !== index), criteria: value.criteria.map(item => ({ ...item, checkIds: item.checkIds.filter(id => id !== check.id) })) }))}
      </View>;
    })}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{button("Node 검사 추가", () => onChange({ ...value, checks: [...value.checks, { id: newKey(), kind: "node-test", path: "", label: "" }] }), value.checks.length >= 8)}{button("문자열 검사 추가", () => onChange({ ...value, checks: [...value.checks, { id: newKey(), kind: "file-contains", path: "", label: "", text: "" }] }), value.checks.length >= 8)}</View>
    <Text style={{ color, opacity: 0.75 }}>검사는 Worktree 상대 경로만 지원합니다. Node 검사당 10초, 전체 20초이며 파일 쓰기와 자식 프로세스 실행은 허용하지 않습니다.</Text>
  </View>;
}
