# Orchiva 사용자 안내

Orchiva MVP는 별도 exe가 아니다. Paseo가 제공하는 로컬 웹 UI에 Plugin 화면을 추가해, 초안·검토·실행·결과 확인을 하나의 작업으로 연결한다. Agent는 Paseo daemon이 관리하고, 작업 파일은 등록된 PoC sandbox의 전용 Worktree에서만 바뀐다.

## 설치와 첫 실행

이 안내는 Windows 환경의 기존 Orchiva 설치를 기준으로 한다. 검증 PC에서는 Node.js `24.19.0`, Paseo `0.15.4`, Plugin SDK `0.15.4`를 사용했다. `package-lock.json`을 유지한다. 같은 PC의 빈 데이터·격리 설정에서 초안 저장·재열기·계획 확인을 재현했고, 사용자가 기존 설치에서 초안 복원과 완료 결과·검사 로그 찾기를 확인했다. 새 PC의 설치·인증 재현은 아직 검증하지 않았다.

저장소 역할은 서로 다르다.

| 위치 | 역할 | 허용 원격 |
| --- | --- | --- |
| `C:\Users\USER\lib\orchiva-plugin` | Plugin 소스 | `kopite97/orchiva` |
| `C:\Users\USER\lib\orchiva-PoC` | Agent 실행 sandbox | `kopite97/PoC-sandbox` |

Plugin이 가리키는 `.orchiva/project.json`은 `PoC Sandbox`, 위 sandbox 경로, `main`, 사용할 `codex/<모델>` provider를 지정해야 한다. Plugin은 경로와 원격을 확인하며 운영 저장소나 RNG에서 실행하지 않는다. 기존 사용자 설정에 인증값을 넣거나 Git 원격을 바꾸지 않는다.

PowerShell에서 Plugin 의존성을 확인한다.

```powershell
Set-Location C:\Users\USER\lib\orchiva-plugin
npm ci
npm run typecheck
npm test
paseo --version
```

Paseo가 이미 실행 중인지 확인한다.

```powershell
paseo daemon status --home C:\Users\USER\.paseo-orchiva --json
paseo plugin ls orchiva-plugin --home C:\Users\USER\.paseo-orchiva --json
```

daemon이 중지된 경우에만 Plugin 루트의 `scripts\start-paseo.ps1`을 실행한다. 독립 daemon은 localhost에 바인딩하고 relay는 꺼 둔다. 스크립트는 이 daemon 자식 프로세스에서 데스크톱 패키지 선택 환경 변수 두 개만 제외한다. Windows sandbox·승인 정책·Codex 설정은 바꾸지 않는다.

Plugin을 처음 등록할 때 다음 명령을 쓴다. 이미 설치되어 있으면 `install` 대신 `reload`를 사용한다.

```powershell
paseo plugin install C:\Users\USER\lib\orchiva-plugin --home C:\Users\USER\.paseo-orchiva
paseo plugin reload orchiva-plugin --home C:\Users\USER\.paseo-orchiva
paseo plugin ls orchiva-plugin --home C:\Users\USER\.paseo-orchiva --json
```

브라우저에서 `http://127.0.0.1:6767/`을 열고 왼쪽의 **Orchiva**를 선택한다. 상단의 **ORCHIVA · PoC Sandbox**와 **작업 목록**을 확인한 뒤 **새 요청**을 누른다. 이는 현재 daemon이 제공하는 웹 화면이다. Codex/Agent 인증은 Paseo의 정상 사용자 로그인 흐름을 사용한다. 인증 파일을 복사하거나 문서·요청에 붙여 넣지 않는다. Paseo 웹 UI와 인증 동작은 [Paseo 공식 설정 안내](https://paseo.sh/docs/configuration#bundled-web-ui)를 참고한다.

## 단일 작업 흐름

1. **새 요청**을 누르고 이름, 목표, 범위, 제약, 검증 방법을 작성한다. 처음에는 **초안 저장**만 해도 된다. 목록으로 돌아갔다 다시 열어 저장된 값을 확인할 수 있다.
2. 완료 조건을 각각 추가한다. 조건마다 자동 검사 ID를 연결하거나 수동 확인 방법을 적는다. 자동 검사가 없다면 최종 판정에서 각 조건에 구체적인 수동 근거를 남긴다.
3. 필요한 검사를 추가한다. `file-contains`는 Worktree 상대 경로의 문자열을 확인하고, `node-test`는 Node 내장 테스트를 실행한다. 임의 shell 명령이나 일반 빌드 실행은 지원하지 않는다.
4. **계획 확인**을 누르고 대상 sandbox·기준 브랜치·확인된 HEAD SHA·PLAN·검사 목록을 살핀다. 초안, 조건, 검사, 프로젝트 설정 또는 기준 HEAD가 바뀌면 이전 계획은 실행할 수 없다. 변경된 입력으로 계획을 다시 확인한다.
5. 검토한 계획에서 **실행 시작**을 누른다. 작업 하나만 동시에 시작할 수 있다. Agent가 실행 중인 동안 화면을 닫아도 로컬 daemon이 살아 있으면 관측이 계속된다.
6. **작업 상세**에서 진행, 변경 파일, 검사 결과와 로그, 최종 응답을 확인한다. 테스트가 통과해도 자동 완료되지는 않는다.
7. **결과 검토**에서 현재 결과에 속한 검사·파일을 근거로 조건별 충족 여부를 기록하고, 마지막 메모를 입력한 뒤 완료를 확정한다. 수동 확인에는 구체적인 설명이 필요하다. 과거 결과와 과거 판정은 이력에서 읽기 전용으로 확인한다.

저장한 초안은 **작업 목록 → 필터: 초안 → 해당 요청**에서 다시 연다. 완료된 요청은 **필터: 완료 → 해당 요청 → 결과**에서 검사 로그를, **이력**에서 저장된 완료 판정을 찾을 수 있다. 화면의 `자동 검사 1/1`은 검사 파일 수다. 파일 안의 테스트 두 개가 모두 통과했는지는 상세 로그의 `tests 2`, `pass 2`, `fail 0`으로 확인한다.

키보드로는 Tab으로 항목을 이동하고 Space 또는 Enter로 완료 조건·검사 근거 체크박스를 변경할 수 있다. 체크만 해서는 판정이 저장되지 않으며 최종 메모와 근거를 입력한 뒤 완료 버튼을 눌러야 한다.

## 실패와 재개

| 화면 상태 또는 실패 | 다음 행동 |
| --- | --- |
| 준비 단계의 확정된 실패 | 실패 원인을 확인한 뒤 **초기 실행 재시도**를 사용한다. 이미 만들어진 Worktree는 재사용한다. |
| 코드 실행/검사 실패 | 실패 결과와 검사 로그를 읽고, 필요하면 **같은 작업에서 재개**를 사용한다. 기존 TASK·Agent·Worktree를 유지하고 새 시도와 결과를 추가한다. |
| 검증기·증거 수집 오류 | 작업 환경·검사 경로·한도를 확인한다. 새 모델 실행 없이 가능한 **검증 다시 실행**을 사용한다. |
| 완료 조건 판정 거부 | 판정 사유를 읽고 실제 근거를 보완한다. 재개 입력은 **같은 작업에서 재개**를 누르기 전까지 전송되지 않는다. |
| 전달 결과 미확정 | 원래 명령과 ID에서 **전달 결과 대조**를 실행한다. 미확정 상태에서는 새 명령이나 새 요청으로 다시 전송하지 않는다. |
| Agent 또는 Worktree 없음 | 기존 요청에 같은 세션 재개를 보내지 않는다. 증거를 보존하고, 필요하면 기존 내용을 새 요청 초안으로 복사한 뒤 별도 계획을 확인한다. |
| 연결/관측 오류 | 화면의 마지막 저장 상태를 유지한다. daemon 연결을 복구하고 새로고침한다. 관측 오류를 실행 실패로 판정하지 않는다. |

`needs-input` 또는 `delivery-unknown` 상태가 남으면 슬롯이 비워지지 않을 수 있다. 원래 결과를 증명하지 못했을 때 자동 전송·강제 슬롯 해제를 시도하지 않는다. 미확정은 별도 판단이 필요한 상태다.

### Worker 중단 후 이어가기

daemon worker가 실행 중 종료되면 감독 daemon은 worker를 다시 시작한다. Orchiva는 마지막으로 저장된 명령·결과와 같은 Agent·Workspace를 대조한다. 중단된 실행에서 결과가 `failed`로 확정됐다면 작업 상세에서 실패 결과를 먼저 읽고, 필요할 때 **같은 작업에서 재개**를 선택한다. 재개는 기존 요청과 세션을 이어가고 이전 결과를 이력에 보존한다. 새 요청을 만들어 같은 내용을 다시 보내지 않는다.

Agent 목록에 `closed`가 보여도 그 값만으로 실패나 유실이라고 판단하지 않는다. 요청의 현재 상태·최종 결과를 확인하고 Agent의 활성 turn·대기 권한이 없는지 함께 살핀다. 결과가 없거나 요청이 `needs-input`이면 재개 대신 같은 요청의 **전달 결과 대조**를 사용한다. 대조가 끝날 때까지 다른 작업을 시작할 수 없을 수 있다.

## 데이터 보존과 복원

- 요청·PLAN·명령·검사·시도·결과·판정 이력은 `%USERPROFILE%\.orchiva\requests\` 아래 JSON에 저장된다.
- Agent가 만든 작업 파일은 `%USERPROFILE%\.paseo-orchiva\worktrees\` 아래 sandbox Worktree에 있다.
- Codex/Paseo 인증은 별도 로컬 인증 저장소에 있다. 백업·화면 캡처·문제 보고서에 인증 파일을 포함하지 않는다.

백업 전 활성 작업이 없는지 GUI와 `paseo agent ls --home C:\Users\USER\.paseo-orchiva`로 확인하고 daemon을 정상 종료한다. 저장소 전체는 원래 경로를 덮어쓰지 않는 별도 폴더에 복사한다.

```powershell
paseo daemon stop --home C:\Users\USER\.paseo-orchiva
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:USERPROFILE ".orchiva-backups\$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath (Join-Path $env:USERPROFILE '.orchiva\requests') -Destination $backup -Recurse
Copy-Item -LiteralPath (Join-Path $env:USERPROFILE '.orchiva\project.json') -Destination $backup
```

복원할 때는 현재 `requests`를 백업으로 바로 덮어쓰지 않는다. 원본과 별도 복사본을 준비하고 파일명·SHA-256·요청 ID·최신 결과를 비교한다. 미확정 명령이 있는 경우에는 JSON을 직접 편집해 상태를 확정하지 말고, 원래 ID로 앱의 대조 절차를 사용한다. 원본 복구가 필요한 경우에는 앱을 정상 중지한 뒤 비교가 끝난 사본과 기존 파일을 보존하고 변경 이력을 남긴다.

저장 중 Windows가 파일을 잠시 잠가 `EPERM` 또는 `EBUSY`가 발생하면 Plugin은 원자적 교체를 짧게 재시도한다. 반복 후에도 저장이 실패하면 기존 JSON과 `.tmp` 증거를 그대로 둔다. 이때 요청을 다시 만들거나 JSON·임시 파일을 직접 덮어쓰지 말고, daemon 상태와 Orchiva의 저장소 진단을 확인한 뒤 같은 요청의 최신 상태부터 읽는다.

## 정상 종료와 재시작

1. 작업 목록에서 `planned`, 준비 중, 실행 중, `needs-input` 요청을 확인한다.
2. 실행 중인 작업이 있으면 결과 또는 질문/권한 상태를 확인한다. 불확실한 전달을 새 명령으로 반복하지 않는다.
3. 종료가 필요하면 Paseo 앱에서 해당 작업을 먼저 중단하고 Agent 상태가 바뀌었는지 확인한다.
4. 사용자 의도에 맞춰 앱을 닫거나 `paseo daemon stop --home C:\Users\USER\.paseo-orchiva`로 daemon을 정상 종료한다.
5. 재시작한 뒤 같은 ID의 작업을 열고 상태·결과·시도가 복원되었는지 확인한다. 복원 대조 중에는 새 요청을 시작하지 않는다.

## MVP 제한

단일 로컬 daemon·단일 활성 TASK를 대상으로 한다. 독립 설치형 exe, 병렬 요청, 다중 사용자/프로젝트, 원격 daemon, 자동 Git push/merge는 포함하지 않는다. Node 검사는 제한된 파일 읽기·시간·출력 범위에서만 동작하며 모든 임의 코드를 격리하는 보안 경계가 아니다. 지원 검사, timeout, 증거 수집 한도, 알려진 제한은 [문제 해결 안내](troubleshooting.md)와 [검증 기록](verification.md)을 확인한다.

## 수용 시험 도구

M6 명령은 개발·수용 시험 전용이며 일상 사용 절차가 아니다. 기존 요청·설정의 백업을 만들고 새 실행 ID를 사용한다. `npm run m6 -- help`에서 명령을 확인한다. `preflight`는 대상 sandbox·daemon·provider·Plugin·기존 요청 보존을 검사하고, `measure`는 별도 합성 100건을 사용한다. `performance`와 `d06`은 실제 Agent/Workspace 또는 메시지를 만들고, `restart`, `a11`은 daemon 프로세스를 재시작한다. 승인된 격리 환경에서만 실행하며 완료된 run ID를 새 실행에 재사용하지 않는다. `verify-baseline`은 최초 요청 파일의 바이트 보존을 대조한다. 실제/모의 검증의 범위와 남은 제품 제약은 [M6 결과](decisions/m6-acceptance.md)를 확인한다.
