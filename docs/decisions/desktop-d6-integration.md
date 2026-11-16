# D6b 현재 PC 배포·통합 수용

2026-11-17 · Asia/Seoul. 기준 `e0248d9` 이후 로컬 D5/D6 변경. 사용자가 새 PC 검증을 보류하고 남은 D6 구현과 현재 PC 검증을 계속하도록 지시했다. [활성 계획](../plans/desktop-transition.md), [배포 안내](../guides/desktop-package.md), [검증 요약](../evidence/desktop-transition/d6b-20261117/summary.json)을 따른다.

## 결정과 구현

설정 화면에 Git·Codex 실행과 인증 상태의 읽기 전용 진단을 추가했다. CLI 원문이나 인증값을 표시하지 않으며 로그인·설치·전역 정책 변경을 수행하지 않는다. 인증 상태 확인과 실제 모델 접근 성공은 구분한다.

`desktop-maintenance.mjs`는 전체 패키지 hash·데이터 형식과 사용자가 확인한 profile hash를 검증한 뒤 오프라인으로 설치 위치를 교체한다. 앱의 C# named pipe와 Node 저장 writer는 같은 소유권 이름을 사용한다. 앱/daemon/저장 writer, 활성·미확정·손상 기록이 있으면 교체를 거부한다. profile·Plugin 경로 외의 요청·대화·결과는 변환하지 않는다.

동기화한 임시 파일을 rename하여 journal을 게시하고 두 설정 파일을 순서대로 교체한다. 중단 시 동일 패키지/hash의 `recover`로 앞으로 완료하며 외부 변경은 덮어쓰지 않는다. 시작 시 pending journal이 있으면 앱도 복구 안내로 차단한다. 원래 설정과 완료 journal은 profile 안에 보존한다. journal 보관 폴더가 junction/symlink이면 설정 변경 전에 거부한다. 자동 다운로드·자동 rollback·이전 데이터 형식 변환은 구현 범위가 아니다.

## 실제 시험 범위

새 실행 `d6b-20261117-live-001`과 소유 복제본 `시험 소스`, 별도 profile/Paseo home/포트를 사용했다. 원본 PoC·기존 D1~D5 결과·사용자 Unity/Aseprite 프로젝트·인증 파일은 수정하지 않았다. 소스 백업은 활성 계획에 기록했다.

배포 001에서 코딩과 임시 PNG/WAV/효과 제작, 상담을 실제 실행했다. 배포 002에서 원자적 journal 보완과 교체·중단 복구를 검증했다. 최종 배포 003은 journal 보관 경로의 링크 거부를 추가했다. 각 배포 폴더와 당시 결과는 덮어쓰지 않는다. 최종 파일 수·크기·manifest hash는 요약 JSON에 기록한다. 전부 서명 없는 로컬 사전 검증본이다.

## 검증 결과

| ID | 종류·절차 | 기대 결과 | 실제 결과·근거 |
| --- | --- | --- | --- |
| D6B01 | 정적·자동: typecheck, `npm test`, package test | 회귀·교체 실패 경계 유지 | 타입 통과, Node 125/125, package 1/1. mock package 검사를 사용하는 교체 경계 4건은 실제 전체 hash 검사와 구분 |
| D6B02 | 자동·현재 PC 진단: C# tests | profile/소유권·진단·인증 원문 비노출 | 13 통과/8 과거 live fixture 미지정 건너뜀. pending 시작 차단은 추가 focused 1/1. release publish 성공 |
| D6B03 | 실제: 코딩 PLAN→실행→실패→같은 세션 재개 | 원래 검사·과거 실패·세션 정체성 보존 | 실제 `answer.txt` 검사 통과 후 41로 변경해 실패, 같은 Agent/Worktree에서 42로 복구. 실패 result 보존 |
| D6B04 | 실제: 아트·사운드·효과 PLAN/실행 | 실제 파일 형식·preview·해시 일치 | PNG 128×96, PCM16 mono 44,100 Hz/1.5초, 64×64 8프레임 효과 시트. 임시 절차적 생성이며 외부 생성 모델 시험 아님 |
| D6B05 | 실제: 4개 제작의 review/export/apply/undo와 같은 명령 재호출 | 요청 파일만 반영·중복 실행 없음·원본 복원 | 네 사례 통과. start/resume/apply의 같은 키 재호출, 출력 byte 대조, undo 후 원본 출력 부재 확인 |
| D6B06 | GUI·실제: 실행 중 창 닫기→완료 후 재열기 | 창 종료 중 작업 유지·결과 재조회 | 닫기 직전 `running`, 앱 프로세스 종료 후 완료·복구. [재열기 화면](../evidence/desktop-transition/d6b-20261117/reopened-result.jpg)의 result ID와 하네스 동일 |
| D6B07 | GUI: 설치/인증 진단, 넓은/작은 창 | 문구·버튼 접근과 상태 갱신 | [1266×893](../evidence/desktop-transition/d6b-20261117/diagnostics-wide.jpg), [520×893](../evidence/desktop-transition/d6b-20261117/diagnostics-compact.jpg) 통과. 크기 축소는 사용자 참여 |
| D6B08 | 실제: 상담 첫 응답 후 소유 Plugin 강제 종료·명시적 reload·후속 응답 | 같은 Agent/턴 보존·중복 메시지 없음 | PID 25072→25324, 같은 Agent에서 두 턴 answered. 자동 재기동이 아닌 공개 `plugin reload` 복구. 제작 결과도 유지 |
| D6B09 | 실제: SDK 전체 목록과 기록 대조 | 생성 수·ID 일치 | Agent 5, 제작 Worktree 4, 상담 local checkout 1, Workspace 합계 5. 결과/Agent/Workspace ID 및 상담 두 턴 일치 |
| D6B10 | 실제: 기존 D6a 소유 기본 profile의 정상 교체·exe 시작 | 개발 환경 변수 없이 같은 profile 사용 | 005→002 교체 및 [정상 연결](../evidence/desktop-transition/d6b-20261117/updated-first-launch.jpg). 실행 앱의 C# 소유권이 Node 교체 writer를 거부하는 것도 실제 확인 |
| D6B11 | 실제: 실행 중 교체 시도, 설정 교체 직후 자식 프로세스 exit 86→recover | live 거부·완전한 journal·원본 보존 | `UPDATE_RUNTIME_RUNNING` 거부. config만 바뀐 중단 지점에서 복구, 소스 docs·출력·요청·registry 60파일 hash 전후 동일. 최종 003의 동봉 관리 CLI로 두 소유 profile을 교체한 뒤 재시작에서도 동일 ID/개수·60파일 hash 확인. GUI 검증한 002와 003의 앱/Bridge/PRI byte 동일 |
| D6B12 | 실제: public daemon stop·프로세스/포트 대조 | 소유 실행 종료·데이터 보존 | [정리 결과](../evidence/desktop-transition/d6b-20261117/cleanup.json). 기존 시험 데이터·업데이트 journal 보존 |

하네스 `verify`의 첫 Workspace 예상값은 4여서 실패했다. 실제 SDK 목록을 확인하니 상담이 원본 경로에 `local_checkout` Workspace 1개를 등록했다. 네 제작 Worktree ID를 각각 대조하고 상담 checkout 경로·합계 5개를 검사하도록 하네스를 수정했다. 실패와 수정 근거는 요약에 보존했으며 중복 생성이나 새 모델 재실행으로 해결하지 않았다.

## 재현과 보존

`scripts/desktop-integrated.mjs`의 setup/coding/media/conversation은 새 실행용이며 실제 모델 호출·복제본 편집을 포함한다. conversation은 소유 Plugin 종료와 명시적 reload를 포함한다. 기존 실행에 다시 생성 명령을 적용하지 않는다. verify는 기존 기록과 전체 목록을 대조한다. `scripts/desktop-update-verification.mjs`는 같은 소유 실행에서 모든 작업 완료·daemon 종료 후 사용하는 실제 업데이트 중단 시험이다. baseline이 이미 있으면 덮어쓰지 않는다.

로컬 `.desktop-local/d6b-20261117-live-001`에는 요청 원본·실패 결과·업데이트 baseline/journal 및 모델 실행 기록이 남는다. 공개 근거에는 인증값·원본 요청 전체를 복사하지 않는다. 최신 배포본의 전체 파일 hash를 확인한 뒤 사용하며 manifest는 코드 서명을 대체하지 않는다.

## 남은 범위

현재 PC의 D6b 구현·검증은 완료했다. 새 PC 설치·로그인·OS 의존성·재부팅은 [별도 PLAN](../plans/desktop-fresh-pc-validation.md)의 `proposed` 항목으로 실행하지 않았다. 정식 공개 배포의 서명·재배포 고지 검토와 지원 OS 최종 판정은 남는다. 1.07 GiB 수준의 폴더 배포를 사용하며 크기 최적화는 하지 않았다. 이 때문에 전체 D1~D6 계획은 `active`를 유지한다. 검증 당시 변경은 로컬 저장이었다. 이후 사용자가 D6까지의 커밋·main 반영·push를 지시했으며 최종 반영은 Git 이력을 따른다.
