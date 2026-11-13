# Orchiva 문제 해결

먼저 요청 ID와 화면의 마지막 확정 상태를 기록한다. 공유 전에는 사용자 경로·코드·응답 원문·로그에서 비밀값을 지운다. 요청 JSON 전체나 인증 파일을 문제 보고에 첨부하지 않는다.

| 증상 | 확인 | 안전한 조치 |
| --- | --- | --- |
| `Paseo daemon is not running` / 화면 연결 실패 | `paseo daemon status --home C:\Users\USER\.paseo-orchiva --json` | 활성 작업이 없는지 확인하고 daemon이 중지된 경우 `scripts\start-paseo.ps1`을 사용한다. `daemon config.json`을 임의로 덮어쓰지 않는다. |
| Orchiva 화면/Plugin이 나타나지 않음 | `paseo plugin ls orchiva-plugin --home C:\Users\USER\.paseo-orchiva --json` | Plugin이 등록·활성인지 확인하고 `paseo plugin reload orchiva-plugin --home C:\Users\USER\.paseo-orchiva`를 실행한다. |
| `ENVIRONMENT_NOT_READY` | daemon status의 `codex.available`, 프로젝트 연결, 상태 복원 여부 | Codex provider가 가용인지 확인한다. Windows sandbox·승인·인증 설정을 낮춰 우회하지 않는다. 환경이 복구된 뒤 계획을 다시 확인한다. |
| `BUSY` | 요청 상세의 진행/확인 필요 작업과 `storage.diagnostics` | 기존 TASK를 확인한다. 미확정 명령이 있으면 해당 ID를 대조할 때까지 기다린다. 강제 슬롯 해제나 다른 요청 재전송은 하지 않는다. |
| `PLAN_STALE` | 초안 revision, 계획 SHA, sandbox HEAD/provider | 최신 초안과 기준값으로 계획을 새로 만들고 화면에서 다시 검토한다. 이전 계획을 억지로 실행하지 않는다. |
| `delivery-unknown` / `needs-input` | 명령 종류·key·message ID·마지막 대조 | **전달 결과 대조**로 원래 명령을 확인한다. `found`가 확실하지 않으면 재전송하지 않는다. `absent`도 미전송 증거가 아닐 수 있으므로 자동으로 슬롯을 풀지 않는다. |
| `resource-missing` | Agent ID, Worktree 경로, 기존 파일과 결과 | 같은 요청에 새 메시지를 보내지 않는다. 기존 증거를 보존하고 새 요청으로 복사할지 검토한다. |
| `verification-system` | 검사 파일 경로, Node 설치, 검사 시간/출력 제한, 파일 수집 한도 | 지시된 검증 방법을 확인하고, 저장된 실패 결과와 입력 파일을 유지한다. 새 모델 작업 없이 지원되는 경우에만 검증을 다시 실행한다. |
| 결과는 있으나 완료 버튼이 비활성 | 실패 검사, 수동 조건 근거, 현재 결과 ID, 검사 파일 변경 경고 | 현재 결과에 속한 근거를 모든 조건에 연결한다. 테스트 실패/누락이나 검사 파일 변경을 인정하지 못하면 완료를 확정하지 않는다. |
| 새로고침 후 화면 상태가 이전 값 | daemon의 `runtime-status`, 마지막 성공/오류 시각 | 연결 복구 후 다시 조회한다. 목록 조회는 실행·검증을 재실행하지 않는다. 이전 상태를 덮어쓰려고 JSON을 편집하지 않는다. |
| worker 중단 뒤 요청이 `failed` | 최신 결과, attempt, 기존 Agent/Workspace ID, 대기 권한·활성 turn | 기존 결과를 확인하고 같은 요청에서 재개한다. `closed` Agent는 완료 응답이 이미 수집된 정상 종료일 수 있으므로 요청 상태와 결과를 함께 확인한다. 새 요청을 재전송하지 않는다. |
| 저장에서 `EPERM` 또는 `EBUSY` | Orchiva 저장소 진단, 요청 JSON과 같은 이름의 `.tmp` | Plugin의 짧은 원자적 교체 재시도 후에도 실패하면 기존 JSON과 임시 증거를 보존한다. 연결을 복구하고 같은 요청을 다시 조회한다. JSON 또는 `.tmp`를 직접 수정·삭제하지 않는다. |
| 실행 파일 갱신 뒤 Codex provider를 찾지 못함 | `paseo daemon status`의 provider 가용성 및 `scripts\start-paseo.ps1` 결과 | 정상 종료 후 제공된 시작 스크립트로 독립 daemon을 재시작하고 다시 확인한다. 이 스크립트는 지정된 두 패키지 선택 변수만 daemon 자식 환경에서 제외한다. |

재개 의도를 저장한 직후 프로세스가 중단되면 복원 대조에서 해당 명령을 미확정으로 표시한다. 이때 **전달 결과 대조**를 사용할 수 있으며, 새 키로 재전송하지 않는다. 원래 메시지가 확인되면 같은 ID를 연결하고, 확인하지 못하면 이전 실패 결과와 슬롯을 그대로 보존한다.

검사 로그는 마지막 16,000자를 저장하고 생략 여부를 표시한다. 정상 종료 코드가 확인된 20KB 출력의 표시 생략과, 실행 프로세스의 stdout/stderr 64KiB 버퍼 초과는 다르다. 후자는 검증 오류이며 완료할 수 없다. 파일당 2MiB 또는 전체 300개 수집 한도를 넘은 경우에도 일부 수집만으로 통과하지 않는다.

## 문제 보고에 포함할 정보

- M6/REQ/TASK ID와 발생 시각(시간대 포함)
- 앱에서 보인 상태·오류 코드와 마지막 성공 관측 시각
- `paseo --version`, `paseo daemon status`의 비밀이 제거된 요약
- 예상 행동, 실제 행동, 이미 확인한 대조/복구 결과
- 사용한 검사 명령과 종료 코드
- 저장/worker 장애 시험이라면 M6 실행 ID와 마지막 확정 checkpoint, 같은 ID에서 확인한 복구 결과

요청 본문·Agent 응답·Worktree 전체·daemon 인증 파일은 필요 최소 범위와 안전한 전달 경로가 확인되기 전에는 공유하지 않는다. 외부 전송용으로 익명화된 요약을 우선한다.
