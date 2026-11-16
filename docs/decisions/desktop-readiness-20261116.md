# 데스크톱 후속 개발 준비 점검

작성일·점검일: 2026-11-16 · Asia/Seoul
범위: 저장소 확인, 개발 환경 점검, 기존 의존성 설치·자동 검증, 설계·계획 작성. 앱 구현과 실제 에이전트 실행은 미착수.

## 저장소와 기준점

이번 작업에서 `git rev-parse --show-toplevel`로 확인한 ROOT는 `C:/Users/USER/lib/orchiva-plugin`이다. 아래 경로는 이 PC에서 확인한 값이며 다른 PC에서는 다시 탐색한다.

| 항목 | 확인 결과 |
| --- | --- |
| 소스 원격 | `https://github.com/kopite97/orchiva.git` |
| 시작 브랜치·변경 | `main`, tracked/untracked 로컬 변경 없음 |
| 인계 기준·현재 HEAD | `b08dc1384698d988c76bdd5d24f91307fae857f4` |
| 원격 갱신 | `git pull --ff-only origin main` 성공, `Already up to date.` |
| 원격과 차이 | `git rev-list --left-right --count HEAD...origin/main`: `0 0` |
| 인계 이후 커밋 | `git log b08dc13..HEAD`: 없음. 되돌리기·강제 checkout 없음 |
| 주요 선행 이력 | `7950654` M6 완료 → `8550232` 데스크톱 인계 → `b08dc13` 문서 정리·OVERVIEW 제거 |

지침 지도와 공통 흐름·저장소·소스·검증 규칙, `docs/AGENTS.md`, `docs/plans/AGENTS.md`와 템플릿을 적용했다. [인계](../design/desktop-handoff.md), [기존 MVP](../design/mvp-design.md), [계획 목록](../plans/README.md), [M6 결과](m6-acceptance.md), PoC와 M0~M5 결정 기록을 현재 소스와 대조했다. 점검 당시에는 루트·docs·docs/plans에 AGENTS.md가 있었다. 이후 대상 프로젝트의 제품 정책을 개발 저장소 지침 변경으로 잘못 해석해 하위 지침을 변경했으나, 사용자 정정에 따라 개발 저장소의 AGENTS·공통 지침·템플릿은 원래대로 복원했다. 루트 단일 AGENTS와 역할별 파일 정책은 앱에서 초기화할 대상 프로젝트에만 적용한다.

## 개발 도구

설치 확인은 실행 파일 탐색·버전 명령과 로컬 SDK/Visual Studio 설치 목록을 이용했다. 설치됨은 인증·모델 호출·배포 성공을 뜻하지 않는다.

| 도구 | 이 PC의 결과 | 영향과 다음 조치 |
| --- | --- | --- |
| Windows / PowerShell | NT `10.0.26200.0`, x64 / `7.6.9` | Windows용 프로세스·경로 기준으로 검증 |
| Git | `2.55.0.windows.5` | 소스 원격 접근·pull 성공 |
| Node.js | `v24.19.0`, `C:/Program Files/nodejs/node.exe` | 기존 M6 검증 계열과 같음 |
| npm | `11.17.0` | lockfile 기반 설치 성공 |
| .NET SDK | `10.0.401`, `C:/Program Files/dotnet/sdk/10.0.401/` | SDK 존재. 정확한 개발 기준 버전은 미확정 |
| .NET Runtime | Core / ASP.NET Core / WindowsDesktop `10.0.12` | WPF용 참조 pack과 `dotnet new list wpf`의 C# 템플릿 확인. 빌드는 미실행 |
| Visual Studio | Community 2026 `18.10.3` | `vswhere`에서 NativeDesktop 있음, ManagedDesktop·WinUI workload 미검출 |
| WinUI 개발 도구 | `winapp` CLI 미검출, 표준 Windows Kits Include 경로·KitsRoot10 미확인 | 선택한 WinUI의 개발 workload·Windows SDK·Windows App SDK 도구 구성을 추가 확인·설치해야 함 |
| Paseo CLI | `0.15.4`, 사용자 npm 경로 | lockfile의 client·Plugin SDK `0.15.4`와 일치 |
| Codex CLI | `0.163.0`, 사용자 npm 경로 | CLI 설치 확인. Paseo가 사용할 실행 파일·실제 provider 가용성·인증 유효성은 미검증 |

필수 CLI 자체가 빠져 있지는 않다. 후속 선택은 WinUI 3이므로 WinUI 개발 workload·Windows SDK·Windows App SDK의 호환 조합을 추가 준비해야 한다. WPF pack 존재는 선택한 WinUI 개발 준비 완료를 뜻하지 않는다. `dotnet --info`의 workload 없음은 WPF 불가 판정이 아니며 Visual Studio workload와 별개다.

2026-11-16 조회한 공식 [.NET 10 다운로드](https://dotnet.microsoft.com/en-us/download/dotnet/10.0)는 SDK `10.0.404`·Runtime `10.0.15`를 제시한다. 설치된 `10.0.401`과 구분하고, 구현 착수 때 최신 지원 패치를 재확인·설치한 뒤 `global.json`으로 고정하는 것을 권장한다. 이번에는 SDK·IDE·Paseo·Codex를 업데이트하지 않았다. UI·버전·배포 후보의 선택 근거는 [전환 설계](../design/desktop-transition.md#개발-환경과-ui-비교)에 둔다.

`dotnet new list wpf`는 템플릿 조회이며 프로젝트를 생성하지 않았다. 이 PC에서 .NET CLI 첫 실행 초기화가 일어나 개발용 HTTPS 인증서 생성 안내가 출력됐다. 인증서 신뢰 명령은 실행하지 않았다.

## 소스와 로컬 실행 데이터

| 대상 | 실제 관측 | 해석 |
| --- | --- | --- |
| Orchiva 소스 ROOT | 위 소스 원격의 checkout | 앱 코드·문서의 개발 위치 |
| sandbox | `C:/Users/USER/lib/orchiva-PoC`, origin `kopite97/PoC-sandbox.git`, 로컬 변경 없음 | 기존 실행 대상. 소스 저장소와 역할이 다름 |
| sandbox 추적 ref | `main...origin/main [gone]` | 로컬 원격 추적 ref가 없음. 원격 브랜치 삭제를 확인한 결과는 아니며 이번에 sandbox fetch·설정 변경은 하지 않음 |
| 프로젝트 설정 | `.orchiva/project.json` 존재, `PoC Sandbox`, 위 sandbox, `main`, `codex/gpt-6.1-sol` | 등록된 기존 설정만 읽음 |
| 요청 | `C:/Users/USER/.orchiva/requests`의 JSON 54개, JSON 파싱 실패 0 | Git clone으로 왔다고 가정하지 않고 로컬 파일을 직접 확인. 영속 스키마 전체 검증이나 54건의 수용 통과가 아님 |
| 참조된 리소스 | 49개 요청에 Agent ID·Worktree 경로 있음, 49개 경로 존재 | 외부 Agent 생존·세션 복구 여부는 미검증 |
| Worktree 보관 폴더 | `.paseo-orchiva/worktrees` 아래 재귀 탐색으로 `.git` 파일 55개 | 폴더 존재 수. 요청 54개와 일대일 관계라고 해석하지 않음 |
| daemon | `paseo daemon status --home <로컬 home> --json`: `stopped`, PID 없음, `connectedDaemon: not_probed` | 시작·재시작·Plugin reload 없음. 설정 listen은 `127.0.0.1:6767` |
| 인증 자료 | `.codex/auth.json` 존재 여부만 확인 | 내용 출력 없음. 로그인 성공·사용량·모델 사용 권한은 확인하지 않음 |

현재 데이터가 존재해도 [M6의 과거 53건 보존 결과](m6-acceptance.md)를 이번 54건에 소급하지 않는다. 요청 원본, PLAN, Paseo 이력과 Worktree는 Git 저장 범위 밖이며 이번 작업에서 수정·삭제·이관하지 않았다. RNG 등 운영 프로젝트에서 시험하지 않았다.

## 실행한 검증과 미실행 항목

변경 기준점은 위 `b08dc13`이며 날짜는 모두 2026-11-16이다.

| 명령·절차 | 종류 | 기대 | 실제 결과·증거 |
| --- | --- | --- | --- |
| `npm ci --no-audit --no-fund` | 환경 설치 | lockfile 그대로 의존성 복원 | exit 0, 323 packages. manifest·lockfile Git diff 없음 |
| `npm run typecheck` | 정적 | TypeScript 오류 없음 | exit 0 |
| `npm test` | 자동: 모의 Runtime·임시 Git/파일·소유 child 프로세스 | 기존 회귀 통과 | 89/89 pass, fail/cancelled/skipped 0, 약 11.54초 |
| `git diff --exit-code -- package-lock.json` | 정적 | 설치로 lockfile 변경 없음 | exit 0 |
| `dotnet --info`, `dotnet new list wpf`, `vswhere` | 환경 조회 | 개발 도구 상태 식별 | 위 표. 솔루션·프로젝트 생성 없음 |
| daemon status·로컬 파일 메타데이터 조회 | 읽기 전용 환경 점검 | 실제 데이터 유무 확인 | 위 표. 실행 세션을 만들거나 연결 복구하지 않음 |
| `npm run verify`, `npm run verify:lifecycle` | 실제 연동 미실행 | 기존 고정 요청·세션·Worktree·daemon 필요 | 로컬 자료 일부 존재 확인. daemon 중지, 세션·고정 시험별 원본 적합성 미검증. 설계 작업에서 시작하거나 재호출하지 않음 |
| M0~M6의 보존 실행 verify·실연동/장애/GUI | 미실행 | 각 manifest·원본·시험 소유권·서비스 준비 필요 | 이번 요청은 환경 점검·설계까지. 특히 M4 verify는 파일 임시 편집을 포함하므로 정적 검사로 취급하지 않음 |
| `dotnet build/test/publish` | 미실행 | .NET 프로젝트 필요 | 저장소에 `.sln`·`.slnx`·`.csproj`가 없고 앱 구현을 시작하지 않음 |

설치 후 lockfile SHA-256은 `B668073A8EC24FEEECDC5BD2F65AFF7E8A1FAD21B64773A4885A4DE161E2FE42`다. npm은 기존 전이 의존성의 deprecation과 esbuild install-script 승인 대기 경고를 출력했으나 설치·타입 검사·89개 테스트는 성공했다. 의존성 업그레이드나 별도 script 승인으로 lockfile·정책을 바꾸지 않았다. 이 명령에서 audit는 수행하지 않았다.

테스트 전체 출력은 이 PC 임시 파일 `C:/Users/USER/AppData/Local/Temp/orchiva-prep-20261116-tests.log`에 있다. 재현 근거는 이 표에 요약했으며 이 로그는 영속 실행 데이터나 Git 첨부 증거가 아니다. 문서 정적 검증 결과와 최종 변경 범위는 [계획의 기록](../plans/desktop-transition.md#실행-및-검증-기록)에 둔다.

## 준비 판단

기존 Node 구현의 설치·타입·자동 회귀는 준비됐다. 실제 Paseo 연동·새 PC 인증·.NET 빌드·exe 배포의 준비 완료를 의미하지 않는다. 다음 착수는 [전환 계획 D1](../plans/desktop-transition.md#첫-구현-단계-d1)의 격리된 조회 연결 검증이다.

초기 질문에서는 UI와 소스 반영을 보류했다. 이후 2026-11-16 사용자가 WinUI 3 + .NET 10, 첫 구현부터 디자인, B안 선택 적용, 프로젝트별 docs/에서 지침·PLAN·결정/작업 이력 관리를 확정했다. 환경 점검 수치는 당시 관측 그대로이며 WinUI 도구 추가 준비가 필요하다. 선택 확정은 앱 구현 착수와 구분하므로 계획은 `proposed`를 유지한다.
