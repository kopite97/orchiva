# M6 시험 도구

소스 루트에서 실행한다. 계획의 허용 범위와 새 실행 ID·baseline이 먼저 필요하다. 아래는 개발자용 단계이며 제품의 일반 사용은 [사용자 안내](../../docs/user-guide.md)를 따른다. 완료된 ID를 재실행하면 기존 증거 충돌로 거부하는 것이 정상이다.

## 진입점과 원시 증거

`npm run m6 -- help`는 init/preflight/measure/performance/response-drop/restart/soak/a11/d06/d06-recover/own/verify-baseline의 실제 영향을 설명한다. 생성·장애 명령은 기존 보존 실행의 verify와 다르다. 원시는 `%USERPROFILE%/.orchiva/m6/<run-id>/`에 남기며 인증 자료·요청 원본 전체는 소스 Git에 넣지 않는다. 최종 [M6 결과](../../docs/decisions/m6-acceptance.md)와 [계획](../../docs/plans/m6-acceptance.md)에 사용한 ID·조건·한계를 기록했다.

| 파일 | 역할·부수 효과 |
| --- | --- |
| `measure.mjs`, `p02-live.mjs` | 격리 합성 100건, 실제 순차 30 Agent/Workspace·동일 세션 재개 |
| `d03-response-drop.mjs`, `d04-live.mjs` | 실제 SDK 응답 frame 유실, 성공 응답 뒤 소유 writer 종료·원래 ID 대조 |
| `isolated.mjs`, `fault-worker.mjs` | 별도 JSON store의 소유 child 종료·migration·owner·검증 한도. 외부 효과는 ledger 모의 |
| `d06-worker-kill.mjs`, `d06-recovery.mjs` | 전용 실제 Paseo worker 종료·supervisor 복원·같은 세션 재개 |
| `d07-proxy.mjs`, `d07-lifecycle.mjs` | localhost 6768의 시험 TCP proxy·연결 cut/restore·Plugin 종료 경합 |
| `preview.mjs`, `p03.mjs` | 보완 실행의 완료 S를 사본 store에서 같은 실제 Agent로 재개. Hook/poll 상태 저장과 GUI ID 대조 |
| `slow-validation.mjs` | P03 성능 종료 뒤 preview collect만 8초 지연. 실제 재검증의 validating 화면 관측용 |
| `supplement.mjs` | S/F/M/C/B/I/P02 초안·시작·디스크 wait·stale/수동 근거/검사 변경. seed는 9개 요청, 실제 신규 Agent 예산은 8개 |
| `resources.mjs` | M6 소유 Worktree의 파일/.git 포인터만 가역 변경·복원. 실제 Agent 삭제 없음 |
| `clean-install.mjs`, `plugin-ownership.mjs` | 같은 소스·격리 config/데이터의 첫 사용, 두 실제 Plugin의 동일 store owner 충돌·교체 |
| `p01-rpc.mjs` | 합성 100건의 실제 Plugin RPC, cold/warm-up/30회와 writer mutex 경합. 활성 Agent가 있으면 거부 |
| `ui-fixtures.mjs` | 읽기 전용 5개 상태의 같은 client 렌더. 실제 질문/권한 재현으로 집계하지 않음 |
| `p04-restarts.mjs`, `a11-daemon-stop-start.mjs`, `p05-soak.mjs` | idle 재시작·전체 정상 종료/시작·30분 안정 요청 관측 |
| `output-limit.mjs`, `backup-restore.mjs` | 실제 Node 출력 버퍼 초과, daemon 중지 후 새 사본으로 원본 byte 복원 대조 |
| `summarize.mjs`, `record-completion.mjs`, `verify-final.mjs`, `document-check.mjs` | 원시 표본·SHA 집계·최종 요약·회귀 로그·문서 정합성 |
| `cleanup.mjs`, `finish-idle.mjs` | 소유 임시 등록/연결 해제·정상 환경 복원. finish-idle은 별도 idle P01 후 측정 Plugin 하나만 제거 |

## 100건 실제 RPC 재현

새 ID의 baseline과 `measure` 합성 데이터가 있어야 한다. 기존 PC의 완료된 M6 ID를 새로 만드는 예제로 사용하지 않는다.

```powershell
npm run m6 -- init m6-<new-id>
npm run m6 -- measure m6-<new-id>
node scripts/m6/clean-install.mjs m6-<new-id> p01-rpc-idle
paseo plugin install "$env:USERPROFILE/.orchiva/m6/m6-<new-id>/p01-rpc-idle" --home "$env:USERPROFILE/.paseo-orchiva" --json
node scripts/m6/p01-rpc.mjs m6-<new-id> p01-rpc-idle
paseo plugin remove orchiva-m6-measure --home "$env:USERPROFILE/.paseo-orchiva" --json
```

첫 설치의 의존성·인증은 기존 고정 SDK를 재사용한다. 이 단계만으로 새 PC 설치를 검증하지 않는다. 실행 데이터와 fixture seed가 다른 ID이면 clean-install의 마지막 인수에 seed ID를 명시한다. Plugin은 현재 PC의 허용 sandbox config를 사본으로 사용한다. 설치·제거가 끝나면 daemon config의 원래 bytes/내용과 정상 상태를 확인한다.

`p03.mjs <run-id> <새 p03 폴더> <완료 뒤 hold ms> <경로별 표본 수> <첫 시작 지연 ms>`는 새 명령 키와 새 결과를 추가한다. hold/시작 지연은 GUI 관측용이며 저장 반영 시간에 포함하지 않는다. GUI 관측 도구의 공백은 지연 상한에 포함하고 누락 ID를 보간하지 않는다.

## 이어가기와 정리

시간 초과나 수집기 오류 뒤에는 저장된 명령·결과·외부 ID부터 확인한다. 같은 ID가 접수됐으면 새 start를 보내지 않는다. `supplement`의 P02 이어가기는 이미 시도 2가 확인된 요청을 다시 재개하지 않는다. `cleanup <run-id> continue`는 원시 cleanup 실패가 Plugin 목록 배열 해석 문제이고 임시 제거·proxy 종료·설정 복원이 이미 완료됐다는 조건에서만 나머지 정상 종료를 수행한다.

임시 Plugin 폴더·결과·실패 temp는 증거로 남긴다. 등록 제거와 연결 종료를 파일 삭제로 해석하지 않는다. 실제 세션은 해당 요청 소유임을 확인한 뒤 Paseo UI에서 중단한다. 시스템 방화벽·전역 보안·권한·인증 설정을 바꾸지 않는다.
