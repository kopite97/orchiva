# Orchiva Plugin PoC

Paseo 안에서 Feature Request를 입력하고 REQ → Request PLAN → TASK → Worktree → Task PLAN → Codex 실행 → 검증 → 완료 판정/실패 복구를 연결하는 Windows PoC입니다.

Orchiva의 기본 소스 폴더는 이 `orchiva-plugin` 폴더이며 소스 원격은 [kopite97/orchiva](https://github.com/kopite97/orchiva)입니다. 실제 연동 작업 대상은 별도 `orchiva-PoC` sandbox입니다.

## 개발 지침과 계획

작업은 [AGENTS.md](AGENTS.md)에서 시작하세요. [작업 흐름](docs/agents/workflow.md), [프로젝트 규칙](docs/agents/repository-guidelines.md), [소스 규칙](docs/agents/source-conventions.md), [검증 기준](docs/agents/validation.md)을 경로와 변경 범위에 맞게 적용합니다.

MVP의 단계별 상태는 [계획 목록](docs/plans/README.md)에서 관리합니다. M0 실행 기반, M1 저장·상태, M2 초안·계획 확인·고정 커밋 실행, M3 진행 화면·백그라운드 관측·복원을 구현했습니다. [M0 결과](docs/decisions/m0-runtime-foundation.md), [M1 결과](docs/decisions/m1-storage-state.md), [M2 결과](docs/decisions/m2-draft-plan-start.md), [M3 결과](docs/decisions/m3-progress-reconciliation.md)에 검증과 제약을 기록했습니다.

## 실행

```powershell
Set-Location C:\Users\USER\lib\orchiva-plugin
.\scripts\start-paseo.ps1
```

브라우저에서 <http://127.0.0.1:6767>을 열고 **Orchiva → 새 요청**을 선택합니다. 제목·목표·범위·제약·검증 방법을 입력하고 완료 조건을 추가합니다. 조건마다 자동 검사(Node 테스트 또는 파일 내 문자열)나 수동 확인 방법을 연결합니다. **초안 저장**은 일부 항목만 입력해도 가능하며 작업 목록에서 이어서 작성할 수 있습니다.

**계획 확인**에서 두 PLAN, 조건·검사, 대상 저장소와 기준 커밋을 검토한 뒤 **이 계획으로 실행**을 누릅니다. 실행 전에는 세션이나 Worktree를 만들지 않습니다. 입력을 수정하면 새 계획 확인이 필요하며 기준 커밋·설정이 바뀐 경우에도 재생성을 요구합니다. 실행은 확인한 SHA에 고정됩니다.

작업 목록에서 필터와 진행 중 고정 항목을 사용하고, 상세의 **진행·결과·이력** 탭에서 실행 상태, 관측 시각, 최종 응답, 변경 파일, 검사 로그와 시도 이력을 확인합니다. 테스트가 통과하면 **완료 조건 검토 대기**가 됩니다. 결과 탭에서 완료 조건과 근거를 확인하고 체크박스·판정 근거를 입력한 뒤 **완료 확정**을 누릅니다. 실패한 작업은 원인을 확인하고 **기존 Worktree에서 재개**할 수 있습니다. 세션·Worktree는 유지되고 이전 실패 증거는 보존됩니다.

**상태 확인**은 실행 상태를 대조하며 같은 결과의 검사를 다시 실행하지 않습니다. **검증 다시 실행**은 같은 시도의 새 검증 결과를 만듭니다. 완료 확정은 검증 당시 결과에 대한 기록입니다. 자동 검증이 없으면 수동 확인이 필요하며, Codex의 종료 또는 성공 보고만으로 자동 완료하지 않습니다.

목록·상세 조회는 결과를 재수집하지 않습니다. Plugin이 소유한 단일 관측 루프와 Hook이 진행 상태를 갱신합니다. 화면을 닫아도 daemon이 살아 있으면 검증까지 진행합니다. 연결이 끊기면 마지막 확정 상태를 유지하고 재연결하며, daemon 재시작 후 기존 ID·슬롯을 대조합니다. 검토 대기·확정 실패·완료 결과는 주기적으로 재검증하지 않습니다. 이력 탭은 시도·검증 회차·판정을 보여주며 과거 결과 상세 선택과 조건별 판정은 후속 단계입니다.

복구 메시지 전달 여부가 불확실하면 `needs-input`에 보존하고 자동 재전송과 다른 키의 재개를 차단합니다. daemon이 복원한 이력에서 전달 식별자가 없어질 수 있으므로 메시지 내용만 보고 재전송하지 않습니다.

daemon을 Codex 앱에서 잘못된 환경으로 시작했다면 `scripts\start-paseo.ps1 -Restart`로 supervisor까지 다시 시작하세요. 이 스크립트는 두 데스크톱 패키지 실행 선택 변수만 자식 프로세스 환경에서 제외하며, Windows sandbox와 승인 정책은 변경하지 않습니다.

## 개발 및 검증

```powershell
npm ci
npm run typecheck
npm test
paseo plugin reload orchiva-plugin --home C:\Users\USER\.paseo-orchiva
npm run verify
npm run verify:lifecycle
```

`verify`는 이 PC에 남겨둔 RPC·GUI 검증 요청 2개의 계획, Git 원본과 브랜치, Codex 상태, 증거 파일 및 중복 실행 방지를 검사합니다. 새 세션을 만들지 않습니다. 과거 `smoke`·`lifecycle start`의 직접 시작 입력은 기존 실행 참조에만 호환됩니다. 새 요청은 초안·계획 확인이 필요하며 `npm run m2 -- help` 또는 새 화면을 사용합니다. 검증 이력을 지운 새 PC에는 기존 `verify`의 보존 데이터가 없습니다.

`verify:lifecycle`은 실제 성공·실패 복구 사례의 완료 판정, 실패 로그, 테스트 불변성, 재시작 후 중복 요청 방지를 검사하고 원래 테스트를 다시 실행합니다. `npm run lifecycle -- status`로 두 사례를 조회할 수 있습니다. 실연동 생성·복구·판정용 명령은 `start`, `recover`, `approve`이며 고정 PoC 키를 사용합니다. 기존 완료 이력을 삭제하지 말고 새 검증이 필요하면 별도 키와 사례를 정의하세요.

`npm run m0 -- help`는 M0 시험 명령을 안내합니다. 시험 observer는 로컬 설정이 있을 때만 활성화되며 운영 스케줄러가 아닙니다. 실제 장애 시험의 단계와 보존 데이터는 [M0 재검증 안내](docs/decisions/m0-runtime-foundation.md#재검증과-정상-상태)를 따릅니다.

`npm run m1 -- help`는 기존 요청 백업·마이그레이션 대조 절차를 안내합니다. v1 원본은 `requests/backups/v1`에 보존됩니다. 같은 데이터 디렉터리의 두 번째 writer는 거부하며, 준비·실행·검증·전달 미확정 작업이 있으면 다른 작업의 실행을 `BUSY`로 차단합니다. `storage.diagnostics` RPC로 손상 파일·미래 버전·이력 수·점유 요청을 확인할 수 있습니다.

`npm run m2 -- verify m2-20261112-workflow-001`은 이 PC의 M2 실행에 대해 확인 SHA·PLAN 원문·독립 검사·중복 방지·기존 4건 바이트 보존을 대조합니다. 새 시험의 단계와 실제/모의 검증 구분은 [M2 결과](docs/decisions/m2-draft-plan-start.md)를 참고하세요.

`npm run m3 -- verify m3-20261112-reconcile-001`은 보존된 M3 실행과 재시작 근거, 동일 ID·결과1건·기존6건 원본을 대조합니다. 실제 시험은 `npm run m3 -- help`와 [M3 결과](docs/decisions/m3-progress-reconciliation.md)를 따릅니다. M3 시작 RPC는 `planned` 접수 후 반환하므로 세션·결과는 이후 조회합니다. 초기 생성 결과가 불확실하면 새로 만들지 않고 확인 필요 상태를 유지합니다.

## 구성

| 위치 | 용도 |
| --- | --- |
| `client/screens/` | React Native Feature Request 화면 |
| `shared/contracts/` | Zod 입력 검증과 RPC 계약 |
| `server/domain/` | REQ·TASK 식별자 및 두 PLAN 생성 |
| `server/application/` | 실행 순서, 상태 전이, 판정·복구, 요청별 잠금 |
| `server/adapters/paseo/` | Worktree와 Codex SDK 연결 |
| `server/adapters/storage/` | 원자적 JSON 저장, 파일 지문·독립 검증 수집 |
| `%USERPROFILE%\.orchiva\project.json` | 대상 경로·기준 브랜치·모델 설정 |
| `%USERPROFILE%\.orchiva\requests\` | 실행 상태와 계획 원본 |
| `%USERPROFILE%\.paseo-orchiva\` | 독립 daemon, 로그, Worktree |

대상은 `C:\Users\USER\lib\orchiva-PoC`와 `kopite97/PoC-sandbox` origin으로 제한됩니다. RNG는 사용하지 않습니다. Plugin 소스와 대상 저장소는 분리되어 있습니다. 원격 push와 merge는 하지 않습니다.

주요 상태는 `draft → ready → 준비 → running → validating → awaiting-review → completed`이며 오류·검증 실패는 `failed`, 권한·전달 확인 대기는 `needs-input`으로 표시합니다. 초안과 계획 확인 대기는 실행 슬롯을 차지하지 않습니다. 실패 복구는 같은 TASK의 시도 번호를 올립니다. 화면은2초, 서버 관측은 정상 시5초 간격이며 연결·관측 실패는5/10/20/30초 backoff를 적용합니다. 초기 접수·안전한 PLAN 기록은 재시작 후 이어가고 불확실한 생성·전송은 자동 재시도하지 않습니다.

단일 로컬 daemon·단일 TASK 흐름까지 검증했습니다. 자동 검증은 Node 내장 테스트 및 문자열 검사만 지원합니다. Node 검증은 Worktree 읽기만 허용하고 쓰기·자식 프로세스를 차단하며, 테스트당 10초·전체 20초로 제한합니다. 이는 임의 코드를 위한 완전한 보안 격리나 네트워크 차단을 보장하지 않습니다. 증거 파일은 파일당 2 MiB·최대 300개입니다. 다중 daemon, 장시간 부하, 일반 빌드 명령, Unity 빌드, 자동 merge는 후속 범위입니다.

환경과 검증 근거는 [검증 기록](docs/verification.md)을 참고하세요.

MVP 설계 전 검토할 구현 범위, 실제 성공·실패·복구 결과, 한계와 후속 결정 사항은 [PoC 결과 보고서](docs/poc-results.md)에 정리했습니다.

단일 작업 흐름의 기능 범위, 화면 흐름, 데이터 모델, 개발 순서와 수용 기준은 [프로토타입 MVP 설계](docs/mvp-design.md)를 참고하세요. 설계의 전체 MVP 목표와 M0~M3 현재 구현을 구분합니다.
