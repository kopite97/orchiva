# Orchiva D6 사전 검증 배포본

2026-11-17. Windows 11 x64의 로컬 검증용 폴더 배포다. 당시 PC에서 실제 제작·상담, 종료/재접속과 오프라인 교체·중단 복구를 검증했다. 공개 릴리스는 아니다. 2026-11-26 [검증 PLAN](../plans/desktop-fresh-pc-validation.md)에 원격·로컬 결과를 합쳤다. 초기 환경에 개발 도구·인증이 있어 깨끗한 설치 N01~N03은 보류했으며, 사용자 결정으로 개인 사용을 위한 현재 PC 시험을 마쳤다. 실제 PLAN·제작·상담, 활성 창 종료 중 실행 유지, idle 실행부 재시작 복원, 로컬 통신 단절/재연결과 정리가 통과했다. PC 재부팅·VM 및 GUI 일부 잔여는 후속이다. [결과와 한계](../decisions/desktop-fresh-pc-validation.md).

새 PC 시험 전에는 초기 상태를 먼저 기록한다. 소스 확보를 위해 Git부터 설치하지 않고 필요하면 소스 ZIP을 사용한다. 별도 빌드 PC의 전체 배포 폴더만 전달하며 시험 PC에 SDK·Node를 설치해 빌드하지 않는다. 전달본 `0.1.0-d6b-preview`의 고정 지문·사용자 제공 소스와 lifecycle 승인 누락 경고는 새 PC PLAN에 기록했다. build/manifest 통과와 모든 실제 실행 경로의 성공은 별도 판정이다.

## 실행

전체 폴더를 보존하고 `Orchiva.Desktop.exe`를 실행한다. .NET 및 Windows App SDK 런타임과 Node/Paseo/Plugin을 포함한다. 개별 exe만 복사하면 실행할 수 없다. 개발용 환경 변수는 필요 없다. `ORCHIVA_DESKTOP_CONFIG`가 있으면 개발 설정이 우선하므로 일반 실행에서는 해제한다.

첫 실행은 `%LOCALAPPDATA%/Orchiva.Desktop/runtime-v1`에 별도 data/Paseo home과 loopback 포트를 만든다. 기존 `.orchiva`·`.paseo-orchiva`·프로젝트·인증 파일을 가져오지 않는다. 앱을 닫아도 실행부와 작업은 계속되며 다시 열면 같은 기록을 조회한다. 작업실에서 프로젝트를 등록한다.

Git과 Codex는 별도로 설치하고 Codex의 정상 로그인 절차를 사용해야 한다. 설정 화면의 **Git·Codex 설치와 인증 확인**은 CLI 실행과 로그인 상태를 읽기만 한다. 미설치·로그인 필요·확인 실패를 구분하며 인증 원문을 표시하지 않는다. 모델 접근 가능 여부는 실제 요청에서 확인한다. 로그인 자동화·키 입력/복사·사용자 정책 변경은 하지 않는다. 새 PC 실측의 현재 실행 근거와 환경 차단 판정은 위 PLAN을 따른다.

## 보존과 복구

실행 중인 설치 폴더를 이동·덮어쓰기하지 않는다. profile은 설치 위치에 고정되며 다른 폴더의 앱은 기존 profile을 자동 변경하지 않는다. 버전 교체는 아래의 명시적 오프라인 관리 절차를 사용한다. 이전 앱으로 데이터 형식을 되돌리지 않는다.

## 오프라인 버전 교체

새 배포본을 별도 폴더에 압축 해제하고 파일을 검증한다. 진행 중/미확정 작업을 기존 앱에서 정리하고 모든 Orchiva 창을 닫는다. 작업이 idle인지 확인한 뒤 해당 profile의 public Paseo `daemon stop --home <profile>/paseo`로 실행부를 종료한다. 일반 창 닫기만으로 daemon이 종료되지는 않는다. 다른 home의 daemon을 종료하지 않는다.

새 배포본의 `runtime/plugin` 폴더에서 동봉 `../node.exe --import tsx scripts/desktop-maintenance.mjs`를 사용한다. 개발 저장소에서는 `node --import tsx scripts/desktop-maintenance.mjs`도 가능하다.

```text
inspect <profile-root> <new-package-root>
switch <profile-root> <new-package-root> <inspect의 profileHash> <inspect의 packageHash>
recover <profile-root> <new-package-root> <원래 profileHash> <원래 packageHash>
```

`inspect`로 대상 파일과 hash를 확인한 후 `switch`한다. 앱 소유권·실행 포트·기존 저장 writer·활성/손상/미지원 기록이 있으면 거부한다. 지원 데이터 형식이 같은 패키지만 허용하며 요청·대화·결과·프로젝트 파일은 변환하지 않는다. profile과 Paseo의 Plugin 경로만 바꾼다. 원래 설정은 profile의 `updates/` journal에 보존한다. journal은 개인 경로·설정을 포함하므로 외부에 그대로 공유하지 않는다.

중단 시 `update-pending.json`을 보존하고 같은 패키지/hash로 `recover`하여 앞으로 완료한다. 외부에서 바뀐 설정은 덮어쓰지 않는다. 중단 journal이 있으면 앱 시작도 차단한다. 자동 다운로드·자동 rollback·삭제·인증 이동은 없다. 전환 후 새 폴더의 exe로 시작한다. 이전 설치 폴더와 기록은 유지한다.

실행 실패 시 설치 폴더와 사용자 데이터 모두 보존한다. 불완전/미래 버전 설정은 자동 초기화하지 않는다. 빈 새 profile 생성 중 중단된 `.orchiva-initializing-*`는 미게시 staging이며 기존 profile과 구분한다. 기존 데이터나 실행 잠금을 삭제하여 시작 오류를 우회하지 않는다.

## 실행부 연결 복구

관측 실패는 작업 실패나 재전송 허가가 아니다. 먼저 같은 창의 연결 상태에서 재연결한다. daemon은 살아 있으나 Plugin 프로세스가 종료된 경우 현재 구성은 자동 재기동하지 않는다. 소유 profile을 확인하고 동봉 Node와 Paseo CLI로 `plugin reload orchiva-plugin --home <profile-root>/paseo`를 명시적으로 실행한 뒤 앱에서 다시 연결한다. 이미 보낸 요청을 새 요청으로 만들지 않는다. D6b에서는 첫 상담 응답 후 이 절차로 복원하고 동일 Agent의 두 번째 응답과 과거 제작 결과를 확인했다.

검증본은 서명되지 않았다. Windows 보안 설정 변경을 요구하지 않는다. 정식 배포 전 코드 서명과 Node/Paseo 및 전이 의존성의 라이선스·고지·재배포 조건을 정리해야 한다. 포함된 package/lock/license 파일과 해시 목록은 법적 검토나 서명을 대체하지 않는다.

## 개발자 재현

저장소 루트에서 고정 .NET SDK와 npm을 준비한다. 저장소 root lockfile과 `desktop/deployment/paseo/package-lock.json`으로 새 폴더에 `npm ci`한다. 설치 단계는 네트워크가 필요하며 lifecycle script 실행 여부는 npm의 현재 승인 설정을 따른다. 경고와 실제 실행 결과를 함께 확인한다. 배포 준비는 개발자의 인증·로컬 데이터·node_modules를 복사하지 않는다.

```powershell
node scripts/package-desktop.mjs build .desktop-local/d6-package-new --dotnet .desktop-local/tools/dotnet/dotnet.exe
node scripts/package-desktop.mjs verify .desktop-local/d6-package-new
node --test scripts/package-desktop.test.mjs
```

출력 폴더는 새 경로만 허용한다. 실패한 빌드 폴더를 덮어쓰지 않는다. `orchiva-package.json`은 버전과 모든 동봉 파일의 크기/SHA-256을 기록한다. 검사는 누락·변경·추가 파일·중복 경로·경로 이탈·링크·대표 인증 파일명을 거부한다. 서명 없는 manifest이므로 악의적인 위변조의 신뢰 근거는 아니다. 실행 시 전체 파일 해시를 재검사하는 기능도 아직 없다.
