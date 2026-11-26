# D1 실행부 보완과 비GUI 검증 완료

작성일: 2026-11-16 · Asia/Seoul. 기준: `b08dc13` 이후 `codex/desktop-d1-foundation`의 로컬 변경. 상태: **D1 구현·비GUI 검증 완료, GUI 수용 검증 대기**.

사용자가 Paseo 콘솔 창 문제 수정과 남은 D1 검증을 지시하면서 컴퓨터 유스는 대기사항으로 남기도록 요청했다. 이번에는 WinUI 창을 열거나 화면 조작 도구를 사용하지 않았다. [이전 실제 화면 검증](desktop-d1-gui-verification.md)은 그대로 보존한다. 아래 GUI 대기를 통과로 바꾸거나 전체 전환 완료로 표시하지 않는다.

## 콘솔 생성 경로와 수정

설치된 Paseo CLI 0.15.4의 공개 `daemon start`는 내부 supervisor를 `detached: true`로 생성한다. Windows에서 이 옵션은 별도 콘솔을 만드는 경로이며, 외부 launcher의 `windowsHide`만으로 전체 프로세스 트리를 제어하지 못한다. [Node 프로세스 문서](https://nodejs.org/api/child_process.html#optionsdetached)와 설치된 CLI의 `local-daemon.js`, 공개 server export `daemon-control` 호출을 대조했다. 설치 패키지를 수정하거나 private entry point를 직접 실행하지 않았다.

현재 시작 순서는 다음과 같다.

1. C# `RuntimeLauncher`가 `UseShellExecute=false`, `CreateNoWindow=true`, 인수 배열로 Node의 `bridge/index.ts --run-daemon`을 시작한다.
2. Node 호스트는 격리 경로·home·포트·CLI와 config의 일치를 확인한다. 같은 실행부가 이미 준비됐으면 재사용한다. 자식 환경에서 `PASEO_*` 배포 override를 제거해 선택한 home의 설정이 기준이 되게 하고, 기존 Codex 자식 환경 조정 범위를 유지한다. 전역 환경은 바꾸지 않는다.
3. 공개 `paseo daemon run --home <경로>`를 `detached:false`, `windowsHide:true`, `stdio:ignore`로 실행한다. SDK handshake에서 실제 Plugin의 격리 home·endpoint까지 확인한 뒤 고정된 `DAEMON_READY` 토큰만 반환한다. C#은 토큰 길이만큼만 읽는다.
4. Node 호스트와 CLI는 daemon이 살아 있는 동안 유지한다. C# 시작 호출은 준비 확인 후 반환하며 앱의 조회 bridge와 daemon 수명은 분리된다. 공개 `daemon stop`을 호출하면 daemon·CLI·호스트도 종료한다.
5. 시작 실패·45초 준비 제한 초과 시 생성한 자식만 정리한다. C# 호출 취소·65초 제한은 해당 시작 호스트와 자식 트리만 종료한다. 이미 실행 중인 다른 home을 정지하거나 요청 파일을 수정하지 않는다.

처음 시도한 `spawn(detached:false)` + 부모 종료 방식은 실제 Windows 시험에서 daemon도 함께 종료됐다. [libuv Windows 구현](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)의 부모 종료 시 job 정리 동작과 일치했다. 이를 확인한 뒤 위의 지속 호스트 방식으로 수정하고 다시 검증했다. 숨김 실행 코드와 프로세스 수명은 검증했지만 **실제 화면에 콘솔이 나타나지 않는다는 최종 시각 확인은 G01로 대기**한다.

## 검증 결과

증거는 [run 004 요약](../evidence/desktop-transition/d1-20261116-004/summary.json)에 모았다. 실제 home ID는 `d1-20261116-004-한글 경로`, 빈 저장소는 `d1-20261116-005-empty`다. 원본 요청·인증 파일·전체 daemon 로그는 공개 증거로 복사하지 않았다.

| 항목 | 종류·명령 또는 절차 | 결과 |
| --- | --- | --- |
| V01 | `npm run typecheck`, `npm test` | 타입 검사 통과, Node **97/97**, 건너뜀 0. timeout 후 handshake 무효화·재연결, 복원 중 읽기 전용 계약, 빈 페이지, production home/경로 별칭 거부 포함 |
| V02~V04 | `npm run desktop:build`, 격리 config를 지정한 `npm run desktop:test` | WinUI build 경고 0·오류 0. C# **12/12**, 건너뜀 0. [테스트별 결과](../evidence/desktop-transition/d1-20261116-004/dotnet-tests.json). 기존 framing·오염·취소·반복 dispose와 추가 시간 초과·시작 실패 경계 통과 |
| V05~V06 | 실제 SDK/Plugin 조회, 두 번째 store owner·변경 메서드 거부 | 요청 3건과 완전 빈 저장소 0건 각각 확인. Agent 0·Workspace 0, fixture·기존 요청 54건 해시 불변 |
| V07 | 응답 없는 실제 로컬 IPC, 잘못된 credential의 별도 home, 정지 daemon | 시간 초과 뒤 새 요청 성공. credential 값 유출 없이 handshake 및 후속 조회 거부. 정지 시 `CONNECTION_FAILED`, 이후 조회 `HANDSHAKE_REQUIRED` |
| V08 | C# launcher 재호출과 bridge 생성·조회·dispose 3회 | 같은 daemon PID 유지, 매회 동일 결과 ID·판정 조회, 각 소유 bridge 종료 확인. 시작을 호출한 테스트 프로세스 종료 후에도 daemon 조회 성공. **전체 WinUI 앱 3회 시험은 G05** |
| V08 실패 경계 | 별도 격리 home의 실패 CLI·취소 대상 CLI | 시작 실패는 명확한 오류, 취소 시 소유 자식 PID 종료, 기존 정상 실행부 연결 유지. 잘못된 실행 파일도 오류 확인 |
| V09 | 시험 daemon 정상 stop → 수정한 시작 경로 → verify | Plugin PID 변경 후 동일 요청·결과·판정과 바이트 보존. 준비 완료 전까지 SDK handshake를 반복 확인. 복원 상태 계약은 모의 검사, 실제 GUI 표시는 G03 |
| V10 | 빈 저장소 실제 조회·stdio 3회, 기존 run 003 화면 | 자동 조회는 통과. 이번 추가 GUI 검증은 사용자 지시로 미실행 |
| V11 | Node exe와 bridge 소스를 한글·공백 경로에 복사, 격리 data/home에도 한글·공백 사용 | 전체 C# 테스트를 해당 경로에서 수행. 인수 분리·조회·종료 정상, 허용 범위 밖 쓰기 없음. 원본 소스와 설치 패키지 수정 없음 |
| V12 | 두 시험 home 정상 stop, offline 검증, PID/port·sandbox 확인 | [정리 근거](../evidence/desktop-transition/d1-20261116-004/cleanup.json): 추적 PID 11개 잔여 0, 시험 포트 58983/51422와 기존 6767 listener 0, sandbox clean |

잘못된 credential 시험의 현재 Paseo loopback 연결은 transport 단계에서 거부되지 않고 `ENVIRONMENT_MISMATCH`로 거부됐다. 이를 인증 거부 성공으로 과장하지 않는다. 같은 경로의 정상 연결은 유지됐고 비밀값 노출·handshake 이전 조회 허용은 없었다. 향후 외부 접속·인증 정책은 D1의 격리 로컬 조회 범위에 포함하지 않는다.

검증 중 빈 페이지 mock이 필수 `active` 배열을 빠뜨린 오류와 하네스의 빈 저장소 기대 건수 오류를 수정했다. 또한 PowerShell 시작 도우미를 캡처한 stdio가 독립 실행부에 남아 하네스 반환이 지연되는 문제는 하네스 시작 프로세스의 `stdio:ignore`와 종료 제한으로 해결했다. 실패 기록은 로컬 run 디렉터리에 보존하고 요약에 정정 내용을 남겼다.

## GUI 대기 목록

사용자의 컴퓨터 유스 재개 지시 후 아래 항목만 추가 확인한다. 미실행이며 자동 테스트로 대체해 통과 처리하지 않는다.

| ID | 대기 절차 | 완료 기준 |
| --- | --- | --- |
| G01 | 실제 앱에서 격리 실행부 시작·재연결 | Paseo 콘솔 창 노출 없음, 준비/실패 표시 정상, 기존 이력 유지 |
| G02 | 800×600·1280×900, 100%·150% DPI | 주요 행동·오류·긴 한국어를 읽고 조작 가능, 잘림 없음 |
| G03 | 완전 빈 저장소 및 복원 중 화면 | 빈 상태·복원 상태·오류를 구분하고 읽기 전용 상태 유지 |
| G04 | 전체 페이지 키보드 이동·대비·포커스 | 접근성 이름과 포커스 가시성, 테마별 대비 및 스크롤 확인 |
| G05 | 전체 앱 종료·재열기 3회, 트레이 메뉴 명시 종료 | 설정·이력 유지, 조회 bridge 종료, daemon 독립 수명, 트레이 자원 정리 |

2026-11-26 재개한 G01~G05의 최신 판정은 [D1~D3 GUI 재검증](desktop-gui-resumption.md)을 따른다.

현재 D1의 구현과 비GUI 검증은 마무리됐다. [전환 PLAN](../plans/desktop-transition.md)과 목록은 `active`를 유지하며 D1을 **GUI 수용 대기**로 표시한다. D2~D6는 착수하지 않았다. commit·push는 하지 않았다.
