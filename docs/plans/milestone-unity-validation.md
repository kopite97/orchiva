# MA5 Unity 통합 검사·빌드와 플레이 검증

- 상태: `completed`
- 작성일: 2026-11-26 · Asia/Seoul
- 관련 설계: [로드맵 파이프라인 검토](../design/roadmap-pipeline-review.md) · [실행 순서](README.md)
- 선행 조건: [MA3](milestone-git-integration.md)의 통합 SHA, [MA4](milestone-parallel-execution.md)의 자원 예약. 시험 프로젝트의 Editor 버전, 패키지 잠금, 빌드 대상·모듈·라이선스와 플레이 수용 신호를 확인한다.
- 실행 근거: 사용자가 검토안에 기반한 구현 PLAN 작성을 요청했다. 2026-11-26 사용자가 구현과 MA4 통합 결과에 대한 실제 로컬 Editor·Player 검증을 지시했다. 새 MA5 격리 폴더, Windows x64, Editor 1개, 모델 호출 0건, 단계별 10분·작업별 8 GiB 한도로 시험한다.

## 목표

작은 Unity 게임에서 PLAN별 검사와 Milestone별 통합·빌드·실행 검사를 구분한다. 검토자는 어떤 버전의 게임이 어떤 시나리오를 통과했는지 결과 화면에서 확인한다.

## 현재 근거와 확인할 사항

현행 [파일/Node 검사](../../server/adapters/storage/evidence.ts)와 [스냅샷](../../server/application/desktop/snapshots.ts)은 입력 1,000파일·합계 16 MiB 등의 한도가 있다. Unity 시험은 기존 작은 파일/Node 검증의 성공만으로 수용할 수 없다. 검토서 6.4의 Unity 공식 문서는 참고 버전이며 실제 옵션은 시험 프로젝트에 맞춰 확인한다.

## 범위

기존 프로필과 분리한 Unity 검증기, 기준 SHA에서의 대형 입력·로그·빌드 보관, Editor 1개와 한 대상 플랫폼부터 적용한다. 실제 생성은 격리 프로젝트의 시험 Worktree와 Player 빌드에 한한다. 시험 소유 프로세스의 실행 실패·중단은 포함하고 앱 스토어 배포·서명 키 사용은 제외한다.

## 작업 순서와 산출물

| 순서 | 변경할 파일 또는 예정 위치 | 수행 내용 | 산출물 |
| --- | --- | --- | --- |
| 1 | 기존 `snapshots.ts`, `artifacts.ts`, 예정 엔진 검증 계약 | 작은 단건의 기존 미커밋 overlay를 보존한다. 관리 브랜치 모드는 깨끗한 커밋·선별된 필수 문서·콘텐츠 해시 참조로 입력을 구성하고 LFS 실체 유무, .meta 동반 이동/삭제, GUID 충돌을 검사한다. 큰 결과를 base64로 RPC에 싣지 않고 근거 위치와 해시를 반환한다. | 버전 있는 엔진 입력·결과 manifest |
| 2 | 예정 `server/adapters/unity/` 및 gate 서비스 | ProjectVersion·패키지/잠금·플랫폼과 시간/디스크 한도를 고정한다. 허용된 실행 파일과 인수로 Batch Mode 및 EditMode/필요 PlayMode 시험을 실행한다. 고정 테스트 목록·XML 수·skip·종료 코드·로그를 대조한다. 검증 원본과 결과 저장 위치는 제작 권한에서 분리한다. | PLAN/Integration별 결과·참조 검사 |
| 3 | Milestone gate, WinUI 결과 상세 | 최종 통합 SHA에서 BuildPipeline 기반 빌드를 수행해 대상·BuildReport·빌드 해시를 확인한다. 생성한 Player로 첫 장면→점수 획득→HUD 갱신을 실행해 시간 내 기대 신호를 대조한다. 필수 게이트 통과 후 다음 Milestone을 연다. | 빌드·플레이 근거·다음 단계 인계 |

## 검증 계획

| ID | 종류 | 조건과 절차 | 기대 결과 | 보존할 증거 |
| --- | --- | --- | --- | --- |
| MA5-V01 | 모의·파일 | 버전/모듈 부재, 테스트 0개·skip·삭제·검증 스크립트 변조, GUID 누락, 로그 잘림·시간 초과·오래된 XML 주입 | 오류/미실행/실패 구분. 조건 완화·오래된 결과로 게이트 통과 0 | 고정 프로필·차단 사유 |
| MA5-V02 | 실제 연동 | 격리 Editor에서 고정 SHA에 대해 EditMode·지정 PlayMode와 참조 검사, 한 플랫폼 빌드 및 빌드한 Player smoke 수행. cold/warm import 및 Worktree별 Library 사용량 측정 | 동시 Editor 최대 1. BuildReport·실행한 바이너리 해시·점수 시나리오 신호 일치 | 환경/시간/최고 공간, XML·로그·빌드 해시 |
| MA5-V03 | 실제 장애·GUI | 잘못된 Scene 참조 또는 의도한 빌드 실패로 다음 Milestone 차단을 관측한다. 수정된 통합 SHA에서 재검증하고 결과 화면 비교 | 실패 빌드 후 다음 배정 0, 기존 승인/실패 유지, 새 SHA의 smoke 후에만 인계 | 실패/수정 SHA 쌍·전이 기록·화면 |

## 실패 처리와 복원

Editor·Player마다 경로·PID·시도 ID를 저장해 해당 프로세스만 정리한다. 라이선스/환경 문제는 환경 복구 후 같은 SHA 재검사, 콘텐츠 문제는 수정 PLAN 후 새 SHA로 재실행한다. 증거 불완전·예산 초과는 미통과로 남긴다.

## 완료 조건

- [x] 대표 입력 한도 초과 사례가 명시적으로 처리되고 기존 단건 snapshot 재현성이 유지된다.
- [x] 실제 시험 플랫폼에서 빌드 실행·smoke 성공과 실패 후 차단/복구를 모두 확인한다.
- [x] 위 검증 결과와 미실행 범위를 기록하고 [계획 목록](README.md)과 본문의 상태를 함께 갱신한다.

## 실행 및 검증 기록

| 날짜 | 변경 기준점 | 실행한 절차 | 실제 결과와 증거 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 2026-11-26 | Windows 작업 트리 · HEAD `3aad026` 및 로컬 UI-A 완료분 | 검토안·현행 계약과 단계 경계 대조 | 구현 전 문서 검토. 제품 시험 결과는 아직 없음 | 위 구현 및 검증 |
| 2026-11-26 | MA5-V01 · 타입·파일·모의 | 누락 모듈/Editor, 고정 소스·XML·로그, GUID·rename·LFS와 17 MiB 입력 검증 | 서버 127/127, 타입 검사 통과. 고정 SHA의 선택 입력과 기존 단건 한도 구분 | [검증 범위](../decisions/milestone-unity-validation.md) |
| 2026-11-26 | MA5-V02 · 실제 Windows x64 | 격리된 Unity 6000.3.27f1에서 MA4 B·C 통합 SHA를 검사하고 C Player 실행 | C에서 EditMode 2/2, PlayMode 1/1, BuildReport 성공·오류 0, 첫 장면과 SCORE 0 → SCORE 10, 종료 0. 별도 17 MiB 에셋 포함 네이티브 프로젝트의 PLAN 검사 1/1 | [시도별 근거](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/validation.json) |
| 2026-11-26 | MA5-V03 · 실제 장애·GUI | B의 Scene 라벨 오류로 빌드 실패, C에서 복구. 별도 시도에서 비활성 Player 시간 초과 후 D3D11 배치 모드로 재검증. WinUI 800·1280에서 결과 대조 | B 다음 배정 0, C 성공 후 후속 예약. 기존 승인·실패 결과 보존. 격리 브리지 13/13, 제품·UI 검증 앱 빌드 경고·오류 0 | [결과와 재현 절차](../decisions/milestone-unity-validation.md) |

## 결정과 후속 작업

추가 플랫폼과 캐시 공유는 실측을 근거로 결정한다. [MA6](milestone-project-acceptance.md)에서 프로젝트별 필수 게이트와 사람의 Phase 판정을 연결한다.
