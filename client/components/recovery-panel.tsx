import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { retryStartRpc, reconcileRpc, revalidateRpc, resumeRpc, type RequestRecord } from "../../shared/contracts/feature-request";

export function RecoveryPanel({ record, failure, actions, theme, onChanged, onCopy }: Pick<PluginScreenProps, "theme"> & { record: RequestRecord; failure?: RequestRecord["failure"]; actions: string[]; onChanged(): Promise<unknown>; onCopy?: () => void }) {
  const retry = useRpc(retryStartRpc), reconcile = useRpc(reconcileRpc), revalidate = useRpc(revalidateRpc), resume = useRpc(resumeRpc);
  const [instruction, setInstruction] = useState(record.decision?.approved === false ? record.decision.note : "");
  useEffect(() => { if (record.decision?.approved === false) setInstruction(record.decision.note); }, [record.decision?.at]);
  const intent = useRef({ signature: "", key: "" });
  const target = record.commands.filter(x => ["start", "retry-start", "resume"].includes(x.kind) && ["unknown", "failed"].includes(x.status)).at(-1);
  const action = useMutation({ mutationFn: async (kind: "retry-start" | "reconcile" | "revalidate" | "resume") => {
    const signature = JSON.stringify({ kind, target: target?.key, revision: record.revision, resultId: record.result?.id, instruction });
    if (intent.current.signature !== signature) intent.current = { signature, key: `recovery-${globalThis.crypto.randomUUID()}` };
    const base = { token: record.token, commandKey: intent.current.key, expectedRevision: record.revision };
    if (kind === "retry-start") return retry({ ...base, targetCommandKey: target!.key });
    if (kind === "reconcile") return reconcile({ ...base, targetCommandKey: target!.key });
    if (kind === "revalidate") return revalidate({ ...base, resultId: record.result?.id ?? null });
    return resume({ token: record.token, key: base.commandKey, expectedRevision: record.revision, resultId: record.result?.id ?? null, instruction });
  }, onSuccess: (_, kind) => { if (kind === "resume") setInstruction(""); }, onSettled: onChanged });
  if (!failure && record.status !== "needs-input" && record.status !== "completed") return null;
  const color = theme.colors.foreground;
  const label = failure ? ({ setup: "실행 준비 실패", execution: "실행 오류 또는 중단", validation: "자동 검사 실패", "verification-system": "검증기·근거 수집 오류", "review-rejected": "수정 요청됨", "delivery-unknown": "생성·전송 결과 확인 필요", "resource-missing": "기존 작업 리소스 확인 필요" })[failure.kind] : record.status === "completed" ? "완료된 작업" : "Paseo에서 질문 또는 권한 요청을 확인하세요.";
  const button = (name: string, kind: Parameters<typeof action.mutate>[0], disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={disabled || action.isPending} onPress={() => action.mutate(kind)} style={{ padding: 12, backgroundColor: theme.colors.surface2, borderRadius: 8, opacity: disabled || action.isPending ? .5 : 1 }}><Text style={{ color }}>{name}</Text></Pressable>;
  return <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10 }}>
    <Text style={{ color, fontWeight: "700" }}>{label}</Text>
    {failure && <Text selectable style={{ color }}>{failure.message}</Text>}
    {action.error && <Text accessibilityRole="alert" style={{ color }}>{action.error.message.includes("REVISION_CONFLICT") ? "다른 화면에서 작업이 변경됐습니다. 현재 결과를 확인하고 다시 시도하세요. 입력은 유지됩니다." : action.error.message.includes("STALE_RESULT") ? "검토한 결과가 바뀌었습니다. 최신 결과를 먼저 확인하세요." : action.error.message.includes("BUSY") ? "다른 작업이 실행 중이거나 전달 확인 중입니다. 해당 작업을 먼저 확인하세요." : action.error.message}</Text>}
    {failure?.kind === "delivery-unknown" && <>
      <Text style={{ color }}>자동 재전송과 새 실행을 중지했습니다. 원래 식별자를 대조해 확인된 리소스만 연결합니다. 이력이 없거나 식별자가 소실되면 확인 대기를 유지합니다.</Text>
      <Text selectable style={{ color }}>원래 명령: {target?.key}{"\n"}전달 단계: {target?.phase}{record.recovery?.pending ? `\n수정 지시: ${record.recovery.instruction}` : ""}</Text>
      {record.deliveryChecks?.at(-1) && <Text style={{ color }}>마지막 대조: {record.deliveryChecks.at(-1)!.outcome} · {record.deliveryChecks.at(-1)!.at}</Text>}
    </>}
    {failure?.kind === "verification-system" && <Text style={{ color }}>환경·파일 크기·검사 로그를 확인한 뒤 검증만 다시 실행할 수 있습니다. 시도 번호와 세션은 유지됩니다.</Text>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {actions.includes("retry-start") && button("초기 실행 재시도", "retry-start")}
      {actions.includes("reconcile") && button("전달 결과 대조", "reconcile")}
      {actions.includes("revalidate") && !record.result && button("근거 수집·검증 다시 실행", "revalidate")}
    </View>
    {record.status === "failed" && actions.includes("resume") && <View style={{ gap: 10 }}>
      <Text style={{ color }}>현재 시도 {record.attempt}의 실패 근거를 보존하고 같은 Worktree·세션에서 수정합니다. 아래 버튼을 눌러야 새 지시를 전송합니다.</Text>
      <TextInput accessibilityLabel="같은 작업 재개 지시" placeholder="실패 원인과 수정할 내용을 구체적으로 입력하세요" placeholderTextColor={theme.colors.foregroundMuted} value={instruction} onChangeText={setInstruction} editable={!action.isPending} multiline style={{ color, padding: 12, borderWidth: 1, borderColor: theme.colors.border, minHeight: 90 }} />
      {button("같은 작업에서 재개", "resume", !instruction.trim())}
    </View>}
    {(failure?.kind === "resource-missing" || record.status === "completed") && onCopy && <><Text style={{ color }}>기존 결과는 보존합니다. 새 요청은 내용을 검토하고 별도로 계획을 확인한 뒤 실행하세요.</Text><Pressable accessibilityRole="button" accessibilityLabel="내용을 복사해 새 요청" onPress={onCopy} style={{ padding: 12, backgroundColor: theme.colors.surface2 }}><Text style={{ color }}>내용을 복사해 새 요청</Text></Pressable></>}
  </View>;
}
