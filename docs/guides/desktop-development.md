# 데스크톱 D1~D3 개발 실행

2026-11-16 기준. **프로젝트·기획/코딩 제작을 제공하는 개발 빌드이며 사용자용 배포본이 아니다.** [D2·D3 최신 구현/검증](../decisions/desktop-d2-d3-completion.md)을 먼저 확인한다. 아래 D1 검증 기록은 이력이다. D1 구현·비GUI 검증은 완료했으며 Node 97/97·C# 12/12 통과다. [실행부 보완과 GUI 대기](../decisions/desktop-d1-runtime-completion.md)를 따른다. [이전 실제 화면 검증](../decisions/desktop-d1-gui-verification.md)도 보존한다. [결과·제약](../decisions/desktop-d1-foundation.md)과 [전환 PLAN](../plans/desktop-transition.md)을 먼저 확인한다.

## 준비와 빌드

현재 소스 루트에서 PowerShell로 실행한다. 저장소 위치를 바꾸면 그 실제 경로를 사용한다. Node/npm/Paseo 설치, .NET SDK `10.0.401`, Windows x64가 필요하다. 명령줄 하네스의 `start`에는 .NET 10 기반 PowerShell 7.6 이상(`pwsh.exe`)이 필요하다. 앱의 시작 버튼은 PowerShell 없이 같은 C# launcher를 직접 사용한다. NuGet 패키지와 lockfile은 저장소에 고정돼 있다. 기존 lockfile을 재생성할 필요는 없다.

```powershell
npm ci
npm run typecheck
npm test
npm run desktop:build
dotnet build desktop/Orchiva.Bridge.Tests/Orchiva.Bridge.Tests.csproj -p:RestoreLockedMode=true
```

개발 exe는 `desktop/Orchiva.Desktop/bin/x64/Debug/net10.0-windows10.0.26100.0/win-x64/Orchiva.Desktop.exe`에 생성된다. Windows App SDK 관련 파일을 포함한 폴더 출력이며 exe 하나만 복사하는 배포 방식이 아니다. VS workload를 전역 설치하거나 보안 정책을 변경하는 스크립트는 포함하지 않는다.

## 격리된 실제 조회

기본 하네스는 소스의 형제 디렉터리 `../orchiva-PoC`를 sandbox로 사용한다. 기존 허용 remote 검사는 유지된다. 운영 프로젝트나 RNG 경로를 넣지 않는다. `prepare`는 새 ID만 허용한다. 하네스가 만든 config와 manifest는 `.desktop-local/<ID>/`에 보관되며 Git에서 제외한다.

```powershell
$runId = 'd1-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
npm run desktop:verify -- prepare $runId
npm run desktop:verify -- start $runId
npm run desktop:verify -- verify $runId
npm run desktop:verify -- stdio $runId
```

`start`는 빌드된 C# launcher를 `scripts/start-desktop-runtime.ps1`에서 호출하므로 먼저 `desktop:build`를 수행한다. `prepare $runId --empty`는 빈 저장소 fixture를 만든다. 기존 3건 fixture를 전제로 하는 C# live 테스트에는 기본 prepare를 사용한다.

각 명령의 성공을 확인한 후 다음 명령으로 진행한다. 실패한 실행 ID를 삭제하거나 재사용하지 않는다. 포트가 다른 프로세스에 점유됐으면 그 프로세스를 종료하지 말고 실패를 기록한 뒤 새 ID로 준비한다.

준비 파일은 `nodePath`, `sourceRoot`, `paseoCliPath`, `isolationRoot`, `dataHome`, `paseoHome`, `endpoint`를 담는다. Node/Paseo 실행 파일은 이 PC에서 확인한 경로다. Paseo가 npm 전역 기본 위치 외에 설치돼 있으면 실제 CLI 경로를 지정한다. data와 paseo home은 서로 다르고 격리 루트 아래에 존재해야 한다. 인증 파일은 daemon이 해당 home에서 생성하며 로그·문서로 복사하지 않는다.

실행을 허용하는 개발 환경에서만 다음 앱·.NET 검증을 진행한다. 환경 변수는 현재 PowerShell 세션에만 적용된다.

```powershell
$env:ORCHIVA_DESKTOP_CONFIG = (Resolve-Path ".desktop-local/$runId/desktop.json").Path
npm run desktop:test
Start-Process -FilePath '.\desktop\Orchiva.Desktop\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64\Orchiva.Desktop.exe'
```

앱은 이 설정이 없으면 production 데이터에 자동 접속하지 않는다. 프로젝트·이력을 읽은 뒤 연결 상태와 설정을 확인한다. 필요하면 연결 화면의 **격리 실행부 시작**으로 설정된 home만 시작할 수 있다. 닫기 기본값은 앱 종료이며 트레이 최소화로 바꿀 수 있다. UI 설정은 격리 루트의 `desktop-settings.json`에 저장한다. 환경 설정이 없을 때 일반 UI 설정은 `%LOCALAPPDATA%/Orchiva.Desktop/settings.json`에 저장한다. 요청/PLAN/결과 데이터의 저장 원본과 별개다.

앱 종료는 소유 bridge를 정리하지만 daemon을 종료하지 않는다. D3 작업실의 모델 실행은 UI 종료 후에도 실행부에서 계속된다. 명시적 중단 버튼은 실제 종료를 관측할 때까지 대기 상태를 유지한다. 다른 환경에서 앱 제어 차단이 발생하면 원인을 확인하며 보안 정책을 자동 변경하거나 우회하지 않는다. 시작 경로는 숨김 Node 호스트 → 공개 `daemon run`으로 수정했다. 호스트/CLI는 daemon 정지까지 유지되며 앱 종료로 함께 종료되지 않는다. 기존 `daemon start` 명령을 수동 사용하면 이 수정 경로를 거치지 않는다. 실제 콘솔 부재의 화면 확인은 사용자 지시로 대기한다.

## 재시작·정리

```powershell
npm run desktop:verify -- stop $runId
npm run desktop:verify -- start $runId
npm run desktop:verify -- verify $runId
# 앱을 닫은 뒤 시험 소유 daemon 정리
npm run desktop:verify -- stop $runId
npm run desktop:verify -- offline $runId
Remove-Item Env:ORCHIVA_DESKTOP_CONFIG -ErrorAction SilentlyContinue
```

`stop`은 해당 manifest의 home만 종료하고 fixture 및 기존 요청 해시를 대조한다. `offline`은 정지된 daemon에 대한 실패 응답을 확인한다. fixture·실행 로그·manifest는 보존한다. 기존 `%USERPROFILE%/.orchiva`와 `.paseo-orchiva` 데이터는 이 도구의 쓰기 대상이 아니다. 이전 PC의 verify 계열은 필요한 세션·Worktree 데이터가 확인됐을 때만 별도로 실행한다.

## 프로젝트 작업실과 제작 검증

연결 후 **작업실**에서 프로젝트 목록을 읽고 소스 경로를 등록한다. 초기화 미리보기와 생성·이관할 실제 내용을 확인해 초기화한다. 결과물 폴더는 소스 밖에 미리 만든 폴더를 지정한다. 기획/코딩은 사용할 수 있으며 질문/상담과 미디어 분야는 후속 단계로 표시한다. 요청을 저장하고 AI PLAN을 작성한 뒤 확인란과 실행 버튼으로 진행한다. 자동 검사 통과 후 결과 품질을 확인해 완료 승인하고, 내보낸 파일의 차이를 확인해 선택 반영한다. 반영 이력에서 부분 작업을 이어 처리하거나 되돌릴 수 있다.

프로젝트 원본은 실제 파일이며 `docs/.orchiva`에 설정·요청·snapshot·백업·journal을 둔다. `docs/plans`, `docs/decisions`, `docs/evidence`는 사람이 읽는 문서·근거다. 다른 도구로 지침/PLAN을 편집했다면 다시 읽어 확인한다. 새 지침을 등록한 뒤에는 루트 AGENTS의 지도 링크도 연결한다. 파일명 입력이나 임의 Node 검사 코드 작성은 요구하지 않는다.

공통 지침 확인:

```powershell
npm run project:instructions -- "C:\Projects\MyProject"
```

다음 실제 모델 검증은 새 격리 실행 ID와 PoC sandbox의 별도 clone에서만 수행한다. 비용이 발생하는 AI PLAN·제작·재개 호출을 포함한다. 초기화/PLAN 중에는 제작용 Workspace·Agent를 생성하지 않는다. `d1-` 접두사는 하네스 호환 이름이며 D1 시험만 의미하지 않는다. 각 status에서 기대 상태를 확인한 후 다음 명령을 실행한다.

```powershell
$runId = "d1-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-production"
npm run desktop:verify -- prepare $runId --empty
npm run desktop:verify -- start $runId
npm run desktop:production -- setup $runId
npm run desktop:production -- plan $runId
npm run desktop:production -- status $runId # ready가 될 때까지 확인
npm run desktop:production -- start $runId
npm run desktop:production -- status $runId # awaiting-review, 검사 통과 확인
npm run desktop:production -- revalidate-failure $runId
npm run desktop:production -- resume $runId
npm run desktop:production -- status $runId # 같은 세션 복구·검사 통과 확인
npm run desktop:production -- review $runId
npm run desktop:production -- apply $runId
npm run desktop:production -- undo $runId
npm run desktop:production -- verify $runId
npm run desktop:verify -- stop $runId
```

`revalidate-failure`는 이 실행 ID의 Worktree 결과만 41로 바꿔 원래 검사 실패를 확인한다. `resume`은 같은 세션에서 42로 복구한다. 원래 sandbox/운영 프로젝트/기존 요청을 편집하지 않는다. 실패한 ID·fixture·증거는 삭제하지 않는다. 이전 전체 verify 계열은 관련 과거 데이터가 있을 때만 별도 실행한다.
