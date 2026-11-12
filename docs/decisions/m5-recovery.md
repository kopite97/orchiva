# M5 실패·재개·중복 명령 처리 결과

작성일: 2026-11-12 · Asia/Seoul · 기준 소스: `3104e97`

## 구현 결과

[M5 계획](../plans/m5-recovery.md)에 따라 확정된 초기 준비 실패의 재시도, 현재 결과에 묶인 같은 세션 재개, 결과 없는 수집 실패의 재검증, 미확정 생성·전송 대조를 구현했다. 기존 브라우저 UI와 로컬 daemon 구조를 유지했다.

| 실패 종류 | 화면과 서버 행동 |
| --- | --- |
| setup | 확정된 accepted/plans 실패만 초기 재시도. 고정 PLAN·SHA·기존 Worktree 유지 |
| execution / validation | 실패 증거를 남기고 현재 결과·revision을 확인한 뒤 같은 세션에 수정 지시 |
| verification-system | 환경·검사 로그 안내. 결과가 없어도 검증만 재실행 가능, 시도 증가 없음 |
| review-rejected | 판정 사유를 재개 입력에 채움. 재개 버튼을 누르기 전에는 전송하지 않음 |
| delivery-unknown | 원래 명령·단계·지시·마지막 대조 표시. 확실한 found만 연결 |
| resource-missing | 같은 작업에 새 전송 금지. 기존 증거를 보존하고 내용을 새 요청 입력으로 복사 |
| 관측 오류 | 마지막 확정 상태 유지. 실행 실패·검증기 오류와 분리 |

완료 요청도 내용 복사가 가능하며 새 입력은 저장·계획 확인·실행을 별도로 거쳐야 한다. 복사 자체는 새 세션이나 영속 초안을 만들지 않는다.

## 계약과 불변 조건

v2에 선택적 `failure`, `deliveryChecks`, `recovery.previousSourceKey`를 추가했다. 기존 요청은 읽기만으로 다시 저장하지 않는다. 대조 기록은 대상 명령과 연결되고 중복 ID·삭제·변경을 거부한다. 이전 판정·결과·명령 이력의 불변 규칙을 유지한다.

- `request.retry-start`: token, commandKey, expectedRevision, targetCommandKey. 마지막 확정 준비 실패만 재시도하며 불확실한 생성·전송, 다른 활성 작업, 복원 중인 서비스는 거부한다. 원래 외부 생성 키는 유지하고 새 retry 명령만 추가한다.
- `request.reconcile`: 같은 입력 계약. 원래 unknown 명령을 대조하고 결과를 감사 이력에 추가한다. 적용된 동일 명령 재호출은 다시 대조하지 않는다. 여전히 unknown이면 최신 revision과 새 명령 키로 대조할 수 있다.
- 신규 `request.resume`: 기존 key·instruction에 현재 resultId와 expectedRevision이 필수다. 수집 결과가 없는 경우 resultId는 null이다. 기존에 저장된 명령의 재호출은 이전 형식도 호환한다.
- `request.revalidate`: 기존 명령 키·revision 보호를 유지하면서 resultId null을 허용한다. null 재검증이 성공한 뒤 동일 명령을 재호출해도 최초 payload와 대조하므로 재검증을 반복하지 않는다.
- 공개 `request.refresh`는 관측만 허용한다. 과거의 revalidate:true 옵션은 거부하며, 재검증은 명령 키가 있는 전용 RPC로 실행한다. 애플리케이션 내부의 기존 refresh 호환 테스트와 공개 RPC 계약을 구분한다.
- 같은 키·같은 입력은 기존 명령을 반환하고, 다른 내용은 IDEMPOTENCY_CONFLICT다. 새 명령에는 현재 revision·결과·슬롯·리소스·외부 세션 상태를 검사한다.

재개 시 기존 결과를 보존하고 시도 번호·messageId·전송 의도를 먼저 저장한다. 응답이 불확실하면 unknown과 슬롯을 유지한다. 전송 응답만 먼저 도착하고 외부 관측이 이전 턴을 반환하면 `previousSourceKey`를 통해 이전 응답을 새 시도의 결과로 수집하지 않는다.

Workspace 대조는 완전한 목록의 유일한 TASK 제목, sandbox 소속 경로, 요청 브랜치, 고정 HEAD를 확인한다. Agent 대조는 Workspace·경로·TASK 제목·요청 label(또는 이미 저장된 Agent ID), PLAN 원문·HEAD를 확인한다. 신규 생성부터 요청 label을 기록한다. 재개는 원래 messageId와 원문을 함께 검색한다. 부재, 불완전 목록, 복수 후보, 원문 불일치, 복원 후 식별자 소실, 조회 실패는 재전송 근거가 아니다.

리소스 검사에서 네트워크 예외와 실제 유실·경로 불일치를 구분한다. daemon 사전 점검은 PATH뿐 아니라 공개 SDK의 실행기 가용성도 확인한다. runtime은 기존 확인된 프로젝트와 sandbox 제한을 유지한다.

## 실제 연동 결과

주 실행 ID는 `m5-20261112-recovery-002`다. 실제 SDK 효과를 수행한 뒤 시험 호출자에게 예외를 반환하는 방식으로 응답 유실을 주입했다. 강제 프로세스 종료나 실제 네트워크 단절 시험은 아니다.

| 시험 | 결과 |
| --- | --- |
| 격리 fixture | PLAN 쓰기 실패 → 중복 retry → 실제 Agent 생성 후 응답 예외 → found 대조 → 실제 재개 전송 후 응답 예외 → found 대조 |
| fixture 생성·전송 수 | Workspace 1개, Agent 1개, 재개 send 1회, 원래 messageId 메시지 1건 |
| 주 요청 | 의도된 검사 실패 → 같은 시도 재검증 → GUI 수정 재개 → 수정 요청 → GUI 재개 → GUI 완료 |
| 주 요청 최종 상태 | completed, 시도 3, 검증 결과 4건, 판정 2건 |
| 주 Agent | `7cf22560-36eb-44a2-bf21-9a6c7d6de752` |
| 주 Workspace | `wks_9964f44d99ea2b0f` |
| 기준 HEAD | `86e00e0c80cc0822eaa2e5e70b406530f7c7749a` |
| 주 메시지 | 최초 1건 + 재개 2건, 총 3건 |
| 검사 | 원래 Node 테스트 2개 통과, 검사 파일 SHA256 불변, 검사 변경 0건 |
| 보존 | 최초 실패·수정 요청 판정 불변, 기존 요청 8건 바이트 일치, 완료 후 예전 명령 재호출 무쓰기 |

002 시험에서 추가한 Agent·Workspace는 각각 2개다. 앞선 001 시험은 앱 업데이트 후 삭제된 Codex 실행 파일 경로 때문에 Agent 생성에서 막혔다. Worktree `wks_e9a44fc1d2122230`, Agent 없음, unknown과 absent 대조 이력을 **격리 fixture store에 그대로 보존**했다. 미전송으로 강제 판정하거나 해당 키로 재전송하지 않았다. daemon 설정을 로컬에 백업하고 현재 설치된 앱의 실행 파일 경로로 갱신한 뒤 config reload했다. 모델, 사용자 Codex 설정, sandbox·승인 정책은 변경하지 않았다. 이후 새 실행 ID 002로 검증했다.

[검증 요약](../evidence/m5-recovery-20261112.json), [실패 화면](../evidence/m5-failure-wide-20261112.png), [수정 요청 화면](../evidence/m5-rejected-compact-20261112.png), [완료 이력](../evidence/m5-completed-wide-20261112.png), [과거 실패 결과](../evidence/m5-history-compact-20261112.png)를 보존한다. 원본 백업과 manifest는 `%USERPROFILE%/.orchiva/m5/<실행 ID>`에 있다. 전체 요청 JSON과 daemon 설정 백업은 커밋하지 않는다.

## 검증과 한계

| 종류 | 실행 | 결과 |
| --- | --- | --- |
| 정적 | npm run typecheck | 통과 |
| 자동·모의·임시 저장소 | npm test | 83/83 통과, M4 70개 + M5 13개 |
| 모의 경계 | retry 복원, 동시 명령, stale revision/result, 전달 found/absent/unknown, 잘못된 ID, 자원 유실/연결 오류, 수집 실패 재검증 | 중복 효과·이력 유실 없이 의도한 거부/복구 |
| 실제 SDK | m5 fixture | 준비 실패, 생성/전송 응답 예외, 원래 ID 대조 통과 |
| 실제·GUI | m5 start/wait/revalidate/checkpoint/verify와 GUI 판정 | 같은 세션 실패→재개→수정 요청→재개→완료 통과 |
| GUI | 1280×900, 390×844 | 빈 지시·진행 중 버튼 비활성, 수정 사유 보존, 과거 결과 읽기 전용, 복사 후 미저장 이탈, 가로 넘침 없음 |
| GUI·격리 통합 | 동일 client + 실제 unknown 복사본 + SDK 대조 | absent 후 대기·슬롯 유지, 복구 버튼 제한, 원본 불변 |
| 회귀 | verify, verify:lifecycle, M2 verify, M3 verify | 모두 통과 |
| 원본 보존 | m5 verify | 기존 8건 SHA256 일치 |

미확정 화면은 추가 격리 UI 통합 시험으로 검증했다. `scripts/m5-ui-preview.mjs`가 동일 client와 001의 실제 unknown 기록을 별도 폴더에 복사하고 조회·대조 RPC만 등록하는 임시 Plugin을 만든다. 백그라운드 작업 및 생성·전송 RPC는 등록하지 않는다. 넓은/좁은 화면에서 원래 명령·단계·대조 안내, 재개/초기 재시도 버튼 0개를 확인하고 **전달 결과 대조**를 눌렀다. 실제 SDK 조회의 absent 이후에도 needs-input·시도 1을 유지했고 복사본에만 대조 이력 1건을 추가했다. 원본 fixture SHA256은 불변이다. [미확정 화면](../evidence/m5-unknown-compact-20261112.png)을 보존하고 임시 Plugin 등록을 해제했다. 원래 Plugin만 실행 중이며 요청 생성·메시지 전송은 없었다. 이 화면 시험은 일반 저장소에서 장애를 유발한 시험과 구분한다.

대조는 증거가 확실한 경우만 해소한다. 메시지 식별자가 소실되거나 유일한 리소스를 증명할 수 없으면 확인 대기와 슬롯이 남는 제한을 유지한다. 강제 슬롯 해제·자동 재전송·무인 복구는 없다. 장시간/성능/강제 종료 수용 검증과 전체 MVP 완료 판단은 M6 범위다.

## 재현

이 PC의 보존된 완료 결과를 대조할 때 모든 세션이 멈춘 상태에서 다음을 실행한다. 기존 검사 파일을 바꾸거나 새 세션을 만들지 않는다.

```powershell
npm run m5 -- verify m5-20261112-recovery-002
```

새 시험은 새 ID로 `init` → `fixture` → `start` → `wait <id> 1` → `revalidate` 순서로 진행한다. GUI에서 구현만 수정하도록 재개한 뒤 `wait <id> 2` → `checkpoint <id> recovered`, GUI 수정 요청 뒤 `checkpoint <id> rejected`, GUI 재개 뒤 `wait <id> 3`, GUI 완료 뒤 `verify`한다. `npm run m5 -- help`도 참고한다. 같은 ID의 init/fixture/start를 다시 실행해 기존 증거를 덮어쓰지 않는다. 중간 실패 시 manifest·기록·실제 외부 리소스를 먼저 확인한다.

격리 미확정 UI 재현은 unknown이 남은 시험의 새 preview 폴더에서 `node scripts/m5-ui-preview.mjs <id>`를 실행하고 출력 경로를 `paseo plugin install <경로> --home C:/Users/USER/.paseo-orchiva`로 임시 등록한다. 완료 후 `paseo plugin remove orchiva-m5-preview --home C:/Users/USER/.paseo-orchiva`로 등록을 제거한다. 이미 있는 preview를 지워 재사용하지 않는다. UI는 원본 client이며 server는 복사본 저장소의 조회·대조 RPC만 제공한다.
