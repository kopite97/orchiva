# Orchiva Plugin PoC

Paseo 안에서 Feature Request를 입력하고 REQ → Request PLAN → TASK → Worktree → Task PLAN → Codex 실행 → 검증 → 완료 판정/실패 복구를 연결하는 Windows PoC입니다.

Orchiva의 기본 소스 폴더는 이 `orchiva-plugin` 폴더이며 소스 원격은 [kopite97/orchiva](https://github.com/kopite97/orchiva)입니다. 실제 연동 작업 대상은 별도 `orchiva-PoC` sandbox입니다.

## 개발 지침과 계획

작업은 [AGENTS.md](AGENTS.md)에서 시작하세요. [작업 흐름](docs/agents/workflow.md), [프로젝트 규칙](docs/agents/repository-guidelines.md), [소스 규칙](docs/agents/source-conventions.md), [검증 기준](docs/agents/validation.md)을 경로와 변경 범위에 맞게 적용합니다.

MVP의 단계별 상태는 [계획 목록](docs/plans/README.md)에서 관리합니다. 첫 계획인 [M0 실행 기반 확인](docs/plans/m0-runtime-foundation.md)은 `proposed`이며 계획 작성 단계입니다. 아래 실행 안내는 현재 PoC 구현 기준입니다.

## 실행

```powershell
Set-Location C:\Users\USER\lib\orchiva-plugin
.\scripts\start-paseo.ps1
```

브라우저에서 <http://127.0.0.1:6767>을 열고 **Orchiva**를 선택합니다. 여섯 항목과 선택적 자동 검증(Node 테스트 파일 또는 파일 내 필수 문자열)을 입력하고 **요청 생성 및 Codex 시작**을 누릅니다.

최근 요청에서 실행 상태, 최종 응답, 변경 파일, 테스트 종료 코드·로그를 확인합니다. 테스트가 통과하면 **완료 조건 검토 대기**가 됩니다. 완료 조건과 근거를 확인하고 체크박스·판정 근거를 입력한 뒤 **완료 확정**을 누릅니다. 실패한 작업은 원인을 확인하고 **기존 Worktree에서 재개**할 수 있습니다. 세션·Worktree는 유지되고 이전 실패 증거는 보존됩니다.

**상태·결과 새로고침**은 미완료 작업의 검증을 다시 실행합니다. 완료 확정은 검증 당시 결과에 대한 기록입니다. 자동 검증이 없으면 수동 확인이 필요하며, Codex의 종료 또는 성공 보고만으로 자동 완료하지 않습니다.

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

`verify`는 이 PC에 남겨둔 RPC·GUI 검증 요청 2개의 계획, Git 원본과 브랜치, Codex 상태, 증거 파일 및 중복 실행 방지를 검사합니다. 새 세션을 만들지 않습니다. `npm run smoke`는 고정 테스트 키로 최초 1회 실행하거나 기존 실행을 조회합니다. 검증 이력을 지운 새 PC에서는 `verify`의 테스트 키를 해당 실행에 맞춰야 합니다.

`verify:lifecycle`은 실제 성공·실패 복구 사례의 완료 판정, 실패 로그, 테스트 불변성, 재시작 후 중복 요청 방지를 검사하고 원래 테스트를 다시 실행합니다. `npm run lifecycle -- status`로 두 사례를 조회할 수 있습니다. 실연동 생성·복구·판정용 명령은 `start`, `recover`, `approve`이며 고정 PoC 키를 사용합니다. 기존 완료 이력을 삭제하지 말고 새 검증이 필요하면 별도 키와 사례를 정의하세요.

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

주요 상태는 `running → validating → awaiting-review → completed`이며 오류·검증 실패는 `failed`, 권한 대기는 `needs-input`으로 표시합니다. 실패 복구는 같은 TASK의 시도 번호를 올립니다. Hook과 화면의 2초 간격 조회가 상태를 동기화하고, 재시작 중 놓친 Hook은 다음 조회에서 보완합니다.

단일 로컬 daemon·단일 TASK 흐름까지 검증했습니다. 자동 검증은 Node 내장 테스트 및 문자열 검사만 지원합니다. Node 검증은 Worktree 읽기만 허용하고 쓰기·자식 프로세스를 차단하며, 테스트당 10초·전체 20초로 제한합니다. 이는 임의 코드를 위한 완전한 보안 격리나 네트워크 차단을 보장하지 않습니다. 증거 파일은 파일당 2 MiB·최대 300개입니다. 다중 daemon, 장시간 부하, 일반 빌드 명령, Unity 빌드, 자동 merge는 후속 범위입니다.

환경과 검증 근거는 [검증 기록](docs/verification.md)을 참고하세요.

MVP 설계 전 검토할 구현 범위, 실제 성공·실패·복구 결과, 한계와 후속 결정 사항은 [PoC 결과 보고서](docs/poc-results.md)에 정리했습니다.

단일 작업 흐름의 기능 범위, 화면 흐름, 데이터 모델, 개발 순서와 수용 기준은 [프로토타입 MVP 설계](docs/mvp-design.md)를 참고하세요. 이 문서는 후속 구현 설계이며 위 실행 안내는 현재 PoC 기준입니다.
