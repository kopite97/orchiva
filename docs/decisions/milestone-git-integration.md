# MA3 로컬 Git 통합과 GitHub 동기화 검증

2026-11-26 · Windows · Orchiva 작업 트리 기준 커밋 `3aad026` · 시험 ID `ma3-hud-20261126`

## 작업실에서 사용하기

**Milestone 자동화 → Git 통합과 GitHub 동기화**에서 새 실행의 반영 방식을 고른다. **원본에 선택 적용**은 MA2의 파일별 승인 절차를 사용한다. **로컬 통합 브랜치**는 검토와 내보내기가 끝난 Feature를 프로젝트 전용 Git 저장소에 통합하고, 그 SHA를 다음 Feature의 입력으로 고정한다. **GitHub 병합 필수**는 전용 원격 브랜치와 검사 이름을 지정한다. 이 모드에서는 원격 기준 SHA가 로컬 기준 SHA와 일치해야 하며, 독립 승인·필수 검사·병합 결과와 Issue 종료를 확인해야 후속 Feature를 배정한다. 실행에 고정한 정책은 재시작 후에도 적용된다.

이미 완료한 MA2 실행은 작업실에서 해당 실행을 선택하고 **기존 완료 실행의 통합 설정 고정**, **승인된 다음 Feature 통합** 순으로 진행한다. 서비스가 당시 PLAN·승인·결과·내보낸 manifest와 반영 기록을 읽는다. 게시할 때는 Feature별 공개용 PLAN을 입력한다. Issue 본문이 외부에서 변경되면 작업실에 양쪽 본문이 표시되고, 사용자가 확인한 원격 버전을 기준으로 수용 또는 덮어쓰기를 선택한다. 제작 에이전트에는 게시 명령이나 GitHub 인증값을 전달하지 않는다.

## MA2에서 통합 브랜치까지

기존 [점수 HUD 실행](milestone-local-poc.md)을 복사해 첫 Milestone의 A~E와 다음 Milestone의 F를 승격했다. 모델 호출은 0회였다. 각 커밋의 부모, 변경 경로와 파일 바이트의 SHA-256을 MA2 승인 기록과 대조했다. 시험 원본에는 추적 파일의 미커밋 변경과 미추적 파일을 추가했다. 통합 전후 원본 지문이 같았고, 최종 브랜치를 새로 체크아웃해 고정 검사 6개를 모두 통과했다. [커밋·검사·원격 매핑](../evidence/milestone-automation/MA3/ma3-hud-20261126/integration.json)

| Milestone | Feature | 승인 파일 | 로컬 통합 SHA | GitHub Issue / PR |
| --- | --- | --- | --- | --- |
| 점수 HUD | A 규칙 | `rules.txt` | `0ad900c4` | [#1](https://github.com/kopite97/PoC-sandbox/issues/1) / [#2](https://github.com/kopite97/PoC-sandbox/pull/2) |
| 점수 HUD | B 표기 | `label.txt` | `34deb0ab` | [#3](https://github.com/kopite97/PoC-sandbox/issues/3) / [#4](https://github.com/kopite97/PoC-sandbox/pull/4) |
| 점수 HUD | C 계산 | `score.cjs` | `5ac82926` | [#5](https://github.com/kopite97/PoC-sandbox/issues/5) / [#6](https://github.com/kopite97/PoC-sandbox/pull/6) |
| 점수 HUD | D 표시 | `hud.cjs` | `1cfa50e7` | [#7](https://github.com/kopite97/PoC-sandbox/issues/7) / [#8](https://github.com/kopite97/PoC-sandbox/pull/8) |
| 점수 HUD | E QA | `qa.txt` | `b9db7f88` | [#9](https://github.com/kopite97/PoC-sandbox/issues/9) / [#10](https://github.com/kopite97/PoC-sandbox/pull/10) |
| 다음 Milestone | F 인계 | `handoff.txt` | `0bb1e234` | 로컬 시험 |

로컬 브랜치 `orchiva/integration/ma3-hud-20261126`는 `bcc9c293`에서 `0bb1e234b636f5588098536c34d444e0f0b2afa1`로 진행했다. GitHub에서는 사용자가 승인한 빈 커밋 `47daf034`로 시험 저장소를 초기화하고 같은 이름의 전용 브랜치를 만들었다. 공개 PR 다섯 개는 각각 이 빈 기준점에서 승인 파일 하나만 제안한다. 따라서 PR의 head SHA와 로컬 누적 커밋 SHA는 서로 다르다. GitHub에서 Issue와 PR을 다시 조회해 PLAN별 매핑 1건, 열린 PR 5건, 병합 0건을 확인했다.

## 검증 범위

| 구분 | 결과 |
| --- | --- |
| 실제 Git | 깨끗한 기준에 승인 변경만 커밋했다. 별도 시험에서 삭제·빈 파일·바이너리와 오래된 기준 거부를 확인했다. 같은 MA2 자료를 다른 로컬 시험에서 승격해도 최종 SHA가 같았다. |
| 원격 필수 모드 | A의 Feature 커밋 준비 후 상태를 다시 읽고 재시도했다. 병합 대기 중 통합 브랜치는 초기 SHA를 유지했고 B는 배정되지 않았다. [대기 상태](../evidence/milestone-automation/MA3/ma3-hud-20261126/remote-required.json) |
| 실제 GitHub와 WinUI | B의 Issue를 외부 편집해 충돌을 재현하고 원격 본문을 수용했다. 로컬에 저장한 공개 PLAN과 GitHub 본문의 정규화된 UTF-8/LF 바이트를 5건 모두 대조했다. WinUI에서 실제 브리지를 통해 B의 결과 ID·통합 SHA·Issue·PR을 조회했다. [화면](../evidence/milestone-automation/MA3/ma3-hud-20261126/github-live.png) · [브리지 조회](../evidence/milestone-automation/MA3/ma3-hud-20261126/github-ui.json) |
| 모의 GitHub | 디스크에 저장한 상태를 다시 읽어 Issue·PR 생성·병합 응답 유실 뒤 각 쓰기가 1회인지 검사했다. 인증 거부·요청 제한, 게시자 자체 승인, 실패한 검사, 오래된 head/base, 식별이 모호한 효과의 처리를 검사했다. |
| 독립 리뷰 수용 | 필수 검사 5/5 통과 후 승인자가 없어 독립 리뷰 모드에서 병합이 차단됐다. 다른 사람의 승인 후 병합하는 경로는 실제 GitHub 미검증이다. |

## 실제 GitHub 필수 검사와 독립 승인

2026-11-26 후속 시험에서 통합 브랜치에 승인 1건, 변경된 head의 이전 승인 무효화, 최신 기준에서의 검사 통과, 관리자에게도 동일한 규칙 적용을 설정했다. 별도 시험 CI 브랜치의 GitHub Actions가 공개 PR의 변경 경로·파일 모드와 blob SHA-256을 MA2 승인 기록에 대조했다. 검사 `ma3-approved-output`의 게시 앱을 GitHub Actions로 고정했고, 다섯 PR의 head 각각에 성공 결과가 기록됐다. [Actions 실행](https://github.com/kopite97/PoC-sandbox/actions/runs/45747577111)

이전 게시 시험은 로컬 통합 모드로 검사 이름을 비워 둔 상태였다. 이런 실행에서 사용자가 처음 병합을 요청하면 Orchiva가 보호 브랜치에 실제 등록된 필수 검사 이름을 해당 PR에 저장한다. 이후 해당 요구사항을 제거하거나 지정 앱이 아닌 곳에서 검사를 게시하면 병합을 거부한다. 실제 A 병합 요청에서 Orchiva는 `ma3-approved-output`을 저장하고 `GITHUB_REVIEW_REQUIRED`를 반환했다. GitHub에서도 PR 5건 모두 승인이 필요했으며 연결된 Issue 5건 모두 열려 있었다. [원격 상태와 Orchiva 응답](../evidence/milestone-automation/MA3/ma3-hud-20261126/github-acceptance.json)

## 1인 개발 모드의 실제 병합

2026-11-26 시험 저장소에서 A는 사용자가 지정한 커밋, B~E는 승인 파일과 최신 필수 검사 통과를 조건으로 소유자 승인을 받았다. A~E 순서로 PR #2·#4·#6·#8·#10을 병합하고 Issue #1·#3·#5·#7·#9를 종료했다. 원격 통합 SHA는 `390bb559e59fd44c642a20a8e7097c0fcbdf3060`이다. 각 병합의 첫 부모는 바로 앞 통합 SHA였고, 둘째 부모는 검사를 통과한 PR head였다. 마지막 트리에 승인 파일 5개가 있으며, 각 파일의 SHA-256과 모든 Issue의 종료 주체를 다시 조회했다. [건별 검사·승인·병합·종료 기록](../evidence/milestone-automation/MA3/ma3-hud-20261126/owner-acceptance.json)

1인 개발에서는 개인 저장소 소유자가 자신이 작성한 PR을 선택하고 **1인 개발 · 표시된 커밋의 병합 승인**을 누른다. 전용 통합 브랜치에는 PR 사용, 요구 리뷰 수 0, 최신 기준의 필수 검사, 관리자에게도 보호 규칙 적용이 필요하다. 작업실에서 보고 있는 원격 PR SHA, 인증된 소유자와 PR 작성자, 지정한 GitHub 앱의 성공 검사를 대조하고 승인 방식과 계정 ID를 기록한다. 일반 독립 리뷰 병합은 기존 승인 조건을 적용한다.

이미 게시한 로컬 모드 PR의 기준이 이동하면 **승인 파일로 PR 기준 갱신**을 사용한다. 서비스는 새 기준의 파일이 승인 manifest의 변경 전 해시와 일치하는지 검사하고, 기존 Feature head와 새 기준을 부모로 하는 커밋을 Feature 브랜치에 추가한다. 갱신된 SHA로 CI를 실행한 뒤 병합을 승인한다. 서비스가 GitHub에서 병합 주체·부모·결과 트리를 확인한 뒤 연결된 Issue를 닫는다.

## 재현

새 PC에서는 의존성 설치 후 `npm.cmd run typecheck`, `npm.cmd test`로 계약·Git·모의 GitHub 경로를 검사한다. 실제 MA2 자료를 재사용하려면 해당 PC에 [MA2 PoC](milestone-local-poc.md)의 완료된 실행 디렉터리가 필요하다. 아래 두 명령은 별도 로컬 시험 디렉터리를 만들며 모델 호출과 원격 게시 없이 실행된다.

```powershell
node --import tsx scripts/milestone-integration-poc.mjs local d1-ma-poc-20261126-001 ma3-local-replay
node --import tsx scripts/milestone-integration-poc.mjs required d1-ma-poc-20261126-001 ma3-required-replay
```

각 결과는 `.desktop-local/<시험 ID>/report.json`에 저장된다. `verify`는 열린 PR의 게시 시점을 검사한다. 1인 병합 시험 자료가 있는 PC에서는 `node --import tsx scripts/milestone-integration-poc.mjs verify-owner d1-ma-poc-20261126-001 ma3-hud-20261126`으로 다섯 PR의 최신 검사·승인·병합 SHA와 Issue 종료를 GitHub에서 다시 조회한다.
