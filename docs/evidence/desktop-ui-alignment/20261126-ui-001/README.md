# UI-A 화면 수용 근거

- 날짜: 2026-11-26, Asia/Seoul. [PLAN](../../../plans/desktop-ui-alignment.md), [최종 판정](../../../decisions/desktop-ui-alignment.md).
- 기준: `3aad0263a460b8155e33cf209d36758fea245c0a`; 현재 브랜치 `codex/desktop-ui-alignment`.
- 종류: 실제 WinUI 렌더링/입력/탐색을 관측한 GUI 시험 + 메모리 합성 RPC. 실제 제작·파일 반영의 검증은 아니다.
- 현재 [시험 호스트](../../../../desktop/Orchiva.Desktop.UiTests/App.xaml.cs)와 [fixture](../../../../desktop/Orchiva.Desktop.UiTests/WorkspaceFixture.cs)를 사용했다. 모델·Agent·Worktree 0, daemon 미시작.
- 변경 전은 기준 커밋을 `%TEMP%/orchiva-ui-before-20261126`에 추출해 같은 fixture를 주입했다. 제품 소스를 되돌리지 않았다. 별도 테스트 App은 초기 목록/프로젝트/요청/지침/미리보기/권한/diff/반영 이력만 메모리에 준비하고 bridge 연결을 차단했다. [변경 전 조건](before/baseline.json).
- 기본 fixture의 프로젝트·요청·PLAN·결과·실패·검사·반영 데이터를 맞췄다. 포커스/입력 유지 시험 중에는 제목과 요청 유형을 의도적으로 바꾸었다. 변경 후 시험 툴바는 비교 화면에서 추가 높이를 사용하며 제품에는 포함되지 않는다.

## 페이지별 대조

| 화면 | 변경 전 | 변경 후 | 관측 결과 |
| --- | --- | --- | --- |
| 01 프로젝트 | [통합 작업실](before/01-02-project-setup.png) | [목록](after/01-projects-wide.png) | 별도 목록·소스 경로·초기화 필요 상태·추가 진입점 |
| 02 추가/초기화 | 같은 통합 작업실 | [등록과 미리보기](after/02-setup-wide.png) | 입력과 변경 내용 분리, 등록/확인 초기화 유지 |
| 03 분야 | [요청 탭 내 선택](before/03-04-05-06-10-request-plan.png) | [분야 카드](after/03-home-actions-wide.png) | 넓은 폭 3열, [작은 창 2열](after/03-home-compact-cards.png), 4개 후속 분야 비활성 |
| 04 새 요청 | [연속 입력](before/04-request-input.png) | [본문과 옵션](after/04-request-wide.png) | 입력/옵션 분리, 저장과 PLAN 작성 분리 |
| 05 수정 요청 | 같은 요청 양식 | [수정 요청](after/05-modify-wide.png) | 제목 변경·부모 선택 유지, [하단 행동](after/05-modify-actions.png) 접근 |
| 06 PLAN | [요청 하단 원문](before/06-plan.png) | [원문과 요약](after/06-plan-wide.png) | 읽기 전용 원문·해시 확인 계약 유지, [확인란](after/06-plan-confirmation.png) 유지 |
| 07 실행/복구 | [결과와 통합](before/07-08-execution-result.png) | [실행](after/07-execution-wide.png) | [권한 상세](after/07-permission-controls.png), [응답 필요](after/07-permission-waiting-state.png), [복구 행동](after/07-recovery-actions.png) 접근 |
| 08 결과 | [문자열/JSON](before/07-08-execution-result.png) | [결과와 검토](after/08-result-wide.png) | 현재 결과와 과거 결과, 실패, 미실행 검사를 구분. [판정 이력](after/08-results-history-actions.png) 보존 |
| 09 소스 반영 | [세로 나열](before/09-apply.png) | [목록/비교 분리](after/09-apply-wide.png) | 충돌 표시·선택 유지, [미완료 이어 처리/undo](after/09-apply-recovery.png) 접근 |
| 10 이력 | [요청 탭 ComboBox](before/03-04-05-06-10-request-plan.png) | [독립 목록/이력](after/10-history-wide.png) | [PLAN/실행/결과](after/10-history-actions.png), [기존 v2 가져오기](after/10-history-import-controls.png), [v2 조회](after/legacy-v2-access.png) 접근 |
| 11 지침 | [등록 아래 편집기](before/11-instructions.png) | [파일 목록/편집기](after/11-instructions-wide.png) | 경로·범위·내용과 저장 유지 |
| 12 상담 | 미구현 | 메뉴·분야 비활성 | 제품 기능 추가 없음, 수용 대상 제외 |
| 13 설정 | [ComboBox 나열](before/13-settings.png) | [설정 행](after/13-settings-wide.png) | 앱 테마/닫기 설정과 [프로젝트 설정](after/configuration-normal.png) 분리 |
| 14 연결 | [문구/버튼](before/14-connection.png) | [요약/상세](after/14-connection-wide.png) | 시작/재연결 접근, [진단 펼치기](after/14-connection-details.png) |

## 폭·테마·키보드·상태

`AppWindow.Resize`에 800×600, 1280×900, 1600×1000을 요청했고 네이티브 `RasterizationScale`은 1.25였다. 전체 창을 배율로 나눈 명목 크기는 각각 640×480, 1024×720, 1280×800 DIP이며 실제 내용 영역은 창 테두리·제목·시험 툴바·탐색 여백만큼 작다. 화면 도구가 반환한 PNG는 약 627×474, 1011×714, 1267×794 크기다. 이미지 크기를 물리 창 크기나 100% 배율이라고 해석하지 않는다.

- 넓은 밝은 화면: 위 13개 화면. 작은 어두운 화면: [요청 행동](after/04-request-compact-actions.png), [PLAN 확인/실행](after/06-plan-compact-actions.png), [결과 확인/검토](after/08-result-compact-review.png), [반영 복구](after/09-apply-compact-recovery.png), [지침 저장](after/11-instructions-compact-save.png). 줄바꿈·단일 열·스크롤로 접근했다.
- 입력 유지: [제목 변경 후 Tab 포커스](after/04-keyboard-input.png), 여러 화면 이동 후 [같은 제목 유지](after/04-request-compact-dark.txt). 콤보의 Home/Down/End/Enter로 상태/화면 선택도 확인했다. 모든 컨트롤의 키보드 전수 시험은 아니다.
- 예외: [빈 목록](after/state-empty-normal-dark.png), [연결 오류](after/state-connection-error.png), [로딩/선택 비활성](after/state-loading-retest.png), [응답 후 복귀](after/state-loading-recovered.png). 오류를 실행 실패나 검사 통과로 바꾸지 않는다.
- 배율: 사용자 지시로 100/150/200% 변경 검증은 이번 수용에서 제외한다. 사용자 사용 목표 100%와 이번 관측 125%를 구분한다. Windows 설정은 변경하지 않았다.

## 자동 검사와 시험 도우미 수정

첫 [모의 결과](mock-results.json) 19개 통과 후 5초 로딩 시나리오에서 시험 도우미의 2초 대기 제한 때문에 시험 앱이 종료됐다. `Access.Idle`만 10초로 늘렸다. 수정 후 시험 프로젝트 빌드 경고/오류 0, [모의 재검증](retest/mock-results.json) 19개 통과, GUI에서 로딩 후 목록 선택 가능 상태로 돌아오고 이후 탐색도 계속되는 것을 확인했다. 첫 로딩 화면은 실패 이력으로 보존한다.

기존 제품 빌드·typecheck·격리 C# 13개(skip 0)는 [11월 17일 기록](../../../decisions/desktop-ui-alignment.md)에 있으며 제품 코드 추가 변경이 없어 반복하지 않았다. 이번 변경은 시험 도우미 대기 시간과 검증 문서다. 최종 정적·문서 검사 및 증거 파일 해시는 [요약](summary.json)에 기록한다. 두 시험 앱의 종료를 확인했고 실제 실행부를 시작하지 않았다.
