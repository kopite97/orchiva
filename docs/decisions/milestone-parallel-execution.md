# MA4 병렬 실행과 순서 통합 검증

2026-11-26 · Windows · Paseo 0.15.4 · Codex · 격리 실행 `d1-ma-parallel-20261126-001-parallel`

같은 Milestone에서 B가 먼저 끝나 승인됐고, 통합 브랜치에는 A → B → C 순서로 반영됐다. 새 checkout에서 고정 검사 세 개가 통과했다. [실행·예약·통합 SHA 기록](../evidence/milestone-automation/MA4/d1-ma-parallel-20261126-001/parallel-report.json)

| Feature | 예약과 실제 실행 | 통합 커밋 |
| --- | --- | --- |
| A | B와 같은 `e59dd9dc`에서 시작해 `Shared.unity`의 점수를 변경 | `cc404b0f` |
| B | 독립 Worktree에서 `label.txt`를 변경. 승인·내보내기 후 대기하고, A가 통합되자 새 기준에 승인 파일을 적용해 B의 고정 검사를 다시 실행 | `9984a9b7` |
| C | A와 같은 Scene·Editor 자원에서 대기. B 통합 커밋에서 시작해 A의 점수를 유지하고 Scene 라벨을 변경 | `0b99c53d` |

A·B의 시작 명령 완료부터 결과 수집까지의 구간은 약 46초 겹쳤다. 13:23:35 KST에 Paseo에서 두 세션 모두 실행 중이며 활성 turn이 있음을 조회했다. 관측 구간을 확보하려고 A·B의 작업 지시에 각각 25초·12초 대기를 넣었다. 이 수치는 처리 속도 측정에 사용하지 않는다. 기능별 Worktree와 세션은 각 세 개였고 실제 사용자 메시지 수는 각각 1·1·2였다. C의 두 번째 메시지는 같은 세션에 보낸 복구 지시였다.

## 배정과 복구

작업실의 **Git 통합과 GitHub 동기화**에서 로컬 통합 브랜치와 **독립 Feature 최대 2개 병렬 실행**을 선택한다. 기존 기본값은 직렬이다. 선행 결과와 검토 승인을 확인하고 읽기·쓰기 경로, 에셋과 메타데이터, 선언한 공유 자원을 한 번에 예약한다. Scene·Prefab은 Editor 자원 하나를 공유한다. 경로를 바꾸는 작업은 원래 경로와 새 경로를 모두 출력 범위에 선언한다. 명시적 우선순위가 있으면 실행 가능한 순서, 우선순위, 먼저 대기한 노드와 안정 ID로 순서를 확정한다.

예약 직후 run을 일시중지하고 격리 daemon을 종료·재시작했다. 두 요청의 token과 예약 세대 3이 보존됐다. 예약 중 수동 요청의 PLAN 생성은 거절됐고, run 종료 후 같은 초안이 PLAN 한 건을 생성했다. 별도 WinUI 프로세스에서 실행 중 상태와 완료 상태를 각각 다시 읽었다. [화면 검증 기록](../evidence/milestone-automation/MA4/d1-ma-parallel-20261126-001/parallel-ui.json)

조율 담당이 격리된 입력의 근거를 확인할 수 없어 두 번 배정을 보류했다. 계획 생성 폴더의 Git 경계를 분리하고 허용된 텍스트 입력을 함께 전달한 뒤 조율을 통과했다. C의 첫 실행은 예약 확인을 요구해 파일을 변경하지 않았고 고정 검사가 실패했다. 원장에 기록된 세대·기준 SHA·자원을 동일 세션에 전달하자 재검사를 통과했다. 새 작업의 PLAN 입력에도 같은 예약 근거를 포함하도록 수정했다. 처음 실패한 결과와 조율 원문은 해당 격리 디렉터리에 보존했다.

기본 실패 정책은 신규 배정을 보류한다. **독립 작업 계속**을 선택하면 실패와 외부 명령 종료가 확인된 worker의 실행 슬롯을 독립 작업에 배정할 수 있다. 경로 예약과 실패한 노드에 의존하는 작업은 계속 대기한다. 두 실패 정책, 구형 v2 요청의 배타성, 오래된 세대 쓰기 거절은 자동 테스트로 검증했다.

## 재현

Windows에서 프로젝트 의존성과 로컬 Paseo·Codex를 준비한 뒤 사용한 적 없는 시험 ID를 지정한다. 다음 절차는 로컬 모델 작업을 실제로 생성한다.

```powershell
$id = 'd1-ma-parallel-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
npm.cmd run desktop:verify -- prepare $id --empty
npm.cmd run desktop:verify -- start $id
node scripts/milestone-poc.mjs setup $id
node scripts/milestone-parallel-poc.mjs create $id
node scripts/milestone-parallel-poc.mjs checkpoint $id
npm.cmd run desktop:verify -- stop $id
npm.cmd run desktop:verify -- start $id
node scripts/milestone-parallel-poc.mjs verify $id
node scripts/milestone-parallel-poc.mjs manual $id
npm.cmd run desktop:verify -- stop $id
```

`verify`는 실행 중인 fixture에서 PLAN 실행·결과 승인·내보내기를 요청한다. 기존 완료 실행에서는 세션·Git 부모·파일·검사만 다시 확인한다. 단건 재개와 재시작 전후 PID는 `manual` 단계가 기록한다. 실제 Unity Editor, 게임 빌드 및 Player 수용은 [MA5](../plans/milestone-unity-validation.md) 범위다. 이번 장애 주입은 예약을 기록한 직후의 daemon 재시작으로 한정했다.
