# D6a 배포·첫 실행 기반

2026-11-17 · Windows 11 x64 · 기준 `e0248d9` + 미커밋 D5 변경 보존.

사용자가 D6 구현 시작을 지시했다. 이번 범위는 self-contained 폴더 배포와 첫 실행·빈 환경 연결이다. **D6 전체는 진행 중**이며 새 PC 설치·로그인이나 업데이트·전체 통합 수용 완료를 뜻하지 않는다. [계획](../plans/desktop-transition.md#d6-상세-실행-범위), [증거 요약](../evidence/desktop-transition/d6-20261117/summary.json), [실행 안내](../guides/desktop-package.md)를 함께 따른다.

## 구현

- `scripts/package-desktop.mjs`: 소스 allowlist와 별도 Paseo lockfile로 신규 출력 폴더에 설치·publish. 기존 출력 덮어쓰기 없음. .NET/Windows App SDK, Node 26.13.0, Paseo 0.15.4, Plugin 의존성을 동봉한다. 사용자 인증·데이터·로컬 node_modules를 복사하지 않는다. 공개 Paseo의 빈 키 `.env.example`만 검사 후 정확한 경로 예외로 허용했다.
- `orchiva-package.json`: 파일별 SHA-256·크기, 런타임 버전, 로컬 검증 채널. 필수 PRI/XBF/.NET/Node/CLI 파일 누락, 파일 변경/추가, 경로 이탈·중복·링크 및 대표 인증 파일명을 검사한다. 서명이나 전체 비밀 탐지를 대체하지 않으며 앱 시작 시 전체 hash 검사는 아직 없다.
- `PackagedProfile`: 환경 변수 없는 exe 진입에서 LocalAppData의 별도 profile을 sibling staging→directory rename으로 게시한다. 동시 첫 실행은 하나의 profile을 재사용하며 부분 생성·미래 버전·설치 경로 변경은 자동 덮어쓰지 않는다. 설치 경로와 사용자 데이터를 분리한다. 같은 설치에서 설정·포트를 재사용하고 자식 PATH에 동봉 Node를 우선한다. 사용자 전역 환경은 바꾸지 않는다.
- 빈 legacy store에서는 과거 `project.json`을 요구하지 않고 기존 daemon 연결 상태를 복원한다. 활성 legacy 작업이 있으면 해당 설정/복원 실패를 계속 차단한다. UI는 작업실 등록 안내와 기존 MVP 프로젝트 없음 상태를 표시한다.
- WinUI publish에 생성된 PRI와 XBF의 상대 경로를 명시적으로 포함했다. 기존 개발 실행 `ORCHIVA_DESKTOP_CONFIG`도 유지한다. 앱 종료는 bridge만 닫고 daemon은 유지한다.

## 검증 결과

| ID | 종류·명령/조건 | 기대 결과 | 실제 결과 |
| --- | --- | --- | --- |
| D6A01 | 정적·자동: `npm run typecheck`, `npm test` | 기존 회귀와 빈 legacy 복원 | 통과, Node 121/121 |
| D6A02 | 자동: `node --test scripts/package-desktop.test.mjs` | 손상·추가·인증 파일·PRI 누락·경로 이탈·중복 거부 | 1개 시나리오 묶음 통과 |
| D6A03 | 자동: C# 전체 test, fixture 변수 없음 | profile·프로토콜 경계 | 10 통과/8 환경 미지정 건너뜀, 실패 0. D6 실제 fixture는 아래 별도 실행 |
| D6A04 | 자동·실제: `ORCHIVA_D6_PACKAGE` 지정 후 `--filter FullyQualifiedName~PackagedProfileTests` | 동시 게시 1개, 미래/부분/다른 설치 거부·원본 보존, packaged bridge 재연결 | 최종 005에서 3/3 통과. 모델 실행 없음, 새 임시 profile, public daemon stop 후 보존 |
| D6A05 | 실제: `desktop:package build`, 한글·공백 출력 005 | self-contained 산출물과 완전성 | Release publish 경고/오류 0. 32,567파일, 1,154,149,958바이트(약 1.07 GiB). .NET/WindowsDesktop 10.0.12 동봉. manifest hash는 요약에 기록 |
| D6A06 | 실제: 동봉 실행부 사용 후 `desktop:package verify` | 설치 파일 불변 | 전체 파일 hash 통과 |
| D6A07 | GUI: 개발 config/DOTNET_ROOT 변수 없이 exe, 1266×893 | 첫 실행 자동 준비·연결, 과거 프로젝트 없어도 사용 가능 | [첫 실행](../evidence/desktop-transition/d6-20261117/first-launch.jpg), [빈 기존 프로젝트](../evidence/desktop-transition/d6-20261117/empty-legacy.jpg) 통과. .NET 설치 안내창 없음 |
| D6A08 | GUI: 사용자가 540×893으로 축소, 새로 고침 | 안내/주요 버튼 접근, 빈 조회 정상 | [compact](../evidence/desktop-transition/d6-20261117/empty-legacy-compact.jpg) 통과. 자동 크기 조정이 적용되지 않아 사용자 조작 참여 |
| D6A09 | GUI·실제: 닫기→같은 exe 재열기 | bridge 종료, 같은 daemon/profile 재사용 | [재열기](../evidence/desktop-transition/d6-20261117/reopened.jpg), [전](../evidence/desktop-transition/d6-20261117/runtime-before-reopen.json)/[후](../evidence/desktop-transition/d6-20261117/runtime-after-reopen.json) profile hash·서버 PID/startedAt 동일. Agent/Workspace 각 0 |
| D6A10 | 실제: 앱 종료·소유 profile daemon stop | 시험 프로세스/포트 정리·데이터 보존 | [정리](../evidence/desktop-transition/d6-20261117/cleanup.json): 패키지 프로세스 0, GUI endpoint listen 없음. profile 및 실패 증거 보존 |

GUI는 현재 개발 PC에서 검사했다. 개발용 .NET 환경 변수를 제거하고 동봉 runtime을 사용했지만 Windows 구성 요소가 전혀 없는 새 PC에서 시험한 것은 아니다. Git/Codex의 미설치·미로그인 경로와 실제 모델 호출은 이번 배포 검증에서 실행하지 않았다. C#의 과거 D1/D4/D5 live fixture는 새 검증 재료로 사용하지 않았다.

패키지 설치에서 npm은 esbuild·msgpackr-extract·node-pty의 install script 미승인 경고 및 일부 전이 의존성 deprecation 경고를 냈다. npm 전역 승인 설정을 바꾸지 않았다. 실제 daemon/Plugin 연결은 통과했으나 터미널/모델 실행을 포함한 패키지 전체 수용은 남아 있다. lockfile 기반 전체 의존성 동봉이어서 현재 용량이 크다.

## 발견한 실패와 수정

001은 publish에 전역 RID를 전달해 공용 Bridge lockfile과 충돌했다. 앱 전용 self-contained 속성으로 고쳤다. 002의 C# IDictionary 호출 오류는 TryGetValue로 고쳤다. 003은 공개 `.env.example`가 인증 파일명 검사에 걸려 내용을 확인하고 해당 공급자 템플릿만 허용했다.

004는 빌드·hash·실행부 검사를 통과했지만 GUI가 `Microsoft.UI.Xaml.dll`의 `0xc000027b`로 종료됐다. build 폴더의 `Orchiva.Desktop.pri`, 화면/테마 XBF 5개가 publish에 없었다. publish target과 필수 파일 검사로 보완한 005에서 실제 exe·GUI·재열기가 통과했다. 파일 hash만으로 실행 가능성을 판단하지 않았다. 실패한 001~004 출력은 `.desktop-local`에 보존했다.

선택한 방식의 공식 근거: [.NET self-contained 배포](https://learn.microsoft.com/en-us/dotnet/core/deploying/), [WinUI unpackaged 배포](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/unpackage-winui-app). .NET과 Windows App SDK self-contained는 각각 설정했으며 Node/Paseo는 별도 동봉했다.

## 남은 D6

아래 목록은 D6a 종료 시점의 잔여 항목이다. 후속 [D6b 결과](desktop-d6-integration.md)에서 도구/인증 진단·현재 PC 통합·업데이트/복구를 마쳤다. 새 PC 실측은 사용자 지시로 별도 PLAN에 보류했다.

1. Git/Codex 설치·정상 로그인 및 미설치/미로그인 안내를 포함한 새 PC 실측.
2. 실행 중인 버전의 교체·정상 종료·호환 데이터 보존·중단 복구. 현재는 다른 설치 경로를 거부하는 보호만 있으며 자동 업데이트/rollback을 제공하지 않는다.
3. 배포본의 실제 제작·상담·미디어 성공/실패/복구, 활성 작업 중 창 닫기/재연결, 소유 worker 장애와 중복·저장 경계의 전 단계 수용.
4. 코드 서명, 전이 의존성의 라이선스 고지·재배포 조건 검토, 배포 크기 최적화와 정식 지원 Windows 판정.

D5 및 D6 변경은 로컬 상태로 보존했으며 이번 요청으로 commit/push하지 않았다. 설치본은 로컬 검증용이고 공개 배포하지 않았다.
