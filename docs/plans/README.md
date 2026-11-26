# Orchiva 구현 계획 목록

기존 제품 범위는 [MVP 설계](../design/mvp-design.md), 후속 방향은 [데스크톱 인계](../design/desktop-handoff.md)와 [전환 설계안](../design/desktop-transition.md), 작업 절차는 [공통 흐름](../agents/workflow.md), 계획 작성·상태 규칙은 [계획 규칙](AGENTS.md)을 따른다.

2026-11-26 통합 인계 및 현재 PC 후속 시험 완료. MA1~MA6와 두 게임의 Polish 승인은 완료했으며 MA3 독립 리뷰는 후속이다. D6 원격·로컬 조사를 합치고 실제 PLAN·제작·상담, 창 종료/실행부 재시작 복원, 로컬 통신 장애/복구와 정리를 확인했다. 통합 WinUI의 100/150/200% 조작과 키보드 일부도 관측했다. 사용자 결정으로 깨끗한 설치/VM과 PC 재부팅은 후속이며, G01 순간 콘솔·G04 전체 경로 등 미관측 범위는 [D6 상세 PLAN](desktop-fresh-pc-validation.md)에 남겼다.

## 등록된 계획


| 순서 | 계획 | 상태 | 실행 범위 |
| --- | --- | --- | --- |
| 1 | [M0 실행 기반 확인](m0-runtime-foundation.md) | `completed` | 브라우저 없는 연결, 생성·전송 대조, 기준 커밋 고정, 종료 처리 |
| 2 | [M1 저장·상태·실행 슬롯](m1-storage-state.md) | `completed` | v2 마이그레이션, 결과·판정·명령 이력, 프로세스 소유권과 단일 실행 슬롯 |
| 3 | [M2 초안·계획·실행](m2-draft-plan-start.md) | `completed` | 구조화 초안, 계획 확인, 기준 커밋 검증과 고정 SHA 실행 |
| 4 | [M3 진행·관측·복원](m3-progress-reconciliation.md) | `completed` | 독립 관측 루프, 재시작 대조, 요약 목록과 진행 상세 |
| 5 | [M4 조건별 판정·과거 결과](m4-evidence-review.md) | `completed` | 조건별 근거, 검사 변경, 결과 상세와 지문 확인 |
| 6 | [M5 실패·재개·중복 명령](m5-recovery.md) | `completed` | 실패별 복구, 초기 재시도, 미확정 대조, 동일 세션 재개 |
| 7 | [M6 통합 수용·장애·성능·사용 안내](m6-acceptance.md) | `completed` | A01~A16 수용, 저장/전송/프로세스 장애, 100건·30회 성능 및 30분 운영, 안내·사람 첫 사용 확인 |
| 8 | [데스크톱 전환 D1~D6](desktop-transition.md) | `active` | D1~D5 및 D6 기존 PC 검증과 통합 후 현재 PC N04/N06/N07 통과, N05 부분 통과. 깨끗한 설치/VM·재부팅·GUI 잔여·정식 공개 배포 조건은 후속 |
| 9 | [MA1 로드맵 구간과 실행 입력 고정](milestone-scope.md) | `completed` | 선택 구간·Feature 1~5개·의존성·지침을 고정하고 작업실에서 미리보기 |
| 10 | [MA2 Milestone 조율과 로컬 직렬 실행](milestone-local-run.md) | `completed` | 단건과 공존하는 한 슬롯 실행, Milestone별 조율, 결과 인계·재개까지 로컬 PoC |
| 11 | [MA3 로컬 Git 통합과 GitHub 동기화](milestone-git-integration.md) | `completed` | [1인 승인으로 최신 필수 검사·PR 병합·Issue 종료 5/5](../decisions/milestone-git-integration.md). 실제 독립 리뷰 수용 항목은 미검증으로 보존 |
| 12 | [MA4 자원 충돌을 고려한 제한 병렬 실행](milestone-parallel-execution.md) | `completed` | [A·B 실제 병렬, 공용 Scene 대기, A → B → C 로컬 통합과 고정 검사 3/3](../decisions/milestone-parallel-execution.md) |
| 13 | [MA5 Unity 통합 검사·빌드와 플레이 검증](milestone-unity-validation.md) | `completed` | [MA4 통합 SHA의 Unity 검사·Windows Player 실행·실패 후 인계 복구](../decisions/milestone-unity-validation.md) |
| 14 | [MA6 분야별 프로필 재사용과 프로젝트 수용](milestone-project-acceptance.md) | `completed` | [두 게임의 검사·Player·사용자 승인과 다음 Phase 인계](../decisions/milestone-project-acceptance.md) |
| 15 | [D6 새 PC 설치·로그인 검증](desktop-fresh-pc-validation.md) | 8번 `active`에 통합 | 원격·로컬 기록 통합, `d6b-20261126-current-001` 정리 완료. 실제 3턴·중복 없음·로컬 통신 복구·100/150/200% 관측. N01~N03/VM·N05 재부팅은 사용자 결정으로 후속, G01/G04 등 잔여 명시. [근거](../decisions/desktop-fresh-pc-validation.md). 독립 active PLAN 아님 |

**Milestone 자동화 구현 순서 (2026-11-26).** [기술 검토서](../design/roadmap-pipeline-review.md)를 여섯 개의 구현 PLAN으로 나눴다. MA1→MA2에서 GitHub 없이 단일 슬롯 로컬 PoC를 끝내고, MA3에서 통합 기준 SHA를 만든 뒤 MA4의 병렬 실행, MA5의 Unity 검증, MA6의 두 게임 수용으로 이어간다. 데스크톱 전환을 보류한 뒤 MA1·MA2를 순서대로 검증했다. D4 상담은 선행 조건이 없고, D5의 제작 도구와 D6의 설치·배포는 해당 단계의 인계 지점에서 연결한다.

각 MA 단계의 검증 표는 구현 시 실행할 시험이다. 변경에 맞춰 `npm run typecheck`, `npm test`, 데스크톱 변경 시 `npm run desktop:build`와 격리 설정의 `npm run desktop:test`를 사용한다. 실제 시험은 새 실행 ID, 허용 저장소·프로세스, 모델 호출·시간·디스크 예산을 먼저 기록한다. 공유용 근거의 예정 위치는 `docs/evidence/milestone-automation/<단계>/<실행 ID>/`다. 명령·기대값·실측·미실행 사유를 해당 PLAN에 기록하고 자격 증명과 비공개 원문은 제외한다. 이번 등록은 계획 문서 작성 범위다.

2026-11-17 후속 승인으로 [UI-A](desktop-ui-alignment.md)를 위 8번 데스크톱 전환의 상세 실행 단계로 통합했다. 별도 proposed 등록 행은 이 문단으로 대체하며 active 계획은 8번 하나다. UI 코드·빌드·모의 19개·격리 C# 13개 검증을 마쳤으나 변경 후 화면 확인은 물리 Escape 입력으로 Computer Use가 중지되어 대기한다. [중간 결과](../decisions/desktop-ui-alignment.md). UI-A 완료가 아니며 아래 최초 proposed/GUI 대기 기록은 승인 전 이력이다.

2026-11-17 사용자의 기능 변경 없는 UI 보정 PLAN 요청에 따라 UI-A를 작성했다. 현재 UI 소스와 저장된 시안 14개·역사적 D1 화면 3개를 대조했으며 현재 D2~D3의 새 화면 관측은 하지 않았다. 상위 데스크톱 전환은 `active`로 유지하고 UI-A는 `proposed`다. 컴퓨터 유스 대기와 D4~D6 미착수는 그대로다.

2026-11-16 사용자의 환경 점검·설계·계획 요청에 따라 [현재 PC 준비 점검](../decisions/desktop-readiness-20261116.md)과 데스크톱 전환 설계·계획을 작성했다. main의 `b08dc13`에서 ff-only 갱신 후 원격 차이가 없었고, lockfile 기반 설치·typecheck·89개 테스트가 통과했다. 초기 보류 후 사용자는 WinUI 3 + .NET 10과 첫 단계부터 디자인, B안 선택 적용, 프로젝트별 docs/의 지침·PLAN·결정/작업 이력 관리를 확정했다. 후속 선택으로 제작 PLAN은 정형 입력 → AI의 템플릿 내 내용 작성, 닫기 버튼은 앱 종료/트레이 최소화 설정으로 확정했다. Git 없는 폴더 제작은 보류하고 상담 PLAN 자동 완성은 구현 범위에서 제외한다. 최초 문서 작성 요청에서는 앱 구현이 제외되어 당시 `proposed`로 등록했다. 이후 PLAN 승인으로 D1을 진행하며 현재는 `active`다. 앱에서 관리할 대상 프로젝트는 프로젝트 추가 → 소스 경로 지정 → 초기화로 루트 AGENTS와 docs/ 지침·계획·결정·근거 구조를 생성한다. 루트 단일 AGENTS와 역할별 지침 규칙은 대상 프로젝트의 제품 정책이며 Orchiva 개발 저장소의 지침 변경 지시가 아니다.

2026년 11월 12일 사용자의 지시에 따라 M0~M5를 완료했다. 소스 초기 커밋은 `7a675a9`, M0는 `4397aaf`, M1은 `bd08ace`, M2는 `ca31b4c`, M3는 `efcb9ad`다. [M1 결과](../decisions/m1-storage-state.md)에 실제4건 변환, [M2 결과](../decisions/m2-draft-plan-start.md)에 계획 확인 실행, [M3 결과](../decisions/m3-progress-reconciliation.md)에61개 테스트와 브라우저 없는 실행·진행 중 Plugin 복원·정상 daemon 재시작·기존6건 보존을 기록했다. [M4 결과](../decisions/m4-evidence-review.md)에70개 테스트·조건별 판정·과거 결과 상세·실제 재검증·기존7건 보존을 기록했다. [M5 결과](../decisions/m5-recovery.md)에 83개 테스트, 실제 준비 실패·응답 유실 대조, 동일 세션의 실패→재개→수정 요청→재개→완료, 격리 미확정 UI와 기존 8건 보존을 기록했다.


2026-11-12 M6 상세 계획을 작성했다. 2026-11-13 사용자의 구현·통합 수용·장애 시험·성능 측정·사용 안내 요청에 따라 `active`로 전환했다. 실행 ID `m6-20261113-001`, 기준 커밋 `a74f8bd`, 개발 브랜치 `codex/m6-integrated-acceptance`; 전체 요청·설정 기준선은 `%USERPROFILE%/.orchiva/m6/m6-20261113-001`에 보존했다. 세부 결과는 [M6 계획의 실행 기록](m6-acceptance.md#실행-및-검증-기록)과 최종 [M6 결정 기록](../decisions/m6-acceptance.md)에 추가한다.

2026-11-13 M6 구현과 시험 도구를 추가했다. `npm test` 88/88, typecheck, verify/lifecycle, M2/M3/M5 verify가 통과했다. P01/P04/P05, D03/D05/D06, A11도 통과했으나 P02 표본 수, P03, 여러 실제 GUI·장애 경계가 미완료다. [M6 결과 기록](../decisions/m6-acceptance.md)과 [요약 JSON](../evidence/m6-acceptance-20261113.json)에 부분·미실행 항목을 표시했으며 M6는 `active`로 남긴다. 작업은 `codex/m6-integrated-acceptance`에만 있고 원격 push/merge는 하지 않았다.

2026-11-13 사용자의 남은 사항 전체 실행 지시에 따라 `m6-20261113-002`로 보완을 완료했다. 89개 테스트와 기존 verify, 실제 S/F/M/C·브라우저 없는 실행·UI 중단/재개·TCP 장애·checkpoint/migration/owner 경계, 실제 RPC 성능과 30분 single-flight를 확인했다. 기존 42건·GUI 2건을 보존하고 신규 Agent/Workspace 각 8개로 M6 총 예산 40개를 지켰다. 사용자가 초안 복원과 검사 로그·완료 판정 찾기를 확인했다. 빈 데이터 안내·53건 사본 복원도 통과했다. [최종 결과](../decisions/m6-acceptance.md)와 [요약 JSON](../evidence/m6-acceptance-20261113.json)에 실제/모의 범위·측정 오차·정리 결과를 남겼다. 이전 부분 기록은 당시의 이력이며 현재 상태는 `completed`다. 검증 완료 당시 구현·보완은 로컬 브랜치에 있었으며, 이후 사용자가 전체 변경의 커밋·main 반영·push를 요청했다. 최종 반영은 Git 이력과 origin/main을 따른다.

## 후속 단계

현재 D4 변경은 `main`의 `f080480` 이후 로컬 소스·문서에 저장했으며 이번 변경은 commit/push하지 않았다. D1~D3의 최종 반영은 Git 이력을 따른다. 아래 원격 반영 요청은 이전 작업의 이력이다.

2026-11-16 사용자가 당시까지의 데스크톱 전환 작업을 커밋하고 main에 반영·push하도록 지시했다. D1~D3 소스·설계·계획·공유용 검증 근거를 포함하며 로컬 실행 데이터와 빌드 산출물은 제외했다. 검증 시점의 미커밋 기록은 당시 이력으로 보존한다. 그 원격 반영 시점에는 GUI G01~G11 대기와 D4~D6 미착수 상태였으며, 이후 GUI 검증의 현재 상태는 위 목록을 따른다. 원격 반영 결과는 Git 이력과 origin/main을 따른다.

다음은 설계상의 순서다. 상세 계획을 작성할 때 위 목록에 등록하며, 이 표만으로 구현 상태나 승인을 나타내지 않는다.

| 단계 | 범위 | 선행 입력 |
| --- | --- | --- |
| M1 | 저장·상태 모델, v2 마이그레이션, 명령·결과·판정 이력, 실행 슬롯 | M0의 연결·멱등성·복원 제약 |
| M2 | 요청 초안, 완료 조건·검사 편집, 계획 확인과 실행 | M1 계약과 상태 모델 |
| M3 | 목록·진행 화면, 백그라운드 대조와 재시작 복원 | M0 연결 수명, M1 상태, M2 실행 |
| M4 | 결과·조건별 판정·재검증·검사 변경 표시 | M1 결과 이력과 M3 관측 |
| M5 | 초기 재시도·동일 세션 복구·명령 중복 제거 | M0 전달 정책, M1·M4 이력 |
| M6 | 통합 수용·장애 시험·측정·사용 안내 | M1~M5와 설계의 A01~A16 |

## 하네스 설정 기록

하네스는 Plugin 루트 지침 지도, 공통 작업·소스·검증 규칙, 문서·계획 규칙과 템플릿으로 구성한다. sandbox에는 역할과 Plugin 지침 연결을 둔다.

2026-11-12 하네스 작성 당시 정적 검증: 관련 문서 14개, 로컬 링크 57건의 대상 존재, 인코딩·코드 블록, M0 템플릿 절·상태 일치, 기존 npm 검증 명령 존재를 확인하여 통과했다. 당시에는 문서·Git 연결만 설정했고 런타임 시험은 미실행이었다. 이후 사용자의 구현 지시에 따라 M0 시험을 수행했으며 실행 결과는 위 계획과 결정 문서에서 관리한다.

M6 계획 작성 정적 검증(2026-11-12): Markdown 27개·로컬 링크 152건 대상 존재, 템플릿 절·A01~A16/D01~D08/P01~P05 누락 없음, proposed 상태 일치, 인코딩·코드 블록·기존 명령 존재 및 예정 m6 명령 미등록 확인. 변경은 계획 문서 2개이며 런타임 검사·M6 구현·실제 시험은 실행하지 않았다.
