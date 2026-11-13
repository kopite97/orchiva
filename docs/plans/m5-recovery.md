# M5 실패·재개·중복 명령 처리

- 상태: `completed`
- 작성일: 2026-11-12 · Asia/Seoul
- 관련 설계: [MVP](../design/mvp-design.md), [M4 결과](../decisions/m4-evidence-review.md)
- 선행 조건: M0~M4 완료, 기준 커밋 `3104e97`, 기존 요청 8건
- 실행 근거: 사용자의 M5 상세 계획 작성·구현·검증 지시. 브라우저 UI와 로컬 daemon 구조 유지, exe 패키징 제외.

## 목표

실패 원인에 맞는 초기 재시도·검증 재실행·동일 세션 수정 재개를 제공하고, 중복 명령과 전달 미확정 상황에서도 TASK·Worktree·세션·과거 결과의 정체성을 유지한다.

## 현재 근거와 확인할 사항

M4까지 70개 테스트와 실제 조건별 완료 판정을 검증했다. 기존 resume/revalidate는 명령 중복 제거가 있으나 신규 resume에 revision·대상 결과가 필수가 아니고, 초기 준비 실패를 재시도하는 UI가 없다. 초기 외부 생성 중단은 unknown으로 보존하나 실제 리소스 대조 경로가 연결되지 않았다. 검증 수집에 실패해 결과가 없는 경우 재검증 버튼도 없다. M0에서 복원 이력의 messageId 소실을 확인했으므로 부재·unknown을 재전송 허가로 취급하지 않는다.

## 범위

- setup, execution, validation, verification-system, review-rejected, delivery-unknown, resource-missing 실패 설명과 허용 행동.
- 확정된 준비 실패의 마지막 안전 단계 재시도. 고정 PLAN·SHA·기존 Workspace 재사용, 시도 번호 유지.
- 현재 결과·revision에 묶인 수정 재개. 확인된 멈춘 기존 세션에만 전송하고 의도·messageId를 먼저 저장. 새로운 수정 지시에서만 시도 증가.
- 결과가 없는 수집 실패의 재검증, 동일 명령 재호출·다른 내용 충돌·여러 화면의 오래된 명령 방어.
- 생성/전송 미확정 명령의 명시적 대조. 정확히 하나의 검증 가능한 리소스 또는 원래 messageId/payload가 발견되면 연결하고, 부재·불완전 목록·식별자 소실·모호함은 대조 이력과 슬롯을 유지. 강제 완료·강제 미전송 판정은 제공하지 않는다.
- 리소스 유실 시 증거 보존과 새 요청으로 내용 복사. 완료한 요청 자체의 재실행은 하지 않는다.
- 실제 주 시험 요청 1건에서 의도된 코드 실패→재검증→GUI 수정 재개→수정 요청 판정→재개→완료. 별도 소유 fixture 요청 1건에서는 실제 Paseo 어댑터 호출 직후 응답 유실과 PLAN 쓰기 실패를 주입한다. fixture store는 `%USERPROFILE%/.orchiva/m5/<run>/fixture-requests`로 격리하고 무관한 활성 작업이 없을 때만 순차 실행한다. 기존 8건 원본 백업·SHA256 보존.
- 초기 retry와 unknown의 실제 경계 시험은 공개 SDK 호출을 감싼 시험 어댑터에서 수행하며 제품에 장애 주입 스위치를 추가하지 않는다. 강제 프로세스 종료·일반 부하 시험은 M6.

## 작업 순서와 산출물

| 작업 | 파일 또는 예정 파일 | 내용 | 산출물 |
| --- | --- | --- | --- |
| 1 | contracts, domain/failure.ts | 실패/대조 이력, retry/reconcile RPC, 엄격한 신규 resume/revalidate | 호환 계약 |
| 2 | application/start-feature-request.ts, recover-request.ts | 초기 안전 재시도, 원래 명령 대조, 불변 대조 이력 | 복구 유스케이스 |
| 3 | adapters/paseo/runtime.ts, reconciliation.ts | Workspace/Agent 소유·경로·SHA·PLAN 확인, messageId 대조, 리소스 유실 구분 | 실행 전·대조 경계 |
| 4 | track-execution.ts, reconcile.ts | 현재 결과/revision 보호, 수집 실패 재검증, 재시작 복원 연결 | 시도·슬롯 보존 |
| 5 | client/components/recovery-panel.tsx, workflow-screen.tsx | 실패별 행동, 동일 입력 재전송 키 유지, 판정 사유 재개 입력, 복사 | GUI 흐름 |
| 6 | server/tests/m5-recovery.test.ts, scripts/m5-recovery.mjs | 경계·동시성·실제 연동·GUI 검증 | 재현 증거 |
| 7 | docs/decisions/m5-recovery.md | 실제/모의 결과와 제한, 안내 갱신 | 완료 기록 |

## 검증 계획

| ID | 종류 | 절차 | 기대 결과 | 증거 |
| --- | --- | --- | --- | --- |
| V01 | 정적·자동 | typecheck, 전체 test | 기존 회귀와 추가 실패 경계 통과 | 명령 결과 |
| V02 | 모의 | 준비 실패 후 중복 retry, 다른 내용 키, stale revision, BUSY, 재시작 | 같은 리소스·시도, 중복 생성/전송 없음 | 테스트 |
| V03 | 모의 | unknown 생성/전송의 found/absent/unknown/복수/불완전 목록, 원문 불일치 | 확실한 found만 적용, 나머지 슬롯 유지 | 테스트 |
| V04 | 모의 | 결과 없는 수집 실패 재검증, 실패 검사 재개, 원래 실패 결과/판정 보존, 유실 리소스 | 검증만 재실행 시도 유지, 유실 시 전송 금지 | 테스트 |
| V05 | 실제 | 신규 fixture에서 PLAN 오류→retry→실제 Agent 생성 후 응답 유실→대조, 재개 응답 유실 대조 | 새 리소스 각 1개, 같은 전송 식별자·명령 유지 | manifest |
| V06 | 실제·GUI | 신규 주 요청의 실패→재검증→수정→수정 요청→재개→명시적 완료 | 같은 TASK/Workspace/Agent, 원래 검사 파일 해시 유지, 실패/판정 이력 | manifest·화면 |
| V07 | GUI | 넓은/compact 화면, 오류·미확정 설명·메모·중복 버튼 방지 | 상태에 맞는 행동과 가독성 | 스크린샷 |
| V08 | 회귀 | verify, verify:lifecycle, M2/M3 보존 대조, 기존 8건 SHA256 | 기존 증거 유지 | 검증 요약 |

## 실패 처리와 복원

기존 완료/검토 기록을 새 시험으로 재사용하지 않는다. 실제 fixture의 모든 리소스와 요청 JSON은 보존한다. 무관한 활성 세션 발견 시 중단하지 않고 실연동을 대기한다. 응답 유실은 서버 효과가 완료된 뒤 시험 호출자에게 예외를 반환하며 실제 강제 종료와 구분한다. 전달을 증명하지 못하면 unknown과 슬롯을 유지하고 임의로 성공·실패 처리하지 않는다. 시험이 만드는 테스트 파일은 최초 실패 후 수정하지 않는다.

## 완료 조건

- [x] 실패별 행동과 서버 경계 구현
- [x] retry/resume/revalidate/reconcile 중복 방지와 이력 보존
- [x] 필수 자동·실제·GUI 검증 및 기존 8건 보존
- [x] 계획·설계·검증 문서 갱신과 로컬 커밋

## 실행 및 검증 기록

| 날짜 | 변경 기준점 | 실행 절차 | 결과 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 2026-11-12 | 3104e97 | 설계·복구 코드 확인 | proposed 등록 후 사용자 지시로 active | 구현·검증 |
| 2026-11-12 | M5 구현 | V01: typecheck, 전체 test | 통과, 83/83 (기존 70 + M5 13) | 없음 |
| 2026-11-12 | M5 구현 | V02~V04: 모의 실패·동시성·대조·유실·이력 | 통과. null 재검증 재호출 payload와 이전 턴 수집 경계를 발견·수정 | 없음 |
| 2026-11-12 | 001 fixture | 실제 준비 실패 후 retry | Codex 앱 갱신으로 이전 실행 경로 유실. Workspace·unknown/absent 원본 보존 | 경로 백업·갱신 후 새 ID |
| 2026-11-12 | 002 fixture | V05: 실제 SDK 효과 뒤 응답 예외 | Workspace·Agent·재개 전송 각 1회, found 대조 2건 | 없음 |
| 2026-11-12 | 002 주 요청 | V06: 검사 실패→재검증→GUI 재개→수정 요청→재개→완료 | 같은 Agent/Workspace, 시도 3·결과 4·판정 2, 원래 검사 해시 불변 | 없음 |
| 2026-11-12 | 동일 UI | V07: 1280×900, 390×844 | 사유 보존·비활성·과거 읽기 전용·내용 복사·가로 넘침 없음 | 없음 |
| 2026-11-12 | 001 복사본 preview | V07 보완: 동일 client, 조회·대조 RPC만 등록 | 실제 absent 대조 뒤 대기 유지·복구 버튼 0개, 원본 불변. 임시 등록 해제 | 없음 |
| 2026-11-12 | M5 구현 | V08: verify, verify:lifecycle, M2/M3 verify, M5 verify | 모두 통과. 기존 8건 SHA256 일치 | 없음 |

## 결정과 후속 작업

확정되지 않은 부재를 근거로 재전송하는 UI는 제공하지 않는다. SDK 식별자가 소실된 메시지는 사용자가 Paseo에서 확인할 수 있도록 원래 명령·지시·대조 사유를 제시하되, 사람의 추측으로 슬롯을 해제하지 않는다. 최초 준비 재시도는 원래 생성 키를 유지한다. 원래 API의 이미 저장된 명령 재호출은 호환하고 신규 명령에는 강화된 계약을 적용한다. M6에서 장시간/프로세스 강제 종료/설치 수용을 진행한다.

검증 근거와 재현 명령은 [M5 결과](../decisions/m5-recovery.md), 실제 ID·해시·횟수는 [요약 JSON](../evidence/m5-recovery-20261112.json)에 기록했다.

추가 검증 결정: 미확정 상태의 UI를 일반 저장소로 가져오면 슬롯과 원본 격리에 영향을 주므로, `scripts/m5-ui-preview.mjs`로 동일 client와 실제 unknown 기록 복사본을 사용하는 임시 Plugin을 만들었다. 생성·전송 RPC 및 관측 루프는 등록하지 않고 SDK 조회 대조만 실행했다. 제품 장애 주입 스위치 없이 미확정 설명·버튼·absent 이후 상태를 확인했으며 등록 해제 후 원래 Plugin만 실행 중임을 대조했다. preview 자료는 원본과 구분하여 보존한다.
