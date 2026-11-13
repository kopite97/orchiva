# M6 통합 수용·장애·성능 결과

작성일: 2026-11-13 · Asia/Seoul

상태: `completed` · 실행 ID: `m6-20261113-001`, 보완 `m6-20261113-002`

기준 소스: `a74f8bd565af18c32276443b94fadc682708ea15` · 검증 브랜치: `codex/m6-integrated-acceptance`

M6의 구현·수용·장애·성능·사용 안내를 완료했다. 첫 실행의 부분 결과를 유지한 채 보완 실행에서 빠진 항목을 수행했다. 자동 테스트 89개, 실제 성공·실패·재개·수동 완료, 브라우저 없는 실행, 프로세스/전송/저장 장애와 성능을 확인했다. 사용자도 초안 복원과 완료 요청의 검사 로그·판정 찾기를 확인했다. 실제/모의 범위와 측정 오차는 아래에 구분한다.

[요약 JSON](../evidence/m6-acceptance-20261113.json)의 `previousRunSummary`는 이전 부분 요약을 보존한다. 원시 루트는 `%USERPROFILE%/.orchiva/m6/<실행 ID>/`이며, 이전 보고서 사본은 보완 실행의 `partial-reports/`에 있다. 과거 PoC·M0~M5 기록과 검사 원본을 수정하지 않았다.

## 구현과 결함 수정

- [JSON 저장](../../server/adapters/storage/json-request-store.ts): rename의 일시적인 EPERM/EBUSY에 10/20/40/80ms 간격으로 최대 5회 시도한다. 지속 실패는 이전 JSON/temp를 보존한다.
- [재개 복원](../../server/application/track-execution.ts): 재개 의도 저장 직후 프로세스가 종료되어 전송을 확인할 수 없으면 원래 명령을 unknown으로 표시한다. **전달 결과 대조**가 가능해지며 슬롯·이전 결과를 유지하고 자동 재전송하지 않는다. 새 회귀 테스트가 absent 대조와 같은/새 키 송신 차단까지 확인한다.
- [관측 루프](../../server/application/reconcile.ts)는 activeCycles/maxConcurrentCycles를 진단한다. 30분 실제 운영에서 동시성을 계측했다.
- [키보드 처리](../../client/components/checkbox-keyboard.ts), [초안](../../client/components/draft-editor.tsx), [판정](../../client/components/request-result.tsx)에 aria-checked/aria-disabled 전달과 Space 활성화를 보완했다. 실제 GUI에서 마우스·Space·Enter·Tab을 확인했다.
- baseline 상위 폴더 생성, 비동기 계측 종료, Plugin 목록 배열 응답의 처리도 수정했다. 임시 시험 메뉴는 실제 Orchiva와 구분한 뒤 최종 등록을 제거했다.

## 통합 수용 A01~A16

`002/`는 보완 실행, `001/`는 최초 실행의 증거다. 아래 pass는 각 행에 명시한 범위의 판정이다.

| ID | 판정·종류 | 결과·증거 |
| --- | --- | --- |
| A01 | pass · GUI | 다섯 입력·조건·검사 저장/재열기, 불완전 계획 오류·이탈 취소, 실제 TCP 단절 중 입력 보존과 복귀 후 저장. 사용자 별도 초안 복원도 확인. `002/ui-observations.json`, `d07/`, `human-first-use.json`. |
| A02 | pass · 실제+GUI | S 계획 1 후 목표 수정, 과거 계획 거부·인벤토리/JSON 무변경, 계획 2의 고정 SHA 실행. `002/supplement/stale-plan.json`, `snapshot-s*.json`. |
| A03 | pass · 실제+모의 | C 동시 start 승자 Agent/Workspace 각 1, 패자 BUSY·리소스 0. replay·다른 payload·stale revision 추가 효과 없음. `002/supplement/concurrent.json`. |
| A04 | pass · 실제+GUI | S의 검사 파일 1개 안 테스트 2개 통과. 조건·검사 근거·메모 후 명시적 완료. 사용자가 검사 로그·판정도 찾음. `002/backup-restore/requests/m6-20261113-002-s.json`, `human-first-use.json`. |
| A05 | pass · 실제+GUI | F의 의도적 x+2 실패 후 구현만 x+1로 수정. 같은 Agent/Workspace, 테스트 SHA `888916e9…` 불변, 최초 실패 보존·시도 2 통과. `002/supplement/wait-f-1.json`, `wait-f-2.json`. |
| A06 | pass · 실제+GUI | M 검사 0건. 파일 근거만 있는 승인을 서버에서 거부하고 UI도 수동 메모 전 비활성. 실제 파일 확인·수동 근거 후 완료. `002/supplement/manual-denied.json`, M snapshot. |
| A07 | pass · 실제+GUI | F 수정 요청 후 11초간 JSON·시도·재개 명령 불변. 클릭 후에만 시도 3, 이전 실패·판정 보존. `002/supplement/rejection-pause-f.json`, `wait-f-3.json`. |
| A08 | pass · 실제+모의 | F 파일 변경과 실제 외부 세션의 새 turn으로 과거 승인을 거부. 같은 시도 안의 새 결과를 추가하고 이전 결과 불변. `002/supplement/stale-file-f.json`, `stale-session-f.json`. |
| A09 | pass · 격리 실제 프로세스 | assertion/syntax/missing/timeout/budget, 로그 표시 생략, 실행 출력 버퍼 초과, 파일 크기/수집 수 제한 구분. 실행 출력 초과는 error·완료 불가. `002/isolated-003/`, `output-buffer-limit/`. |
| A10 | pass · 실제+GUI | B 접수 후 시험 IAB 탭·접수 client·P05 observer 종료. 디스크만 기다려 검토 대기 도달, 재접속 후 JSON/result ID 불변. 사용자 별도 브라우저는 조작하지 않았고 B 상세 observer는 유지하지 않음. `002/background-ui-closed.json`, `background-comparison.json`. |
| A11 | pass · 실제 | idle daemon 전체 정상 stop/start 후 ID·결과·인벤토리 보존, 복원 17.869초. `001/a11-002/`. |
| A12 | pass · 실제+모의 | 의도/호출/checkpoint 10개 소유 child 종료 경계, 실제 응답 frame 차단, SDK 성공 뒤 저장 전 writer 종료. 효과 최대 1회·unknown 슬롯 유지. `002/isolated-003/`, `d04-live/`, `001/d03/`. |
| A13 | pass · 실제+GUI | 실제 TCP cut/복귀·입력 보존, backoff 중 Plugin 종료/재연결. Paseo UI에서 I를 중단해 interrupted 실패를 남긴 후 같은 Agent/Workspace 시도 2 복구. `002/d07/`, `session-stop-gui.json`, `session-stop-comparison.json`. |
| A14 | pass · 격리 실제 저장 | v1 4건 사본에서 두 경계의 migration 중단. 원본·백업 해시 불변, 정상 4건 조회와 corrupt/future 2건 진단·실행 차단. `002/isolated-003/`. |
| A15 | pass · 실제 프로세스 | 두 실제 Plugin의 동일 store owner 충돌 거부. 첫 owner 종료 후 새 PID가 기록 변경 없이 획득. 별도 child 강제 종료 뒤도 unknown 슬롯 강제 해제 없음. `002/plugin-ownership/`, `isolated-003/`. |
| A16 | pass · 실제+GUI | 완료 S의 구현 파일 임시 변경→차이 표시→복원, 완료 JSON 불변. A05 이후 F 검사에 단언을 바꾸지 않는 주석 추가→재검증→확인/사유 없는 승인 거부→GUI 완료. `002/supplement/compare-completed-s.json`, `change-check-f.json`, 파일 비교 화면. |

1280×900과 390×844에서 주요 흐름을 확인했다. 합성 100건+P03 요청 1건은 20/20/20/20/20/1 페이지, 고유 101건이었다. 질문·권한·미확정·검증·관측 지연은 동일 client의 격리 모의 fixture로도 확인했고 compact 너비/scrollWidth는 모두 390이었다. **실제 질문/권한 요청은 재현하지 않았다.** 실제 검증 중 표시는 성능 표본 종료 후 별도 composition의 collect를 8초 지연해 관측했고, 종료 뒤 같은 시도 47의 검증 2가 추가됐다. 이 지연은 제품 소스에 없다.

## 장애 D01~D08

| ID | 최종 판정·실제/모의 경계 |
| --- | --- |
| D01 | pass. 격리 v2 writer의 accept 전/후·안전한 plans 후 IPC 종료. 전이면 효과 0, 안전 checkpoint는 같은 ID로 계속함. |
| D02 | pass. workspace/agent/message 호출 직전·checkpoint에서 소유 child만 종료. 외부 효과는 ledger 모의이며 실제 worker 종료는 D06에 별도 기록. absent를 미전송으로 추정하지 않음. |
| D03 | pass. 실제 SDK WebSocket 응답 frame 손실 뒤 원래 ID로 start/resume/replay 대조. TCP 단절과 별개. `001/d03/d03-response-drop.json`. |
| D04 | pass. 실제 SDK 재개 전송 성공 직후 applied 저장 전에 소유 writer PID 10528 종료. 원래 message found, replay 무쓰기, 제품 완료 S 원본 불변. `002/d04-live/d04-live.json`. |
| D05 | pass. rename 직전/직후 child 종료, 이전/다음 전체 JSON 유지. transient 재시도, 지속 실패 temp 보존, 실제 읽기 전용 파일 거부 확인. 001 fault 테스트와 `002/isolated-003/`. |
| D06 | pass. 소유 Paseo worker 강제 종료, supervisor 유지·18.402초 복원. 실패 1건 보존 후 같은 Agent/Workspace 시도 2 성공. `001/d06-003/`. |
| D07 | pass. 시험 TCP socket만 cut/restore. backoff 5회, 이전 Plugin 종료 후 늦은 metrics 쓰기 없음, 새 cycle 최대 1. 최종 proxy socket 0. `002/d07/`. |
| D08 | pass. 실제 M6 Worktree의 .git 포인터를 임시 이동해 식별 검사 실패 후 bytes 복원. 전송·시도·명령 변화 없음. Agent 유실은 SDK refresh null 모의이며 실제 삭제하지 않음. 읽기 전용 파일 쓰기 거부도 확인. `002/resource-missing-002/`, `isolated-003/`. |

D06 최초 manifest의 agentCountBefore=42/workspaceCountBefore=45는 작업 생성 전 수치다. kill 직전 activeTask 인벤토리와 recovery는 43/46이다. 원시 파일을 바꾸지 않고 이후 도구 필드명을 BeforeTask/BeforeKill로 구분했다. 실제 세션 중단 I와 worker 강제 종료는 다른 시험이다.

## 성능과 운영 P01~P05

Windows 10.0.26200, Intel Core 7 240H·논리 CPU 16개, Node 24.19.0, Paseo/client/Plugin SDK 0.15.4, codex/gpt-6.1-sol, localhost 6767·relay 꺼짐. p95는 정렬한 n개 중 ceil(0.95×n)번째다.

| ID | 최종 판정·표본·실측 |
| --- | --- |
| P01 | pass. 100건(초안 60/실패 20/완료 20), 결과 120개, 원본 7,337,535 JSON bytes. 실제 daemon/Plugin RPC cold 1회·warm-up 5회·각 30회, 실패 0. idle p95: 초안 저장 16.347ms, 전체 목록 161.037ms, 첫 페이지 53.800ms, 다음 32.899ms, 전체 상세 6.519ms. 150ms의 동일 writer mutex 점유 중 초안 RPC 30회 p95 185.886ms. 활성 Agent 0과 전원 계획을 시작 전에 기록했다. 모델 없이 실제 잠금/RPC를 측정한 조건이다. 목표 1초 이내. `002/p01-rpc-idle/rpc-measurement.json`. |
| P02 | pass. start RPC n=32 p95 1,034.663ms/max 1,298.179ms; intent 관측 n=30 p95 1,033.127ms; resume RPC n=32 p95 1,125.925ms/max 1,143.199ms. 001의 모든 유효 표본에 같은 모델·파일 검사·idle 접수를 더함. intent 2건은 RPC 직후 durable read의 상한값. B/I 대기는 접수 이후 모델 쪽이므로 start 접수에 포함. 원래 resume intent/SDK projection 각 n=30 p95 557.564/1,070ms도 보존. 목표 2초 이내. `002/performance-summary.json`. |
| P03 | pass. Hook/polling 각 저장 23회: Hook p95 2,154ms/max 2,156ms, polling p95 5,485ms/max 5,677ms로 저장 목표 10초 이내. 실제 GUI 첫 관측 Hook 11회/polling 12회. 저장→GUI 상한 p95 5,979/7,802ms, 외부 종료→GUI 상한 최대 7,316/12,734ms. 400ms sampling 사이 도구 전환 공백도 포함한 상한이며 순수 렌더 지연이 아님. 누락 ID에 시간을 부여하지 않음. `002/p03*/`, `performance-summary.json`. |
| P04 | pass. 정상 worker restart 3회 12.129/20.899/17.555초, D06 비정상 종료 18.402초, 전체 정상 stop/start 17.869초. 30초 이내. `001/p04/`, `d06-003/`, `a11-002/`. |
| P05 | pass. 002의 30분 0.262초·181 samples, 간격 9,984.3~10,015.2ms. 안정 요청 bytes/mtime 변화 0, violation 0, 실제 동시 cycle 최대 1, 최종 issues/activeTokens 0. client 종료 뒤 socket/timer 0. RSS 첫/마지막 5분 평균 306,042,061/307,843,204 bytes(약 +1.8MB), 범위 294,539,264~314,847,232. 다른 M6 요청은 순차 실행한 조건이고 대상 M은 계속 안정 상태. `002/p05/p05-soak.json`. 001의 별도 30분 결과도 보존. |

P01의 기존 직접 저장소 측정은 `001/p01/`에 있다. `002/p01-rpc/`의 첫 실제 RPC 일부가 I 세션 중단과 겹친 것을 확인해 삭제하지 않고 별도 부하 조건으로 남겼다. 기본 idle 측정은 `p01-rpc-idle/`만 사용하며 두 표본군을 합치지 않았다. 기존 데스크톱 앱은 중지하지 않았다.

P05는 제한된 관측 구간이며 누수 부재·장기 운영 안정성의 증명이 아니다. runtime-status 관측 쓰기 181회와 요청 수정/재검증 0회를 구분했다. 모델 전체 실행 시간·비용을 응답 SLA로 제시하지 않는다.

001의 결과 관측 timeout 1건·pre-effect rename EPERM 3건, 002 수집기 assertion 2건을 삭제하지 않았다. 계측 오류 뒤 이미 접수된 작업은 새 start 없이 같은 세션에서 재개했다. 없는 RPC/intent 값은 계속 누락으로 남긴다. P03 첫 GUI 재측정은 같은 키 충돌로 무효과 거부됐고 새 시험 키로 구분해 후속 표본을 수집했다. 그 밖의 초기 harness 실패 원인과 보존 경로는 요약 JSON에 기록한다.

## 사용 안내와 사람 확인

[사용자 안내](../guides/user-guide.md), [문제 해결](../guides/troubleshooting.md)를 작성했다. 같은 PC의 빈 데이터·격리 config에서 목록 0건→초안 저장→재열기→수동 조건→계획/SHA 확인을 GUI로 재현했으며 여기서는 새 모델을 실행하지 않았다. 실행부터 완료는 S/F/M에서 확인했다. 새 PC 설치·새 인증 검증으로 표기하지 않는다.

사용자는 **“초안이 다시 열리고 입력이 유지 됐어.”**, 완료 S의 테스트 2개 통과 로그·판정을 찾았는지에 **“둘 다 찾았어”**라고 확인했다. 자동 GUI와 구분해 `002/human-first-use.json`에 기록했다. daemon 정상 종료 뒤 요청 53건을 새 사본에 복원해 production store로 열고 원본/사본 해시 불변도 확인했다(`002/backup-restore/manifest.json`).

| 화면 증거 | 확인 내용 |
| --- | --- |
| [S 완료](../evidence/m6-s-completed-wide-20261113.jpg) | 1280×900 완료·검사·판정 |
| [수정 요청](../evidence/m6-f-rejected-compact-20261113.jpg), [과거 실패](../evidence/m6-history-failure-compact-20261113.jpg) | 390×844 재개·읽기 전용 과거 결과 |
| [수동 판정](../evidence/m6-manual-review-compact-20261113.jpg), [검사 변경](../evidence/m6-check-change-compact-20261113.jpg) | 수동 메모·검사 변경 승인 조건 |
| [연결 오류](../evidence/m6-network-error-top-20261113.jpg), [완료 후 차이](../evidence/m6-completed-file-difference-full-20261113.jpg) | 실제 오류의 입력 보존·완료 기록 불변 |
| [Agent 중단](../evidence/m6-agent-stopped-20261113.jpg), [복구](../evidence/m6-interrupt-recovered-20261113.jpg) | 실제 Paseo 중지와 시도 2 검사 통과 |
| [미확정 모의 화면](../evidence/m6-unknown-compact-20261113.jpg) | 자동 재전송 중지와 명시적 대조 |
| [키보드 확인](../evidence/m6-checkbox-keyboard-20261113.jpg), [빈 데이터 계획](../evidence/m6-clean-plan-20261113.jpg) | Space·Tab 상태와 안내 재현 |

## 검증·보존·정리

- typecheck, npm test 89/89, verify/lifecycle, M2/M3/M5 verify, M6 baseline 대조 통과. 원시는 `002/final-verification/`. 마지막 Space 보완 뒤 typecheck와 실제 GUI를 다시 확인했으며 서버 로직은 바뀌지 않았다.
- 기존 요청 42건과 GUI 소유 2건 byte 불변, 실행별 신규 요청 9건으로 총 53건이다. 최초 PoC 9건도 이 42건에 포함된다.
- 002 신규 Agent/Workspace 각 8개, 001의 32개와 합해 M6 예산 40개를 지켰다. 전체 인벤토리 51/54, 기존 ID 보존, active turn/permission/실행 슬롯 0. 실패·PLAN·결과·판정·Worktree·Agent 증거는 삭제하지 않았다.
- 임시 Plugin 4개·proxy 6768·IAB 탭·viewport override를 정리했다. 추가 idle P01 후에도 측정 Plugin을 제거하고 정상 종료했다. project/daemon config는 기준선 bytes와 같다. daemon은 원래 stopped로 복원됐고 forced=false. `002/cleanup-002/cleanup.json`, `cleanup-p01-idle/cleanup.json`, `d07/proxy.json`.
- 최초 정리 수집기가 plugin ls 배열을 단일 객체로 읽어 마지막 확인에서 멈췄다. 이미 제거·proxy 종료·설정 복원이 끝난 것을 대조한 뒤 cleanup-002에서 남은 정상 종료만 이어갔다. 이전 실패 파일을 보존했다.
- M6 검증 완료 시점에는 소스 변경이 로컬 codex/m6-integrated-acceptance에 있었고 commit/push/merge 전이었다. 이후 2026-11-13 사용자가 전체 변경의 커밋·main 반영·push를 명시적으로 요청했다. 요약 JSON의 Git 값은 검증 당시 snapshot이며, 후속 반영은 저장소 Git 이력과 origin/main으로 확인한다. 인증 자료·요청 원본 JSON은 소스 저장소에 넣지 않는다.

최종 원시 파일 66개의 SHA-256과 정적 문서 검사 결과는 요약 JSON에 연결한다. 최종 포트 6767/6768 LISTEN과 시험 소유 프로세스는 0이다. [M6 도구 안내](../../scripts/m6/README.md)에 단계·부수 효과를 설명한다. 완료된 실행 ID에서 생성·장애 명령을 다시 실행하지 않는다.

## 남은 제품 제약

승인된 M6 필수 작업은 남아 있지 않다. 검증 범위는 이 PC의 단일 로컬 daemon·단일 활성 TASK다. exe/설치 프로그램, 다중 사용자·프로젝트, 병렬 실행, 원격 서비스, 일반 빌드 명령, 자동 push/merge, 장기 부하 보장은 포함하지 않는다. 실제 질문/권한 재현, 새 PC 설치·인증, 더 정밀한 연속 GUI 지연 측정은 후속 검증으로 남기며 실제 통과한 시험으로 집계하지 않았다.
