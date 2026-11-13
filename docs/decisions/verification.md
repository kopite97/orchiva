# PoC 검증 기록

최종 상태: 단일 TASK PoC의 실행·상태 추적·결과 수집·명시적 완료 판정·동일 세션 실패 복구 검증 완료. MVP 설계로 진행할 수 있습니다.

검증 날짜: 2026-11-12 (Asia/Seoul).

## 실행 환경

- Windows, Node.js 24.19.0, npm 11.17.0, Git 2.55.0.
- Paseo CLI·daemon·Plugin SDK·로컬 웹 UI: 0.15.4.
- Codex: 설치된 데스크톱 앱의 `codex.exe` (0.167.0-alpha.3.2), ChatGPT 로그인.
- daemon home: `C:\Users\USER\.paseo-orchiva`.
- 주소: `http://127.0.0.1:6767`, relay 비활성, 로컬 바인딩 유지.
- 모델: `codex/gpt-6.1-sol`, Paseo 기본 권한, 실행 로그에서 workspace-write 확인.
- sandbox 기준 브랜치 `main`, 초기 커밋 `47c21d4`. 원격 push 없음.

## 발견한 실행 환경 문제와 수정

Codex 앱에서 시작한 독립 Paseo daemon이 `CODEX_WINDOWS_REGISTERED_CORE=1`과 `CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY`를 상속했습니다. 실행 파일을 앱 번들로 바꿔도 `registered Core launch requires an installed app` 오류가 계속되었습니다.

daemon supervisor를 종료하고 두 실행 선택 변수를 제외한 프로세스 환경에서 다시 시작한 뒤, 동일 Codex 세션이 정상적으로 PLAN을 읽고 파일을 생성했습니다. `scripts/start-paseo.ps1`에 재현 가능한 실행 절차를 보존했습니다. 전역 환경 변수, 사용자 Codex 설정, sandbox 또는 승인 정책은 변경하지 않았습니다.

앱 번들 실행 파일 경로는 Paseo의 `agents.providers.codex.command`에 설정되어 있습니다. Codex 앱 업데이트로 버전별 경로가 바뀌면 유효한 설치 경로로 갱신해야 합니다.

## 실제 검증

| 항목 | 결과 |
| --- | --- |
| Plugin 서버 로드 및 RPC 등록 | running, project.read / request.list / request.start |
| Feature Request 화면 | 여섯 필드, 최근 요청, 세션 이동 표시 |
| 빈 양식 제출 | 검증 오류 표시, 요청 생성 안 됨 |
| GUI 실행 중 재입력·중복 제출 | 필드와 실행 버튼 비활성화 |
| RPC 요청 | REQ-smoke-20261112-001 |
| GUI 요청 | REQ-mwcyphtz-fnthmzhhky |
| Worktree 격리 | 두 요청 모두 sandbox와 동일 Git common-dir, 별도 branch/path |
| PLAN 전달 | 두 세션이 Request PLAN과 Task PLAN을 읽음 |
| 실제 Codex 작업 | POC_PROOF.md / GUI_PROOF.md 작성 및 재읽기 |
| 세션 추적 | GUI의 Codex 세션 열기로 실제 Paseo 대화로 이동 |
| 재시작 후 중복 요청 | 동일 workspaceId·agentId 반환 |
| 초기 버전 타입 검사와 단위 테스트 | typecheck 통과, 핵심 테스트 4개 통과 |

RPC 세션: `9eee15c0-42ad-4bf2-bd1e-279d0962f3cb`.

GUI 세션: `a6fe3328-c50c-41fe-a6f9-0c0f92ea2d86`.

증거 파일:

- `C:\Users\USER\.paseo-orchiva\worktrees\2i1x1t9p\orchiva-task-smoke-20261112-001\POC_PROOF.md`
- `C:\Users\USER\.paseo-orchiva\worktrees\2i1x1t9p\orchiva-task-mwcyphtz-fnthmzhhky\GUI_PROOF.md`

## 검증 범위와 한계

테스트는 동시 중복 요청, 실행 도중 오류와 재시도, 같은 키로 변경된 입력 거부, 입력 검증 및 저장 경로 탈출 방지를 확인합니다. 실연동은 두 개의 작은 파일 생성 요청으로 확인했으며 장시간 작업이나 여러 daemon의 동시 접근은 검증하지 않았습니다. JSON 저장은 단일 Plugin 인스턴스를 전제로 합니다.

호스팅 웹 앱에서 로컬 연결은 시간 초과가 발생했습니다. 대신 공식적으로 제공되는 같은 버전의 bundled web UI를 `features.webUi.enabled=true`로 켜서 UI 검증을 완료했습니다. 호스팅 앱의 연결 실패 원인은 확정하지 않았습니다.

참고: [Paseo Plugin quickstart](https://paseo.sh/docs/plugins), [로컬 웹 UI](https://paseo.sh/docs/web-ui), [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## 실행 생명주기 확장 검증

2026-11-12, 위 환경에서 실제 Codex 세션 두 개와 Plugin RPC·GUI로 검증했습니다.

| 항목 | 결과 / 근거 |
| --- | --- |
| 성공 사례 | `lifecycle-success-20261112-001`: sum(2,3)=5, sum(-2,2)=0. 독립 테스트 2개 통과, 종료 코드 0 |
| 의도적 실패 | `lifecycle-failure-20261112-001`: increment(n)이 n을 반환. 원래 테스트에서 `1 !== 2`, 종료 코드 1을 수집하고 failed 표시 |
| 동일 작업 복구 | 기존 Codex 세션·Worktree 유지, 시도 2에서 n+1로 수정, 원래 테스트 1개 통과 |
| 테스트 불변성 | 복구 전후 feature.test.mjs의 SHA-256이 `ac419489fa43b8ab51e67c33cd6df419abcab32cbc465745cb03ec53dba4a3aa`로 동일 |
| 실패 증거 보존 | attempts[0]에 최초 테스트 종료 코드·실패 로그·최종 응답 보존 |
| 결과 수집 | 최종 응답, 변경 파일 4개(계획 2개 포함), 파일 지문, 검사 명령·로그·소요 시간 수집 |
| 완료 판정 | 성공 보고만으로 완료하지 않음. awaiting-review에서 근거와 확인을 거쳐 completed |
| GUI | 실제 성공 카드의 결과 펼침, 테스트 로그, 비활성 완료 버튼 → 체크·근거 입력 → 완료 확정 확인 |
| 중복 복구 | 같은 복구 키 재호출 시 시도 2·기존 세션 유지 |
| 재시작 | 독립 daemon supervisor까지 재시작한 뒤 completed·판정·실패 증거·ID 유지 및 원래 테스트 재통과 |
| 기존 흐름 회귀 | v1 RPC·GUI 두 요청의 PLAN, Worktree, 증거 파일, 재호출 검증 통과 |
| 자동 테스트 | 타입 검사 및 12개 테스트 통과 |

성공 세션: `7c8b0a20-bdfb-4a08-8a1c-027264f0bf8e`, workspace `wks_57e0ea26286066df`.

실패·복구 세션: `463829e1-6849-42e9-95ad-9fa315bf0711`, workspace `wks_075655fb9cbf26bd`.

실제 코드와 테스트:

- `C:\Users\USER\.paseo-orchiva\worktrees\2i1x1t9p\orchiva-task-lifecycle-success-20261112-001\feature.mjs` 및 `feature.test.mjs`
- `C:\Users\USER\.paseo-orchiva\worktrees\2i1x1t9p\orchiva-task-lifecycle-failure-20261112-001\feature.mjs` 및 `feature.test.mjs`
- 요청별 영속 기록: `%USERPROFILE%\.orchiva\requests\lifecycle-*-20261112-001.json`

재검증: `npm run typecheck`, `npm test`, `npm run verify`, `npm run verify:lifecycle`.

추가 자동 테스트는 권한 대기 상태, 오래된 결과 ID·변경된 파일 승인 거부, 중단된 실행, 오래된 Hook 무시, 전송 결과가 불확실한 복구의 중복 방지, 구버전 JSON 마이그레이션, 명시적 재검증, Windows 경로·파일 쓰기 차단을 다룹니다. 권한 대기·전송 불확실성·중단 Hook은 모의 Runtime 테스트이며 실제 네트워크 단절 시험은 아닙니다.

검증 도중 Node 24의 Windows 테스트 검색이 드라이브를 포함한 절대 파일 경로를 찾지 못했습니다. Worktree를 cwd로 유지하고 테스트 경로를 `./feature.test.mjs`로 전달하도록 수정했습니다. 실제 두 사례를 재검증해 인프라 오류와 의도적 assertion 실패를 구분했습니다. 당시 실패 상태 전이도 이력에 보존했습니다.

PoC의 JSON 저장·잠금은 단일 Plugin 인스턴스 전제입니다. Hook 누락 보완은 화면·RPC 조회 시 이루어지며 무인 상시 스케줄러는 없습니다. 결과 지문은 HEAD와 Git 변경·미추적 파일을 대상으로 하며 ignored 파일을 포함하지 않습니다. 최종 응답 조회는 최근 100개 timeline 항목입니다. 자동 테스트를 에이전트가 작성하므로 테스트 통과만으로 자연어 완료 조건 전체를 보증하지 않으며 최종 검토를 유지합니다.

## 다음 단계: 프로토타입용 MVP 설계

이 PoC의 상태·결과·시도·판정 모델과 실제 검증 사례를 설계 입력으로 고정합니다. 첫 MVP는 요청 등록 → 계획 확인 → 단일 작업 실행 → 결과 검토 → 실패 재개까지로 범위를 정하고, 화면 흐름·데이터 모델·상태 전이·완료 기준·개발 순서를 구체화합니다. 다중 TASK 의존성, 무인 자동 복구, 일반 검증 어댑터, PR/merge 자동화는 별도 우선순위로 결정합니다.
