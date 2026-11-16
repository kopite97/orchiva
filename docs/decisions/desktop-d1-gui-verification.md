# D1 Windows 화면 검증

작성일: 2026-11-16 · Asia/Seoul. 실행 ID: `d1-20261116-003`. 상태: **핵심 조회 흐름 검증 완료, D1 전체 수용 미완료**.

후속 상태: [실행부 보완과 비GUI 검증 완료](desktop-d1-runtime-completion.md). 아래 내용은 해당 실행 당시 기록이며 최신 결과와 GUI 대기 목록은 후속 문서를 따른다.

사용자가 Smart App Control을 직접 끈 뒤 검증을 요청했다. 읽기 점검에서 `VerifiedAndReputablePolicyState=0`을 확인했고 .NET 테스트와 WinUI exe가 정상 실행됐다. 이전 [D1 구현 기록](desktop-d1-foundation.md)의 실행 차단은 당시 사실이며 현재 차단 상태가 아니다. 에이전트는 Windows 보안 설정을 변경하지 않았다.

## 발견한 문제와 수정

처음 실행한 C# 테스트는 7개 중 4개 통과, 3개 실패였다. stdout 오염·크기 초과·result 없는 응답에서 reader가 pending 요청에 실패를 설정한 직후 lifetime을 취소하면서, 호출자가 연결 오류 대신 `TaskCanceledException`을 받는 경합이 발생했다.

`desktop/Orchiva.Bridge/BridgeClient.cs`에서 사용자 취소와 연결 수명 취소를 구분하도록 수정했다. 호출자 취소가 아니면서 연결 수명이 종료된 경우 `IOException`으로 전달한다. 기존 사용자 취소 테스트는 그대로 유지했다. 수정 후 **실제 격리 Plugin 연결 사례를 포함한 C# 7/7 테스트**, WinUI build 경고 0·오류 0을 확인했다. Node 코드와 의존성은 이번 수정에서 바꾸지 않아 앞선 94/94 회귀 결과를 유지하며 재실행으로 집계하지 않았다.

## 실제 화면 확인

Windows 앱 조작은 computer-use 스킬의 `sky`로 수행했다. 각 화면의 PNG와 접근성 관측은 [증거 디렉터리](../evidence/desktop-transition/d1-20261116-003/summary.json)에 연결한다. 시안 이미지가 아닌 실행한 WinUI 화면이다.

| 항목 | 확인 결과 | 대표 근거 |
| --- | --- | --- |
| 프로젝트·연결 | 실제 PoC Sandbox 정보, 격리 home/port, 조회 전용 연결 표시 | [프로젝트](../evidence/desktop-transition/d1-20261116-003/03-project-light.png), [연결](../evidence/desktop-transition/d1-20261116-003/02-connection-light.png) |
| PLAN 이력·상세 | 합성 초안 2건·완료 1건, PLAN 원문·결과 1개·판정 조회, 스크롤 가능 | [재실행 후 결과](../evidence/desktop-transition/d1-20261116-003/13-reopened-result.png) |
| 테마·키보드 | 밝은 화면에서 어두운 테마로 전환, Tab 포커스 표시와 Alt+Down 선택 목록 확인 | [어두운 설정](../evidence/desktop-transition/d1-20261116-003/04-settings-dark.png), [키보드](../evidence/desktop-transition/d1-20261116-003/06-keyboard-settings.png) |
| 트레이 닫기·복원 | 닫기에서 창만 숨겨지고 PID 43620 유지. 사용자가 트레이 아이콘 더블클릭으로 정상 복원했다고 확인, 이후 같은 앱의 설정 유지 관측 | [복원 화면](../evidence/desktop-transition/d1-20261116-003/07-tray-restored.png) |
| 연결 끊김 | 소유 격리 daemon 정상 정지 후 새로 고침. 오류 배너 표시, 기존 프로젝트·목록·상세 보존 | [프로젝트 보존](../evidence/desktop-transition/d1-20261116-003/08-offline-stale-project.png), [이력 보존](../evidence/desktop-transition/d1-20261116-003/09-offline-history.png) |
| 앱에서 실행부 시작 | 연결 화면 버튼으로 같은 격리 home 재시작, 다시 연결됨·조회 시각 갱신·경고 해제 | [복구 화면](../evidence/desktop-transition/d1-20261116-003/10-reconnected.png) |
| 종료·재실행 | 닫기 설정을 앱 종료로 변경, 첫 앱 PID 43620 종료. 새 PID 15576에서 어두운 테마·닫기 설정과 동일 요청/결과 재조회 | [설정](../evidence/desktop-transition/d1-20261116-003/11-exit-setting.png), [재실행 목록](../evidence/desktop-transition/d1-20261116-003/12-reopened-history.png) |
| 최종 정리 | 앱 PID 15576와 소유 bridge PID 29824 정상 종료. 앱 종료 후에도 daemon 조회 성공을 확인한 뒤 시험 home만 정상 정지 | summary의 cleanup 및 live-after JSON |

트레이 복원은 도구가 트레이 영역을 대상으로 잡지 못해 **사용자 수행·에이전트 사후 관측**으로 구분한다. 사용자의 Escape 입력으로 한 차례 컴퓨터 조작을 중단했고, “다시 이어서 해줘” 요청 후 재실행 상태와 최종 종료를 확인했다. 앱 재열기는 1회이며 PLAN의 3회 연속 전체 앱 수명 시험으로 집계하지 않는다.

## 데이터·실행 경계

실제 모델 실행·Agent·Workspace 생성은 모두 0이다. 격리 port는 50223이며 원래 6767을 사용하지 않았다. 두 차례 live verify에서 동일 fixture 3건, 중복 store owner 거부, 원래 54개 요청과 fixture의 바이트 보존을 확인했다. 마지막 daemon stop에서도 해시 대조가 통과했다. 인증 파일과 요청 원본은 증거 디렉터리로 복사하지 않았다.

## 남은 항목

- 앱의 실행부 시작 버튼을 누를 때 **Paseo Daemon 콘솔 창이 나타남**. Orchiva child launcher의 숨김 설정만으로 하위 Paseo 프로세스까지 숨겨지지 않는 현상을 관측했다. 공개 CLI 시작 경로·프로세스 소유권을 유지하는 해결과 재검증이 필요하며, 설치된 패키지 내부를 수정하지 않았다.
- 정확한 800×600과 1280×900 조합, 100%/150% DPI, 전체 대비·키보드 접근성 검증은 미완료다. 캡처된 논리 이미지 크기는 증거 manifest에 기록하며 이를 물리 창 크기나 DPI 검증 결과로 바꾸지 않는다. 창 크기 변경 시도만으로 통과 처리하지 않는다.
- GUI의 완전 빈 저장소·복원 진행 상태, 잘못된 credential·timeout, 한글/공백 설치 경로·잘못된 실행 파일, 전체 앱 3회 연속 수명·트레이 메뉴 명시 종료가 남아 있다.

따라서 [PLAN](../plans/desktop-transition.md)은 `active`로 유지하며 D1 전체 완료나 D2 착수를 선언하지 않는다. 이번 요청으로 수행한 핵심 화면 검증과 시험 리소스 정리는 완료했다. commit·push는 하지 않았다.
