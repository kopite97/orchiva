export const templates: Record<string, string> = {
  "docs/agents/workflow.md": "# 작업 지침\n\n루트 AGENTS.md와 작업 경로에 적용되는 등록 지침을 먼저 읽는다. 현재 PLAN의 목표와 범위만 수행하고 기존 변경을 보존한다. 원본 소스 반영은 별도 검토 후 선택한 파일만 적용한다. 파일 이름은 목적을 드러내는 소문자 kebab-case를 기본으로 하고 프로젝트의 기존 명명 규칙을 우선한다. 결과물에는 요청하지 않은 README나 지침서를 관례적으로 만들지 않는다. 자동 commit·push·merge를 하지 않는다.\n",
  "docs/plans/plans.md": "# PLAN 규칙\n\nPLAN은 작업 단위다. 목표·입력·범위·작업 순서·산출물·자동 확인·사용자 검토·실패 복구를 기록한다. 정형 입력과 지침을 분석한 AI 계획을 확인한 뒤 실행한다. 상태는 proposed / active / completed / failed / cancelled로 표시하며 계획 작성과 구현 완료를 구분한다. revision·실행·결과·판정은 덮어쓰지 않는다. 외부 편집 후에는 다시 확인한다. 작업 종료 시 evidence/<플랜 이름>/<실행 ID>/ 근거와 decisions 기록을 연결한다.\n",
  "docs/plans/README.md": "# PLAN 목록\n\n<!-- orchiva:plans:start -->\n| PLAN | 상태 |\n| --- | --- |\n<!-- orchiva:plans:end -->\n",
  "docs/decisions/decisions.md": "# 결정 기록 규칙\n\nPLAN과 연결하여 맥락·대안·결정·근거·영향·후속 작업을 기록한다. 과거 결정·실패·검토를 지우지 않고 후속 기록을 추가한다. 자동 검증과 사람이 확인한 품질을 구분한다.\n",
  "docs/evidence/evidence.md": "# 검증 근거 규칙\n\n검증 자료가 생기면 <플랜 이름>/<실행 ID>/에 종류·절차·기대 결과·실제 결과·미실행 사유를 기록한다. 플랜 작업 종료마다 근거를 정리하고 실패와 재검증도 별도 실행으로 보존한다. 인증값·개인 요청 원문·큰 원시 로그를 공유 근거에 포함하지 않는다. 자동 검사 통과와 사용자 완료 판단을 구분한다.\n",
};
export const defaultRefs = ["docs/agents/workflow.md", "docs/plans/plans.md", "docs/decisions/decisions.md", "docs/evidence/evidence.md"].map(path => ({ path, scope: "all", required: true }));
export function rootMap(refs: typeof defaultRefs) {
  return "<!-- orchiva:instructions:start -->\n## Orchiva 지침 지도\n\n| 적용 범위 | 지침 |\n| --- | --- |\n" + refs.map(x => `| ${x.scope} | [${x.path}](${x.path}) |`).join("\n") + "\n<!-- orchiva:instructions:end -->\n";
}
