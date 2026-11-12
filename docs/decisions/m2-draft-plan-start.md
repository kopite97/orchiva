# M2 초안·계획 확인·고정 커밋 실행 결과

작성일: 2026-11-12 · Asia/Seoul · 기준 소스: `bd08ace`

## 결과

[상세 계획](../plans/m2-draft-plan-start.md)에 따라 초안 저장·재열기, 완료 조건과 검사 편집, 두 PLAN 미리보기, 확인한 계획의 고정 SHA 실행을 구현했다. 화면 흐름은 작업 목록 → 요청 작성 → 계획 확인 → 기존 작업 상세다. 결과 카드와 완료 판정은 기존 기능이며 조건별 판정은 M4 범위다.

실제 실행 `m2-20261112-workflow-001`에서 화면의 **이 계획으로 실행**으로 새 Worktree·Codex 세션을 각각 1개 만들었다. 두 PLAN의 파일 내용과 확인한 원문이 같고, Worktree HEAD는 `86e00e0c80cc0822eaa2e5e70b406530f7c7749a`였다. 독립 문자열 검사 1개를 통과하여 `awaiting-review`에 도달했다. 제품의 사용자 완료 판정은 수행하지 않았다.

- Agent: `06cbeffa-ddc3-49e6-a686-70980957f3b1`
- Workspace: `wks_fe7df70ba34046db`
- 요청: `m2-20261112-workflow-001-request`, 계획 버전 1
- 기존 4건 JSON: 작업 시작 백업과 바이트 동일. 기존 실패·복구 증거와 판정 유지.
- [검증 요약](../evidence/m2-workflow-20261112.json), [실제 결과 화면](../evidence/m2-result-wide-20261112.png)

로컬 원본 백업·manifest는 `%USERPROFILE%\.orchiva\m2\m2-20261112-workflow-001`에 보존한다. 요청 원본과 인증값은 커밋하지 않는다. GUI 편집 시험용 `M2 GUI 초안 검증`은 실행하지 않은 초안으로 보존했다.

## 입력과 계획 계약

`request.save-draft`는 미완성 제목·목표·범위·제약·검증 방법과 조건·검사를 저장한다. 조건은 최대 20개, 검사는 최대 8개다. 각 조건은 고유 ID와 문장, 검사 ID 연결 또는 수동 확인 방법을 갖는다. 준비할 때 필수 입력, 중복 ID, 연결 대상, 경로, 설명과 문자열을 검사한다. 검사는 기존 Node 테스트·문자열 방식만 허용한다.

초안은 실행 슬롯을 차지하지 않으며 세션·Worktree·실행 시도를 만들지 않는다. 수정하면 `ready`를 `draft`로 돌리고 기존 계획 이력을 유지한다. `request.prepare-plan`은 입력 기반 템플릿으로 다음 버전의 Request PLAN·Task PLAN, 입력 해시, 기준 SHA와 프로젝트 스냅샷을 저장한다. 별도 모델 호출은 하지 않는다. 자동 검사가 없으면 수동 검토 필요를 표시한다.

SDK 0.15.4의 RPC 이름은 소문자·숫자·점·하이픈·밑줄만 허용한다. 설계의 `request.saveDraft`·`request.preparePlan`은 실제 등록명 `request.save-draft`·`request.prepare-plan`으로 바꿨다. `request.get`은 현재 요청 전체를 반환하며 과거 결과 선택·allowedActions는 후속 단계다.

## 확인과 실행

확인 시작 입력은 `token`, `commandKey`, `expectedRevision`, `planRevision`, `inputHash`다. 서버가 다음 순서로 확인한다.

1. 같은 명령 키의 replay를 revision 검사보다 먼저 처리한다. 다른 입력이면 충돌을 반환한다.
2. 요청 revision·ready 상태·최신 계획 버전·입력 해시·두 PLAN 원문을 확인한다.
3. M1의 프로젝트 실행 슬롯과 저장소 진단을 확인한다.
4. 현재 기준 SHA와 프로젝트 설정을 계획의 스냅샷과 대조한다. 바뀌었으면 `PLAN_STALE`로 거부한다.
5. 확인 출처·계획 버전·시작 의도를 저장한 후 확인한 SHA로 Worktree를 만들고 HEAD를 검증한다. PLAN 파일은 배타적으로 쓰며 다른 기존 내용은 덮어쓰지 않는다.

실행 수락 후 입력·조건·검사·확인 계획·프로젝트 스냅샷은 불변이다. 응답이 미확정이면 기존 의도를 보존하고 새 실행을 자동 전송하지 않는다. 기존 입력 방식의 `request.start`는 이미 실행한 요청의 동일 입력 참조만 허용하며 새 요청에는 `PLAN_REQUIRED`를 반환한다. 과거 smoke/lifecycle 생성 명령은 새 키로 계획 확인을 우회할 수 없다. 기존 기록 회귀 명령은 계속 동작한다.

사전 점검은 sandbox 경로·origin·기준 ref, daemon API, daemon 환경의 Codex 실행 경로를 확인한다. 검사 경로는 기존 조상의 실경로가 저장소 안인지 확인하고 ignored 경로를 거부한다. 앞으로 생성할 검사 파일은 허용한다. 이 점검은 모델 인증·잔여 사용량·실제 모델 실행 성공까지 보장하지 않는다.

## 검증

| 종류 | 수행 내용 | 결과 |
| --- | --- | --- |
| 정적 | `npm run typecheck` | 통과 |
| 파일·모의 | `npm test` | 48/48 통과. M2 8개 시나리오 추가, 기존 시작·경합 테스트를 확인 계획 계약으로 전환 |
| 실제 RPC | 초안·준비 시 리소스 수 불변, 화면 실행 후 SHA·PLAN·검사·재호출 대조 | Agent 6→7, Workspace 8→9, 동일 시작 키는 같은 ID |
| 실제 Git | 전용 임시 ref를 `47c21d4...`에서 `86e00e0...`으로 변경 후 시작 | `PLAN_STALE`, 리소스 생성 0, ref 제거 및 main 유지 |
| 모의 | 확인 직후 ref 이동, provider 변경, 실행 입력 변경 | 저장 SHA 사용 또는 거부, 입력 고정 |
| GUI | 1280×900, 390×844에서 저장·재열기·필수 오류·조건/검사 편집·이탈 취소/버리기·계획 수정·실행·결과 | 주요 행동 조작 가능. 수정 후 계획 버전 1→2. 오류 시 입력 유지. 한국어 안내로 개선 |
| 실제 회귀 | `npm run verify`, `npm run verify:lifecycle`, 마지막 M2 verify | 기존 4건 통과·바이트 동일, 원래 실패 검사 불변 |

새 모델 실행은 1회다. M2 자체에서 daemon 강제 종료·응답 유실을 추가 주입하지 않았다. 해당 경계는 M0 실제 근거와 M1/M2 모의 회귀로 유지했으며, 확인 이후 ref 이동은 모의 시험과 M0의 실제 pinned 생성 근거로 구분한다. GUI 재로드와 Plugin 재등록은 실제 실행이 끝난 뒤 수행했다.

## 재검증과 다음 단계

같은 PC의 보존된 daemon·로컬 데이터가 있을 때 다음 명령으로 기존 실행을 재검증한다.

```powershell
Set-Location C:\Users\USER\lib\orchiva-plugin
npm run m2 -- verify m2-20261112-workflow-001
npm run verify
npm run verify:lifecycle
```

새 실제 시험은 `npm run m2 -- help`의 별도 실행 ID로 `init` → `prepare` → 화면 확인 후 실행 또는 `start` → `verify` 순서다. `init`은 원본을 배타적으로 백업하고 무관한 활성 작업이 있으면 거부한다. `ref-check`는 sandbox의 소유한 임시 ref만 바꾼다. 중간 실패 기록을 지워 재시도하지 않는다.

M3에는 운영 관측 루프·재접속·시작 시 대조·목록/상세 확장이 남는다. 현재 시작 RPC는 실행 의도를 먼저 저장하지만 생성 절차가 완료될 때 응답하며 접수만 즉시 반환하는 worker는 없다. daemon 중단 후 자동 진행 재개도 아직 없다. M4는 조건별 판정·과거 결과 UI, M5는 초기 실패 재시도와 전달 미확정 해결이다. 현재 이탈 보호는 Orchiva 내부 화면 이동에 적용되며 브라우저 강제 종료 전 미저장 입력 복원은 지원하지 않는다.
