# UI-A 구현 및 검증 결과

## 최종 판정 · 2026-11-26

**UI-A 범위 완료**. 제품 기능을 추가하지 않고 기존 와이어프레임의 탐색·화면 구획·카드·행동 배치를 반영했다. [PLAN](../plans/desktop-ui-alignment.md)은 `completed`이며 상위 데스크톱 전환은 `active`다. 변경은 `codex/desktop-ui-alignment`의 로컬 작업 트리에 있고 커밋·push하지 않았다. 아래 11월 17일 기록은 당시 사실로 보존한다.

새 실행 ID는 `20261126-ui-001`, 격리 설정은 `.desktop-local/d1-20261126-ui-001/desktop.json`이다. 실제 daemon/모델/Agent/Worktree는 시작하지 않았다. 제품 XAML/C#을 링크하는 별도 시험 앱에서 합성 응답만 사용했고 운영 프로젝트의 파일은 조작하지 않았다. 현재 checkout을 유지한 채 `git archive 3aad026 desktop`으로 추출한 변경 전 UI에도 같은 fixture를 주입하여 전후 비교했다. [화면별 수용 표·PNG·접근성 기록](../evidence/desktop-ui-alignment/20261126-ui-001/README.md)을 보존한다.

- 포함 화면 01~11·13~14, 프로젝트 설정, 기존 v2 조회와 가져오기 접근을 확인했다. 질문/상담과 미지원 분야는 비활성이다.
- 1600×1000·1280×900·800×600 창 크기 요청, 밝음/어두움, 넓은 화면의 분할 및 좁은 화면의 단일 열, 스크롤 끝 주요 행동, 한국어 입력 유지와 Tab 포커스를 확인했다. 모든 화면×테마×크기의 전수 조합 검사를 주장하지 않는다.
- 빈 목록·응답 유실 안내·로딩 동안 선택 비활성·로딩 이후 정상 복귀, 권한 대기, 충돌 경로, 부분 반영/undo 접근, 과거 실패와 미실행 검사 구분을 확인했다.
- 사용자 지시로 **배율 변경 시험은 이번 수용에서 제외**한다. 사용 목표는 100%, 실제 이번 환경은 `RasterizationScale=1.25`였다. 100/150/200% 관측은 미실행이다. Windows 배율을 변경하지 않았다.
- 모의 19개를 다시 통과했다. 로딩 fixture는 5초인데 `Access.Idle`은 2초 후 예외를 던져 첫 시험 호스트가 종료됐다. 제품 변경 없이 시험 도우미 대기를 10초로 늘렸고 재빌드(경고 0/오류 0), 모의 19개 및 같은 GUI 로딩 복귀를 재확인했다. 실패 당시 증거도 보존했다.
- 변경 전/후 시험 앱 모두 종료되었으며 남은 Orchiva 프로세스가 없음을 확인했다. 소스와 실행 데이터의 삭제·초기화, 원격 반영은 하지 않았다.

### 상위 G01~G11과의 관계

| 항목 | 이번 근거 | 남는 범위 |
| --- | --- | --- |
| G01 | 연결 화면·진단 펼치기 접근 | 실제 실행부 시작과 콘솔 부재 시험은 미실행 |
| G02 | 지정 크기와 긴 한국어, 주요 행동 접근 | 배율 변경은 사용자 지시로 이번 검증 제외 |
| G03 | 합성 빈 목록·로딩·연결 오류 | 실제 빈 저장소와 복원 중 상태의 GUI 시험은 별도 |
| G04 | 요청 Tab 포커스, 목록/콤보 키보드, 밝음/어두움, 스크롤 | 전체 컨트롤의 키보드 전수 및 보조기술 시험은 미실행 |
| G05 | 합성 창 종료 확인 | 실제 앱 3회 종료/재열기·트레이·daemon 수명 시험은 미실행 |
| G06 | 초기화 미리보기·지침 파일/편집기·저장 접근 | 실제 파일 초기화/외부 수정 충돌의 GUI 전 과정은 별도 |
| G07 | 새/수정 요청·모델/수준·PLAN·확인·다시 읽기 접근 | 실제 모델 PLAN 생성과 외부 수정 전 과정은 별도 |
| G08 | 결과/검사/실패/검토 표시, 모의 확인란 초기화·재개 계약 | 실제 실행·중단·같은 세션 복구 GUI 시험은 별도 |
| G09 | 권한 내용/확인/응답 접근·응답 필요 표시, 모의 hash/중복 방어 | 실제 권한 및 재연결 장애 GUI 시험은 별도 |
| G10 | 차이/충돌/선택 반영/부분 반영/undo 접근, 모의 동일 키 계약 | 실제 파일 반영/되돌리기 GUI 시험은 별도 |
| G11 | 좁은/넓은 화면·테마·입력 유지·기본 키보드 확인 | 배율 변경은 사용자 지시로 제외, 전수 접근성 시험은 미실행 |

이 구분은 UI-A 완료를 상위 D1~D3의 모든 실제 연동 GUI 수용으로 확대하지 않기 위한 것이다. D4~D6는 시작하지 않았다. 이번 UI 작업과 무관한 `docs/design/roadmap-pipeline-review.md`는 그대로 보존했다.

## 이전 중간 기록 · 2026-11-17

- 날짜: 2026-11-17, Asia/Seoul
- 기준: `3aad0263a460b8155e33cf209d36758fea245c0a`, `codex/desktop-ui-alignment`
- 실행 근거: 사용자가 [UI-A PLAN](../plans/desktop-ui-alignment.md)을 승인하고 기능 변경 없는 UI 수정과 컴퓨터 유스를 허용했다.
- 판정: **UI 코드 및 비GUI 검증 완료, 시각 수용 대기**. PLAN 전체 완료가 아니다. 변경은 로컬이며 커밋·push하지 않았다.

## 적용 내용

네 Pivot의 내용을 프로젝트 목록·연결/초기화·작업 분야·요청·PLAN·실행/복구·결과·소스 반영·이력·지침·프로젝트 설정으로 나눴다. 단일 `ProductionWorkspace` 인스턴스 안에서 표시만 전환하며 기존 명령 처리와 4초 관측 타이머는 유지한다. 좌측 탐색, 본문/요약 카드, 좁은 폭의 단일 열, 줄바꿈 행동 영역, 테마 리소스와 설정 행을 적용했다. 결과와 검사·실패·검토 이력을 읽기 전용 카드로 표시하고 원문도 남겼다.

질문/상담과 미지원 분야는 비활성이다. SDK·런타임·RPC·영속 스키마·프로젝트 템플릿·실행 정책을 변경하지 않았다. 기존 v2 조회/가져오기, 확인란, 재개/대조/재시도, 선택 반영/부분 반영 이어 처리/undo를 유지했다.

## 검증 결과

| 종류 | 절차 | 결과와 한계 |
| --- | --- | --- |
| 정적 | `npm run desktop:build` | 최종 빌드 성공, 경고 0/오류 0. 첫 빌드에서 Grid 자식의 형식 오류가 있었으며 FrameworkElement 변환 후 해결 |
| 정적 | `npm run typecheck` | 통과 |
| 정적 | 기존 XAML 및 명령 소유 코드 비교 | 기존 이름 있는 컨트롤 46개, Action Tag 30종 누락 0. `Identity`, `Command`, `Mutate`, `RequireSavedInput`, `Input` 원문 동일. [정적 근거](../evidence/desktop-ui-alignment/20261117-ui-001/static-audit.json) |
| 모의 | 별도 WinUI 테스트 호스트에서 실제 화면 클래스와 `Connect` 주입 경계 실행 | 19개 통과. 입력 payload, 이동 시 RPC 0, 동일 타이머, 응답 유실 키 재사용, 확인/미저장 방어, 새 결과 확인란 초기화, 권한 hash, 선택 반영/부분 처리/undo, busy와 부모 연결. [호출 및 결과](../evidence/desktop-ui-alignment/20261117-ui-001/mock-results.json) |
| 자동·격리 연동 | `ORCHIVA_DESKTOP_CONFIG`에 새 격리 fixture 지정 후 `npm run desktop:test` | 기존 C# 13개 통과, 실패 0, skip 0. UI 클릭 시험이나 실제 모델 제작 시험은 아님 |
| GUI · 변경 전 | 기존 exe를 같은 격리 config로 실행 | [작업실](../evidence/desktop-ui-alignment/20261117-ui-001/before/02-workspace.png), [설정](../evidence/desktop-ui-alignment/20261117-ui-001/before/13-settings.png) 확보. 실행부 미시작에 따른 연결 실패 상태 |
| GUI · 변경 후 | 새 합성 호스트 실행 후 창 탐색 시도 | **사용자의 물리 Escape 입력으로 Computer Use 중지**. 이후 화면 도구 호출 없음. 변경 후 캡처·키보드·폭/테마/DPI 수용은 미실행. 호스트가 보고한 현재 rasterizationScale은 1.25이며 다른 DPI 확인을 의미하지 않음 |

합성 호스트는 [별도 프로젝트](../../desktop/Orchiva.Desktop.UiTests/Orchiva.Desktop.UiTests.csproj)이며 제품 앱에 시험 버튼이나 합성 데이터가 포함되지 않는다. 제품 XAML/C#을 링크하고 브리지 연결 전에 `options`를 비워 실제 RPC·모델·파일 반영을 차단한다. 신규 테스트 lockfile은 제품 lockfile과 동일 내용이며 기존 lockfile은 변경하지 않았다. 테스트 호스트의 반영·판정 호출은 메모리 모의 응답만 사용한다.

## 재현과 남은 검증

실행 home은 `C:/Users/USER/lib/orchiva-plugin/.desktop-local/d1-20261117-ui-001`이다. 이 경로는 이번 PC의 시험 자료이며 다른 PC에서는 새 ID로 `desktop:verify prepare`를 실행한다. 운영/RNG 프로젝트는 사용하지 않았다. 모델·Agent·Worktree 생성은 0건이다.

```powershell
dotnet build desktop/Orchiva.Desktop.UiTests/Orchiva.Desktop.UiTests.csproj -p:Platform=x64 -p:RestoreLockedMode=true
$env:ORCHIVA_DESKTOP_CONFIG = (Resolve-Path '.desktop-local/d1-20261117-ui-001/desktop.json').Path
$env:ORCHIVA_UI_EVIDENCE = (Resolve-Path 'docs/evidence/desktop-ui-alignment/20261117-ui-001').Path
# 기존 증거를 보존하려면 재실행 때 새 evidence 디렉터리를 지정한다.
& .\desktop\Orchiva.Desktop.UiTests\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64\Orchiva.Desktop.UiTests.exe
```

GUI를 다시 허용하는 사용자 입력 이후 포함 화면 13개를 시안과 대조하고, 빈 목록·긴 경로·오류·수정 요청·권한/부분 반영 상태, 1280×900/800×600 및 넓은 폭, 밝음/어두움, 키보드와 100/125/150/200% DPI를 확인한다. 지금은 실제 잘림·대비·탭 순서·도달 가능성을 통과 처리하지 않는다. 동일 데이터의 전체 전후 비교도 아직 없다. 상위 PLAN의 기존 G01~G11을 이 모의 결과만으로 완료 처리하지 않는다.

백업은 `C:/Users/USER/AppData/Local/Temp/orchiva-ui-alignment-20261117-baseline`에 있으며 최초 문서 변경까지 포함한다. 모델이 필요한 제작 시험과 과거 요청 데이터 의존 verify/lifecycle은 이번 UI 범위에 필요하지 않아 실행하지 않았다.

정리: 시험 소유 daemon은 `desktop:verify stop d1-20261117-ui-001`로 종료했고 fixture/기존 요청 해시 불변을 확인했다. 합성 UI 호스트는 실제 연결 없이 열린 상태로 남겨 두었다. [연동 결과](../evidence/desktop-ui-alignment/20261117-ui-001/bridge-verify.json)와 [최종 요약](../evidence/desktop-ui-alignment/20261117-ui-001/summary.json)을 보존한다.
