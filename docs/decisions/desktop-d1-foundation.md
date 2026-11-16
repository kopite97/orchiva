# D1 데스크톱 연결 기반 구현 기록

작성일: 2026-11-16 · Asia/Seoul. 상태: **부분 구현·검증, D1 미완료**. 아래 초기 실행 차단 이후 사용자 환경 변경으로 C# 7/7과 핵심 GUI 검증을 수행했다. 최신 상태는 [D1 화면 검증](desktop-d1-gui-verification.md)을 따른다.

후속 상태: [실행부 보완과 비GUI 검증 완료](desktop-d1-runtime-completion.md). 아래 내용은 해당 실행 당시 기록이며 최신 결과와 GUI 대기 목록은 후속 문서를 따른다.

사용자가 “PLAN을 승인할게 작업 시작해줘”라고 지시하여 [전환 계획](../plans/desktop-transition.md)을 active로 전환했다. 기준은 `b08dc13`, 작업 브랜치는 `codex/desktop-d1-foundation`이다. 기존 문서 변경은 보존했고 최초 구현 전 HEAD와 당시 docs 사본을 `%LOCALAPPDATA%/Temp/orchiva-d1-baseline-20261116-103150`에 저장했다. commit·push는 하지 않았다.

## 구현 결정

| 항목 | 선택과 근거 |
| --- | --- |
| UI | 사용자 선택인 WinUI 3 + .NET 10. 설치된 SDK `10.0.401`을 global.json에 고정, rollForward disabled |
| 패키지 | Microsoft.WindowsAppSDK `2.6.5`, Windows.SDK.BuildTools `10.0.26100.6584`. NuGet에서 존재 확인 후 실제 restore/build 통과. 세 프로젝트의 packages.lock.json 보존 |
| 개발 실행 | Windows x64, `net10.0-windows10.0.26100.0`, 최소 OS build 19041. unpackaged + WindowsAppSDKSelfContained 개발 출력. .NET 런타임은 설치된 10.x를 사용하며 최종 배포 형식은 D6에서 결정 |
| 연결 | C# → 소유 Node child stdio JSON → 공개 `createHostClient`/`invokePluginRpc` → 기존 Plugin. 자체 HTTP 서버나 Paseo wire protocol 재구현 없음 |
| 저장·실행 소유 | 기존 Plugin의 JsonRequestStore와 reconciler만 소유. C#·bridge는 요청 JSON을 쓰지 않음. v2 변경·마이그레이션 없음 |
| 수명 | 화면은 bridge를 소유하고 닫을 때 stdin EOF·대기·소유 child 정리. daemon은 독립 수명. 명시적 시작은 지정된 격리 home만 대상으로 하며 다른 daemon 종료 기능 없음 |
| 닫기 설정 | 기본 앱 종료, 선택 시 트레이 최소화·열기·명시 종료 코드 추가. 설정 저장 포함. 실제 GUI 검증은 환경 차단. 제작 실행 중 종료 정책은 D3에서 상세화 |
| 테스트 경계 | 원래 6767 대신 새 loopback 포트, 실행별 별도 data/paseo home. 모든 격리 설정을 함께 요구하고 부분 설정 fallback·production home·루트 밖 경로 거부. sandbox 제한 유지 |

버전 확인 출처: [Windows App SDK 채널](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-channels), [NuGet 실제 버전 목록](https://api.nuget.org/v3-flatcontainer/microsoft.windowsappsdk/index.json), [배포 개요](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview). 특정 SDK 조합의 빌드 성공과 이 PC에서의 실행 허용은 별개다.

## 코드에 반영한 범위

- `desktop/Orchiva.Desktop`: 프로젝트, PLAN 이력·상세, 연결 상태, 설정 화면. WinUI 기본 테마·카드·타이포그래피·간격 리소스와 한국어 상태 문구. 마지막 조회 정보 보존, 중복 연결 방지, 페이지 단위 조회. 와이어프레임 14개 전체 구현은 아님.
- `desktop/Orchiva.Bridge`: 숨김 프로세스·인수 배열, 요청 ID 대응, 시간·크기 제한, stdout 파싱과 stderr drain, 취소·dispose, 격리 runtime launcher.
- `bridge/`: major 1 envelope, handshake와 서버 정체성 대조, 조회 allowlist, 1 MiB frame, 최대 8개 동시 조회, 15초 RPC timeout, bounded stdout. 오류 원문·인증값을 출력하지 않음.
- runtime 설정 주입과 `runtime.info`: 격리 home/endpoint, Plugin PID·시작 시각·복원·읽기 capability. 환경 변수가 없을 때 기존 브라우저 MVP 기본 경로 유지.
- 격리 하네스: 새 실행 ID, 유효 v2 합성 초안·완료/결과/판정, 원본 요청 해시 대조, 실제 SDK 조회, owner 중복 거부, bridge 종료·재연결, offline 오류 확인.

조회 allowlist는 `runtime.info`, `project.read`, `request.page`, `request.detail`, `runtime.status`, `storage.diagnostics`다. `start`, `resume`, `review`, `refresh` 등은 SDK 호출 전에 거부한다. 프로젝트 추가·docs 초기화·AI PLAN·제작·질문·소스 반영 기능은 아직 없다.

## 검증 결과

아래 표는 run 001/002의 초기 결과다. 실행 차단 해소 후 run 003의 결과는 [D1 화면 검증](desktop-d1-gui-verification.md)에 기록한다.

[요약 증거](../evidence/desktop-transition/d1-20261116-002/summary.json), [개발 실행 안내](../guides/desktop-development.md)를 함께 본다. 첫 run `d1-20261116-001`은 초안 3건, 두 번째 run은 초안 2건·합성 완료 1건이다. 실제 모델 완료 기록으로 해석하지 않는다.

| 검증 | 결과·한계 |
| --- | --- |
| V01 정적·자동 | typecheck 통과, Node 94/94. 기존 89개에 bridge 경계 5개 추가. package-lock.json 불변 |
| V02 build | locked restore와 WinUI x64 build, .NET 테스트 프로젝트 build 모두 경고 0·오류 0 |
| V02 .NET test | **환경 차단**. testhost가 새 테스트 DLL을 로드하지 못함. Windows CodeIntegrity 3033/3077, `0x800711C7`. 통과 테스트 수로 집계하지 않음 |
| V03/V04 모의 | Node split UTF-8·합친 frame·잘못된 UTF-8/크기·major·중복 ID·동시 한도·allowlist·입력·정체성 거부 통과. C# out-of-order·오염·취소·oversize·응답 누락 테스트는 작성/빌드만 완료, 실행 차단 |
| V05/V06 실제 | 격리 SDK handshake·프로젝트·초안/완료 상세·빈 active 목록 조회, Agent/Workspace 각 0, 두 번째 store owner 거부, 요청 원본 바이트 불변. 다른 home 오접속은 모의 검증 |
| V07 실제 일부 | daemon 정지 상태의 stdio handshake는 CONNECTION_FAILED, 후속 조회는 HANDSHAKE_REQUIRED, stderr 0바이트. 잘못된 credential·timeout·GUI stale 상태는 미완료 |
| V08 실제 일부 | 소유 bridge 3회 연결·조회·EOF 종료, 모두 exit 0·stderr 0. .NET 앱·트레이·재열기·반복 dispose 실행은 차단 |
| V09 실제 | 격리 daemon 정상 정지→같은 home 재시작→조회. Plugin PID 변경, 동일 fixture의 PLAN·결과·판정 해시 유지. restoring 중 GUI 표시는 미검증 |
| V10 GUI | **환경 차단**. 생성된 exe 실행도 CodeIntegrity가 거부. 1280/800 폭, DPI, 밝은/어두운 테마, 키보드·대비·트레이 실제 동작 미검증. 기존 HTML 시안 캡처로 대체하지 않음 |
| V11 경로 | 부분 환경·루트 이탈·금지 endpoint는 Node 자동 검증. 실제 한글/공백 설치 경로와 잘못된 child 실행 사례는 미완료 |
| V12 정리 | 두 실행의 격리 daemon 종료, 원래 54개 요청 해시 유지. 최종 포트·프로세스·sandbox Git 상태는 증거 JSON 참조. 실패·fixture 원본은 ignored `.desktop-local/`에 보존 |

## 초기 차단 사항과 당시 다음 작업

다음 두 문단은 run 001/002 당시 기록이며 현재 차단 상태를 뜻하지 않는다. Windows 애플리케이션 제어가 새 exe와 테스트 DLL 실행을 거부했다. 이벤트에는 Enterprise signing level/code integrity policy 미충족이 기록됐다. 보안 정책·인증·전역 환경을 변경하지 않았고 다른 실행 경로로 우회하지 않았다. 실행이 허용되는 개발 환경 또는 승인된 서명/실행 정책을 갖춘 환경에서 검증을 이어가야 한다.

D1은 active로 남긴다. 다음 순서는 .NET 테스트(7개 작성, live fixture 필요 사례 포함), 실제 앱 연결, 닫기/트레이와 3회 재열기, 디자인·DPI·접근성, V07/V11 미완료 경계다. 공용 wire fixture와 C# 요청 DTO를 추가했으며 C# 실행 검증과 UI 상태별 검토가 남아 있다. D1 완료 조건을 충족하기 전에 D2 기능을 완료했다고 표시하지 않는다. D2~D6는 미착수다.
