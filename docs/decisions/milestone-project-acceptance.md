# MA6 두 게임의 Phase 수용

2026-11-26 · Windows x64 · Unity 6000.3.27f1 · Unity CLI 1.1.0 · Node 24.19.0 · Paseo 0.15.4 · Orchiva 작업 트리 HEAD `3aad026`

두 격리 게임에 `unity-level-v1`을 적용했다. 로드맵에 등록한 역할별 검사 원본과 출력 경로를 고정하고, 기획 → 레벨 → 코드 → QA 순으로 실제 제작했다. 두 게임은 같은 역할과 검사 경로를 쓰며 각자 다른 내용의 검사와 레벨, 별도 Git 저장소와 실행 이력을 갖는다. 게임별 결과·검사 지문, 모든 인계의 입력 ID, 빌드 전체 해시, Phase 결정과 후속 PLAN은 [검증 원장](../evidence/milestone-automation/MA6/d1-ma-accept-20261126-001/acceptance.json)에 있다.

| 게임 | 프로젝트별 필수 조건과 실제 Windows Player 결과 | 승인된 통합 커밋 | Play 구간 소요 / 호출 |
| --- | --- | --- | --- |
| Lantern Maze | 별 조건 없이 출구에 진입. 경계 밖 이동 차단, 4회 이동 후 클리어 | `ca457637dc9274698aae72472ea0d5115372d40b` | 22분 / 11회 |
| Star Orchard | 별 2개를 모두 모으면 출구에 진입. 경계 밖 이동 차단, 별 2개와 6회 이동 후 클리어 | `a3df3e8c6f3bf40b0426077a0cde97c3c87b59fa` | 16분 50초 / 10회 |

각 게임에서 서로 다른 실제 세션 네 개를 확인했다. Unity가 임포트한 레벨 파일, 이동 처리 코드, QA 결과를 커밋별로 대조했다. 두 게임 각각 Feature 검사 4건, Unity EditMode 2건, PlayMode 1건을 통과했다. Win64 BuildReport와 실행 중인 Player의 결과를 수집하고 전체 빌드 파일의 SHA-256 목록을 다시 계산했다. 서비스는 승인 대상 커밋의 레벨 경로를 독립적으로 재생해 Player의 이동·수집·클리어 결과와 대조한다.

사용자가 두 빌드의 검증 결과와 Player 경로를 확인할 수 있는 상태에서 **두 게임 모두 승인**을 선택했다. 작업실에서 각각 그 빌드 지문에 결정을 기록한 뒤 `Polish / Tune` 실행을 만들었다. 새 실행의 Git 시작점, 첫 Feature의 PLAN 입력과 승인 원장을 대조했다. 호출 수는 조율 PLAN을 포함한 PLAN·시작·재개 요청 수이며 청구 금액은 제공되지 않았다. 별도의 수동 조작감 점수는 수집하지 않았다.

## 실패·복구·거부 검증

- 두 프로젝트 모두 최초 승인 전 `Polish` 생성을 거부했다. 진행 중인 실제 작업실에서도 승인 버튼이 비활성화됐다.
- 미로의 코딩 세션을 중단했다. 원래 실패 결과를 보존한 채 같은 세션에서 재개해 검사에 통과했다. 다른 검증 홈에 활성 run을 복사하고 같은 프로젝트 ID로 재등록하자 기존 로컬 자원이 없다는 메시지가 표시됐다. 자동 배정은 0건이었다. 동일 PC의 별도 홈으로 이전 조건을 재현했다.
- 작업실에서 수용하지 않은 범위 밖 선행을 조회하고 원본을 지정해 선택 구간을 재실행했다. 복구 시험의 최초 고정 검사에 줄바꿈 표기 오류가 있어 해당 Feature가 실패했다. 시험 검사를 수정하자 기존 범위 재개가 거부됐고 새 범위로 재실행했다. 이 실행은 EditMode·PlayMode 후 잘못된 HUD 참조로 실제 빌드에 실패했다. BuildReport 오류 3건과 부분 구간 승인 차단을 작업실에서 확인했다.
- 녹색 빌드의 **격리 복제본**에서 작업실 반려 → 다음 Phase 거부, 시험 승인 → 같은 명령 재호출 시 결정 1회, 정책 개정 → 이전 승인 무효를 확인했다. 두 본 시험 게임의 승인 원장은 각각 실제 사용자 결정 한 건만 포함한다. [복구·반려 증거](../evidence/milestone-automation/MA6/d1-ma-accept-20261126-001/recovery.json)
- 프로필의 미지원 분야, 필수 검사 누락, 역할의 경로 제한, 프로필 제거, 결과 신호 불일치와 v2/v3 기존 경로를 회귀 검증했다. 개별 Feature 기본 흐름은 기존 계약을 사용한다.

## Polish / Tune 후속 실행

2026-11-26 사용자 요청에 따라 이전 수용 원장에 저장한 두 `TunePass` PLAN 해시를 대조한 후 기존 요청을 한 번씩 실행했다. 두 PLAN의 산출물은 플레이테스트 조정 항목을 기록하는 `tuning.json`이다. 두 통합 커밋에서 부모 대비 이 파일 하나가 추가됐으며 값은 모두 `{"tuning":"playtest"}`였다.

| 게임 | 승인한 Play 커밋 → Tune 통합 커밋 | 새 커밋에서 재실행한 검사 | 실제 Win64 Player |
| --- | --- | --- | --- |
| Lantern Maze | `ca457637` → `b69049de` | 프로젝트 5/5, EditMode 2/2, PlayMode 1/1 | 경계 밖 이동 차단, 4회 이동 후 클리어 |
| Star Orchard | `a3df3e8c` → `4a6be1ca` | 프로젝트 5/5, EditMode 2/2, PlayMode 1/1 | 경계 밖 이동 차단, 별 2개 수집과 6회 이동 후 클리어 |

두 Windows 빌드 모두 오류 0건이며 Player가 정상 종료했다. 실행별 XML·로그와 전체 배포 파일의 지문을 대조했고, 두 Player에서 HUD 점수가 0에서 10으로 바뀌었다. 처음 PoC 실행기가 작업 폴더의 PLAN·지침 파일까지 게임 산출물로 세어 검토 단계에서 멈췄다. 게임 산출물은 Git 통합 전후 차이로 확인하도록 고친 뒤 같은 결과에서 이어갔다. 각 Feature의 제작 세션과 시작 명령은 한 건이었다. 두 Tune 구간의 기술 검증이 완료됐고 Polish 빌드의 사람 판정은 별도 단계다. [커밋·검사·Player 증거](../evidence/milestone-automation/MA6/d1-ma-accept-20261126-001/polish-tune.json)

두 게임의 기존 `ready` PLAN은 PoC 실행기의 `run-tune <trial> maze`와 `run-tune <trial> orchard`로 실행한다. [Tune 검증기](../../scripts/milestone-tune-report.mjs)는 통합 브랜치, 보존한 검사·빌드·Player 자료를 대조하고 각 체크아웃에서 프로젝트 검사를 다시 실행한다.

2026-11-26 사용자가 두 Polish 빌드를 승인했다. Lantern Maze의 `b69049de`와 Star Orchard의 `4a6be1ca`에 대해 배포 지문을 대조한 뒤 각 프로젝트의 Polish 실행 원장에 `approve`를 기록하고 다시 조회했다. 두 로드맵 모두 Polish가 마지막 Phase다. [게임별 승인 기록](../evidence/milestone-automation/MA6/d1-ma-accept-20261126-001/polish-decisions.json)

## 사용과 재현

[작업실 사용 안내](../guides/milestone-phase-review.md)에 게임 등록, 역할 프로필 적용, 승인과 복구 절차를 정리했다. [PoC 실행기](../../scripts/milestone-acceptance-poc.mjs)는 준비한 빈 `d1-ma-accept-…` 홈에서 게임별 `seed`, `create`, `run`, `review`를 실행한다. `decide` 또는 작업실의 승인에는 검토자가 확인한 실제 근거 지문과 사유를 사용한다. 이후 `next`로 새 실행을 만들고 첫 PLAN이 준비되면 [보고서 검증기](../../scripts/milestone-acceptance-report.mjs)로 두 게임의 전체 계보를 확인한다.

Player 실행 파일과 데이터 폴더, 원본 로그, Unity XML, BuildReport는 시험 홈에 보존한다. 아트·음원·VFX 제작 도구는 D5 대기 항목이다. 새 물리 PC에서의 설치·라이선스·세션 복원과 패키징은 D6에 인계한다.
