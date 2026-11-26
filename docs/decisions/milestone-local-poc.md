# Milestone 자동화의 로컬 실행과 인계

2026-11-26 · Windows · MA1/MA2 · 기준 커밋 `3aad026` 이후 로컬 작업 트리

## 작업실에서 사용하기

기존 프로젝트에서 단건 요청을 만들 수 있다. 여러 Feature를 처리할 때는 같은 작업실의 **Milestone 자동화**를 연다. 로드맵을 읽거나 편집한 뒤 저장하고 Phase와 시작·종료 Milestone을 선택해 미리 본다. 각 Milestone에 Feature 1~5개가 필요하다. 1개와 5개인 두 Milestone을 연속 선택할 수 있다.

각 Feature에는 고유 ID, 목표와 허용 출력 경로가 필요하다. `dependsOn`에 선행 Feature ID를, `checks`에 프로젝트 안의 Node 검사 파일 경로를 지정한다. `references`는 문서 전체 경로나 `docs/design.md#기본-점수`와 같은 Markdown 제목 참조를 받는다. 작업실은 누락·충돌과 변경된 입력을 표시한다. 확정 후 입력이 바뀌면 재확인이 필요하다.

범위와 모델을 확인하고 실행을 만든다. 저장된 실행을 선택하면 Feature별 상태와 조율 보고서를 볼 수 있다. 배정된 Feature를 열어 PLAN 원문과 해시를 확인한 뒤 실행한다. 결과 검토에서 검사와 품질을 승인하고 내보낸 다음 원본에 반영할 변경 파일을 선택한다. 실행은 승인·반영과 원본 파일의 해시를 대조한 뒤 다음 Feature를 배정한다. 일시중지는 신규 배정을 멈춘다. 재개할 때 입력과 선행 결과를 다시 대조한다.

| 담당 | 집행 범위 |
| --- | --- |
| 서비스 | 범위, 의존 순서, 전역 한 슬롯, 안정된 요청 키, 입력·출력 해시, 고정 검사 및 선택 반영을 확인하고 기록한다. |
| Milestone 조율 담당 | 복수 Feature의 순서와 충돌을 검토하고, 완료 시 검사·승인·반영 근거로 다음 Milestone 인계 보고서를 작성한다. 입력 버전에 연결된 읽기 전용 제안을 남긴다. 단순 1건은 조율 호출을 생략한다. |
| 제작 에이전트 | 승인된 Feature PLAN과 허용 파일 안에서 구현한다. 필수 검사는 서비스가 소유한 임시 디렉터리에서 고정 입력과 후보 산출물로 실행한다. |
| 사용자 | PLAN 실행과 결과 품질, 파일 반영을 각각 결정한다. 보류된 범위를 수정할 경우 원 실행을 참조하는 새 실행을 만들 수 있다. |

## 검증 환경과 근거

격리된 Paseo home과 Git 프로젝트를 만들고 설정된 Codex 모델을 사용했다. 점수 HUD의 A 규칙, B 표기, C 계산(A), D 표시(B·C), E QA(A)를 한 Milestone에 배치했다. 다음 Milestone의 F는 D·E의 결과를 인계받는다. 시험 스크립트가 고정 기대값·허용 파일·PLAN 해시와 검사 결과를 대조하고 테스트 사용자 역할로 승인 RPC를 호출한다.

- [MA1 작업실 기록](../evidence/milestone-automation/MA1/ma-20261126-003/roadmap-ui.json)과 [MA2 작업실 기록](../evidence/milestone-automation/MA2/ma-ui-20261126-003/roadmap-ui.json)은 WinUI에서 1280/800 창과 모의 RPC로 재현했다.
- [실제 모순 검토](../evidence/milestone-automation/MA2/local-20261126/conflict.json)는 최종 점수 하나에 10과 20을 동시에 강제했다. 조율 담당이 충돌을 보고했고 Feature 요청은 0건이었다. 정상 HUD와 이 사례 각각 한 건으로 적중률을 일반화할 수 없다.
- [로컬 통합 기록](../evidence/milestone-automation/MA2/local-20261126/run.json)에 요청·세션·Worktree·PLAN·검토 ID, 검사 원문, 선행 파일 해시, 실행 구간과 재시작 근거를 보관한다. 호출 수는 조율·제작 기록에서 확인할 수 있다. 과금액은 수집하지 않았다.

정상 HUD에서 조율 PLAN은 최초 범위 검토 1회와 인계 검토 2회였다. 첫 인계 입력에는 결과 ID와 파일 해시만 있어 담당자가 판정을 보류했다. 고정 검사 결과·승인 ID·반영 파일 대조 기록을 연결한 새 입력으로 인계를 수락했다. F의 조율 모델 호출은 0회였다. D는 최초 응답이 지연돼 같은 세션에서 중단·재개했고, A는 의도적인 검사 실패를 같은 세션에서 수정했다. [실행 기록](../evidence/milestone-automation/MA2/local-20261126/run.json)

실제 반영 후 run 파일 쓰기를 유실한 시점을 별도 복사본에서 재현했다. 서비스를 세 번 다시 열어도 모델·요청 추가 없이 같은 F 결과가 한 번 수용됐다. 실행 종료 후 격리 daemon을 중지하고 기존 요청 파일의 기준 해시가 일치함을 확인했다. [복구 결과](../evidence/milestone-automation/MA2/local-20261126/gate-replay.json)

## 재현

새 실행 ID를 사용한다. 아래 예시의 `<id>`는 `d1-ma-`로 시작하는 고유 ID다. 실행 전 해당 PC에서 Paseo와 Codex 모델을 사용할 수 있어야 한다.

```powershell
npm.cmd run desktop:verify -- prepare <id> --empty
npm.cmd run desktop:verify -- start <id>
node scripts/milestone-poc.mjs setup <id>
node scripts/milestone-poc.mjs create <id>
node scripts/milestone-poc.mjs verify <id>
```

`RESTART_CHECKPOINT`는 A의 반영을 저장한 시점이다. 아래 순서로 같은 실행을 이어간다. 새 터미널에서 `status`로 진행 상황을 읽을 수 있다.

```powershell
node scripts/milestone-poc.mjs pause <id>
npm.cmd run desktop:verify -- stop <id>
npm.cmd run desktop:verify -- start <id>
node scripts/milestone-poc.mjs resume <id>
node scripts/milestone-poc.mjs verify <id>
node scripts/milestone-poc.mjs audit <id>
node --import tsx scripts/milestone-replay.mjs <id>
node scripts/milestone-poc.mjs conflict <id>
npm.cmd run desktop:verify -- stop <id>
```

검증 결과는 해당 실행의 `.desktop-local/<id>/milestone-report.json`과 `milestone-conflict.json`에 남는다. 로컬 PoC의 수용 범위는 Node 기반 소형 Git 프로젝트이고, 통합 브랜치·병렬 실행·Unity 검증은 MA3 이후 계획에서 다룬다.
