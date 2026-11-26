# D4 질문·상담 구현과 검증

작성일: 2026-11-16 · Asia/Seoul. 기준 커밋 `f080480`, 현재 checkout `main`의 로컬 변경. D4 구현·자동·실제 연동·GUI 검증을 수행했다. 전체 [전환 계획](../plans/desktop-transition.md)은 D5/D6가 남아 `active`이며 이번 D4 변경은 commit/push하지 않았다.

## 사용자 승인과 구현 계약

사용자가 접근 권한과 승인 수준을 선택하는 방향을 승인하고 설계·계획 수정 및 남은 D4 구현·검증을 지시했다. 기존의 모든 도구 차단 조건은 [상담 정책](../design/desktop-transition.md#질문상담)으로 대체했다. 별도 모델 API나 API 키를 추가하지 않았다.

- 프로젝트 선택 후 자유 입력으로 시작하며 제작용 결과 경로·검사·PLAN 입력을 요구하지 않는다. 모델과 추론 수준은 실제 catalog에서 선택한다.
- 접근 권한은 읽기 전용·작업 폴더 내 수정·전체 접근, 승인 방식은 필요 시 승인·승인 요청 없음이다. 기본값은 `read-only` + `on-request`다. 승인 요청 없음은 sandbox 해제를 뜻하지 않는다.
- 제안했던 `untrusted`는 Paseo 0.15.4의 옵션 스키마에는 있지만 실제 Codex 0.166.0이 `approval_policy = "untrusted" is no longer supported`로 거부했다. 화면에서 사유와 함께 비활성화하며 서버의 새 생성·후속 전송도 거부한다. 더 넓은 정책으로 자동 대체하지 않고 기존 실패 기록은 읽을 수 있다.
- 작업 경로는 등록된 원본 프로젝트다. 명시적 수정 요청과 선택한 정책에 따라 원본이 직접 바뀔 수 있다. 제작의 Worktree·선택 반영·백업/undo를 상담에 적용한 것으로 표시하지 않는다. 조회 명령은 허용되며 읽기 경로 전체 차단이나 모든 도구별 승인을 보장하지 않는다. 제한 모드는 명령의 네트워크를 제한하고 웹 검색은 꺼진다.
- 대화별 모델·지침 snapshot·접근/승인 정책은 고정한다. 변경하려면 새 대화가 필요하다. 자동 PLAN 작성·제작 전환은 구현하지 않았다.

## 저장과 실행 경계

`shared/contracts/desktop-conversation.ts`, `server/domain/conversation.ts`, `server/application/desktop/conversations.ts`, 저장/Paseo 어댑터, WinUI `ConversationWorkspace`로 구성한다. C#은 버전 있는 stdio RPC만 호출하며 프로젝트 JSON을 직접 변경하지 않는다.

대화 문서는 원본의 `docs/.orchiva/conversations/<id>.json`에 원자적으로 저장한다. 기존 프로젝트 writer 소유권·전역 잠금을 사용하고 제작·계획 생성·기존 v2와 활성 슬롯 하나를 공유한다. 손상·미지원·전송 미확정 기록은 새 실행을 막는다. 대화 100턴, 문서 32 MiB, 디렉터리 항목 1,000개, 승인/중단 journal 1,000개 한도가 있다. 입력은 12,000자, 응답은 200,000자 및 JSON 직렬화 750,000바이트 한도로 제한한다. 응답 본문은 턴 상세 RPC로 분리해 전체 대화 조회에서 반복 전송하지 않는다.

Agent 생성·메시지·승인·중단 의도를 외부 호출 전에 저장한다. 같은 명령키와 payload는 같은 결과를 가리키며 다른 payload·오래된 revision·변경된 승인 요청 hash를 거부한다. 동일 대화는 같은 Agent에 후속 메시지를 보낸다. 불확실한 외부 호출은 자동 재전송하지 않는다. 복원 후 최근 이력에 없다는 이유로 새 Agent나 새 메시지를 만들지 않는다.

완료 판정은 메시지 ID·내용·epoch/seq·provider turn ID와 공개 `agent.turn.after` 종료 결과를 대조한다. 종료 결과는 실행 데이터의 `desktop/conversation-outcomes`에 보존한다. daemon 재시작 후 provider turn ID가 재사용될 수 있어 Agent뿐 아니라 메시지 ID도 식별자에 포함한다. 중간 답변과 순간적인 idle만으로 완료하지 않는다. 취소 시 일부 답변은 보존하지만 성공 응답으로 표시하지 않는다.

Paseo가 재시작 후 과거 provider 이력을 복원할 때 메시지/turn ID가 빠지는 경우가 있었다. 이미 확정한 로컬 종료 이력은 그대로 보존한다. ID를 잃은 진행 중 전송은 본문만으로 확정하거나 재전송하지 않는다. 최종 검증 도구의 과거 본문/개수 대조는 감사용이며 제품의 미확정 전송 판정 규칙을 완화하지 않는다.

## 검증 환경과 결과

Windows, .NET SDK 10.0.401, Windows App SDK 2.6.5, Paseo 0.15.4, Codex 0.166.0, 실제 모델 `codex/gpt-6.1-sol`을 사용했다. 실행 ID `d4-20261116-001`과 `002`의 자체 소스·dataHome·paseoHome·포트만 사용했다. 한글/공백 경로 `상담 시험`을 포함한다. 운영 프로젝트와 기존 D1~D3 실행은 수정하지 않았다.

| 검증 | 결과와 범위 |
| --- | --- |
| `npm run typecheck`, `npm test` | 통과, Node 116/116. 저장 불변·손상/미지원·슬롯·중복·생성/전송/승인 응답 유실·재시작·오래된 종료 근거를 포함한 모의 경계 검사 |
| WinUI `dotnet build` | 통과, 경고 0·오류 0 |
| C# `dotnet test`, `ORCHIVA_D4_CONFIG` 지정 | 9 통과·5 건너뜀·0 실패. 5개는 별도 D1 격리 fixture 미지정으로 건너뛰었으며 통과로 계산하지 않음. D4 실제 stdio bridge 두 수명에서 이력·입력 hash·응답 보존 확인 |
| 같은 Agent의 후속 대화·daemon 재시작 | run 002에서 기억할 숫자 37 → 재시작 → 42 계산과 sample.txt 조회. Agent 정체성 유지 |
| 읽기 전용·승인 요청 없음 | 쓰기 시도 실패, readonly-probe.txt 없음. run 001은 Access denied, run 002는 PowerShell language-mode 제한으로 쓰기 전 실패 |
| 작업 폴더 수정·승인 요청 없음 | workspace-probe.txt 저장/재조회, 부모의 workspace-outside-probe.txt 쓰기 차단 |
| 전체 접근·승인 요청 없음 | 시험 소유 부모 폴더 full-access-probe.txt 쓰기/재조회 |
| 필요 시 승인 | 실제 추가 권한 요청의 거부 → 파일 없음, 새 명시적 요청 허용 → permission-probe.txt 생성. 요청 hash/action 대조 및 동일 명령 재호출 확인. 응답 제출은 공개 RPC, 실제 요청 표시 확인은 GUI |
| 미지원 정책 | 실제 `untrusted` 실패 보존. 보완 후 생성·과거 대화의 후속 전송을 사전 거부하고 revision/Agent 수 불변 확인 |
| GUI 자유 입력·후속 전송 | 실제 첫 메시지의 ‘오키드’를 후속 질문에서 재현. 기본 정책·모델 고정·진행 중 전송 비활성 확인 |
| GUI 중단 | 실제 응답 생성 중 중단 버튼 사용, `TURN_CANCELLED`, 부분 응답 보존, stop journal observed 확인 |
| GUI 빈 상태·승인·연결 오류·compact | 프로젝트 선택 전 빈 상태, 승인 사유/경로/명령과 명시적 응답 선택, 연결 실패 시 마지막 응답 보존. 1266×893 및 880×700에서 줄바꿈·스크롤과 주요 행동 확인 |
| 최종 실제 대조 | run 002 Agent 6개, 로컬 턴 11개. 지원 정책 대화 5개의 사용자 메시지 총 10개(응답 9·취소 1), 미지원 설정 실패 1개는 별도 보존. 동일 명령 재호출로 메시지·Agent 증가 없음 |

실제 파일 상태는 원래 sample.txt 유지, 허용된 workspace/permission/full-access probe 내용 일치, readonly/outside-workspace probe 부재였다. 모의 장애 시험을 실제 네트워크 장애로 과장하지 않는다. D4 전용 125%·150% 재검사는 수행하지 않았고 공통 shell의 D1~D3 DPI 결과는 기존 기록에 보존한다. 새 PC 설치·최종 배포는 D6 범위다.

## 발견한 문제와 보존한 실패

1. run 001의 daemon 재시작 직후 공개 Agent 상태가 provider 이력 복원보다 먼저 도착해 전송 결과를 확인하지 못했다. 해당 unknown과 요청 원문을 그대로 보존하고 재전송하지 않았다. 이후 전송 의도 저장 전에 공개 timeline을 준비하는 경로를 추가했고, 로컬 사전 상태 검사에서 실제 전송을 시작하지 않은 경우를 transport 불확실성과 분리했다. run 002의 재시작 후속 턴으로 수정 경로를 검증했다.
2. 중간 assistant 메시지와 idle을 완료로 볼 수 있어 공개 종료 hook의 영속 결과와 정확한 메시지 ID 대조를 추가했다. provider turn ID 재사용 및 과거 종료 결과 혼입도 테스트했다.
3. 실제 `untrusted` 옵션 실패를 숨기지 않고 지원 제외했다. 실패한 provider의 transcript는 daemon 재시작 뒤 없었지만 로컬 실패·원래 receipt·오류 응답은 보존됐다. 검증 도구는 이 건을 정상 대화 개수 대조와 분리한다.
4. GUI 주기 갱신이 매번 목록을 다시 만들어 입력 포커스·스크롤을 흔들 수 있었다. 문서 revision 또는 승인 요청이 바뀔 때만 재구성하고 열린 선택 메뉴 동안 자동 갱신을 미룬다. 수정본에서 직접 입력·첫 전송·후속 전송·중단을 확인했다.
5. 초기 시험의 legacy 조회용 project.json 이름과 로컬 runtime 실행 환경 문제는 fixture와 자식 프로세스 환경에서 해결했다. 사용자 전역 설정·의존성 내부 파일은 변경하지 않았다. UI 도구의 창 좌표 갱신 문제는 최신 screenshot ID로 다시 관측해 조작했으며 제품 결과와 구분한다.

## 재현과 증거

[공유용 요약](../evidence/desktop-transition/d4-20261116/summary.json)과 같은 폴더의 화면을 따른다. 요청·대화 원문, 자격 증명이 있는 daemon home, 실제 승인 명령은 Git 제외 `.desktop-local/d4-20261116-*`에 보존한다. 원본 실패를 지워 재시도하지 않는다.

`node --import tsx scripts/desktop-conversation.mjs <mode> <새 실행 ID>`를 사용한다. `prepare`는 새 소유 폴더만 만들고 `start`, `setup`, `new [access approval]`, `send <UTF-8 파일>`, `permission allow|deny`, `stop`은 실제 부수 효과를 수행한다. `brief`, `status`는 읽기다. `verify`는 실제 이력 대조와 소유 검증 manifest 기록을 수행하며 `policy-check`는 미지원 생성/전송의 사전 거부를 검사한다. `daemon-stop`은 해당 실행의 소유 daemon만 종료한다. 기존 실패한 실행 ID를 새 시험에 재사용하지 않는다.

WinUI 실행은 이 PC의 로컬 SDK를 가리키는 자식 `DOTNET_ROOT`/`DOTNET_ROOT_X64`와 해당 `ORCHIVA_DESKTOP_CONFIG`를 사용한다. C# 실제 D4 검사에는 `ORCHIVA_D4_CONFIG`를 해당 desktop.json 절대 경로로 지정한다. 최종 정리와 파일 지문은 공유용 요약에 기록한다.

최종 정리에서 Orchiva 창·앱/bridge·시험 소유 daemon 프로세스와 두 시험 포트의 listener가 남지 않았음을 확인했다. 원본 실패·대화·승인 기록과 시험 파일은 보존했다. 변경 문서 5개의 로컬 링크 153개 대상, UTF-8·코드 블록, `git diff --check`도 통과했다.
