# D6 초기 조사·전달 배포본과 현재 PC 검증

## 현재 판정 · 2026-11-26 현재 PC 후속 시험

검증 종료 후 사용자가 문서·공유용 증거를 커밋하여 main에 push하도록 지시했다. 아래 로컬 저장/미커밋 표현과 JSON 상태는 검증 종료 당시의 이력이다. 이번 반영에서도 재부팅과 VM 검증은 후속으로 유지하며 최종 커밋은 Git 이력을 따른다.

사용자가 개인 사용을 우선하여 현재 PC에서 가능한 시험을 마무리하고 **깨끗한 설치/VM과 PC 재부팅은 후속**으로 결정했다. `main`의 `4f45127`에 원격 결과와 기존 로컬 조사를 합쳤다. 이전 실행의 환경 차단 판정은 보존하고, 새 격리 실행 `d6b-20261126-current-001`의 결과는 별도로 기록한다. 상세 절차·항목별 근거는 [D6 PLAN](../plans/desktop-fresh-pc-validation.md), 기계 판독 요약은 [summary.json](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/summary.json)을 따른다.

| 항목 | 최종 현재 PC 판정 |
| --- | --- |
| N01~N03 | 깨끗한 초기 조건 불충족·보류. 설치/로그인 전이는 수행하지 않음 |
| N04 | 실제 AI PLAN·최소 제작·검사·검토/내보내기·상담 통과. 승인 3턴/30분 중 3턴을 약 5분 안에 완료. ChatGPT 계정 CLI 인증 재사용, 추가 모델 턴 0 |
| N05 | 활성 UI 종료 중 제작 유지, 앱 재열기·idle daemon 재시작 후 복원 통과. PC 재부팅 미실행 |
| N06 | 소유 로컬 TCP 단절/재연결 통과. UI 미전송 입력과 응답·결과·Agent 2/Workspace 2/각 메시지 1 유지. 외부 모델 서비스 단절은 미실행 |
| N07 | 소유 앱/daemon/proxy와 포트 정리 통과. 데이터·산출물 보존. 배율 100%, 시스템 테마 복원 |
| G01 | 지속 콘솔은 표본에서 없음. 순간 노출은 사용자도 주시하지 않아 미확정 |
| G02·G11 | 실제 100/150/200% 주요 화면 조작 확인. 사용자 실제 화면 글자 정상 확인. 모든 페이지/정확한 창 크기/테마 조합은 전수 검증하지 않음 |
| G04 | 프로젝트·이력·설정의 키보드 이동/포커스와 밝고 어두운 대비 확인. Milestone·미디어·지침 편집 전체 경로 전수는 잔여 |

실제 생성·검토 명령은 공개 SDK/RPC 하네스에서, 연결/탐색/오류·복구/키보드·테마 관측은 통합 WinUI에서 수행했다. 모든 모델 전송을 GUI로 수행한 시험으로 확대하지 않는다. 단절 복구 전후의 [마지막 대조](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/verify-1795695225396.json)와 [정리](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/cleanup.json)를 보존했다. 제작 중 상담은 단일 슬롯에 의해 거절되어 기존 명령으로 나중에 대조했고 중복 턴이 없었다. 재시작 후 공급자 timeline의 message ID 생략은 영속 turn/message ID·내용 hash·개수와 구분해 검사했다. 최초 비교 실패와 endpoint 보호에 따른 proxy 초기 거절은 [하네스 기록](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/harness-notes.json)에 남겼다.

배포본 버전·지문은 아래 전달본과 동일하다. 현재 PC에서 제품 소스 수정·도구 설치·VM 설치·재부팅·새 로그인은 없었다. 이번 추가 문서·증거는 로컬 저장이며 commit/push하지 않았다. 개인 사용의 핵심 경로는 확인했으나 D6 전체/정식 공개 배포 수용을 완료로 표시하지 않는다. MA3 독립 리뷰는 기존 후속 항목이다.

## 이전 원격 실행 기록 · 2026-11-26

Asia/Seoul · 실행 ID `d6-freshpc-20261126-201818-001`. 아래 관측·미실행·원격 반영 내용은 이 실행 당시의 이력이다.

**새 PC 수용 N01~N07은 환경 차단이다.** Windows 11 x64 조건은 맞지만 개발용 Node·.NET SDK, Git·Codex CLI와 Codex 인증 파일이 이미 있다. 기존 인증 내용은 읽거나 복사하지 않았고 삭제·로그아웃·설치·빌드로 초기 상태를 바꾸지 않았다. [PLAN](../plans/desktop-fresh-pc-validation.md)과 [초기 환경 증거](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/environment.json)를 따른다. 이전 PC의 미커밋 조사는 사용자 인계 사실이며 이번 실측과 혼합하지 않는다.

## 전달본과 무결성

사용자가 소스 루트의 `d6-fresh-20261126-001-package.zip`을 지정했다. 버전 `0.1.0-d6b-preview`, manifest SHA-256 `ff39605a940f03c1f9e5a48d173466db58d055906dc1e8433445cb1ac7aeb39d`는 인계값과 일치했다. 압축 경로·링크·중복·대표 인증 파일명 검사 후 새 `.desktop-local/d6-freshpc-20261126-201818-001/received/`에 해제했다. 기존 Node로 저장소의 읽기 전용 `scripts/package-desktop.mjs verify`를 실행하여 **32,640파일 / 1,154,704,642 bytes 전체 검사 통과**(exit 0)를 확인했다. 파일 누락·추가·크기·해시·필수 파일·manifest 경로/중복·링크 검사다. ZIP에는 manifest 자체까지 32,641파일이 있다. [배포본 증거](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/package.json).

소스 `19741abec12cc7315281e5223604d7ddff5c7957`는 사용자 제공 빌드 출처이며 로컬 HEAD도 일치한다. manifest에 소스 커밋 필드가 없어 컴파일된 산출물의 출처를 독립 검증했다고 주장하지 않는다. 이전 PC의 lifecycle 승인 누락 경고는 보존한다. 이번 실행부 연결 성공은 esbuild/msgpackr-extract/node-pty의 모든 실행 경로 또는 실제 제작 성공을 증명하지 않는다.

## 기존 도구가 있는 PC의 보조 GUI 관측

Computer Use로 전달본을 실행했다. 초기 상태에서 없던 `%LOCALAPPDATA%/Orchiva.Desktop/runtime-v1`을 이번 실행이 만들었다. 기존 인증이나 legacy 데이터는 이관하지 않았다. 새 sandbox 프로젝트 `cafdadbf-cd29-44f8-80ed-28d20572ce4a`를 등록했으며 초기화·모델 실행은 하지 않았다. [관측과 정리 요약](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-summary.json).

| 항목 | 판정 | 관측 및 한계 |
| --- | --- | --- |
| 첫 실행·실행부 연결 | 통과 · 이 PC 한정 | [실제 연결 화면](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-connected-original.png). 개발 런타임이 있는 PC이므로 N01을 대체하지 않음 |
| 등록·창 재열기 | 통과 · idle 보조 시험 | [재열기 후 목록](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-reopened-project.png). 같은 project ID와 등록 파일 SHA-256 보존. 활성 작업·PC 재부팅은 미실행이므로 N05 전체 통과 아님 |
| G01 | 미실행 · 잔여 있음 | 두 번의 시작 전후와 연결 중 표본 창 목록에 지속 콘솔 창 없음. 시작 순간의 짧은 노출은 연속 관측하지 못해 전체 통과 유보 |
| G02·G11 배율 | 환경 차단 | [Windows 설정 로딩 화면](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/windows-display-settings-blocked.png)이 계속되어 실제 배율 확인·100/150/200% 변경 불가. 배율 변경 0, 복원 대상 없음 |
| G04 | 미실행 · 잔여 있음 | [밝은 테마 Tab 포커스](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-light-tab-focus.png), [어두운 테마 방향키 포커스](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-dark-keyboard-focus.png), 프로젝트 탐색의 Tab·입력·등록 관측은 통과. 전체 작업실 Tab/Enter/Escape 순서·다른 페이지 대비는 미실행 |
| 시험 소유 실행부 정리 | 통과 · 보조 GUI 시험 | 앱 종료 후 소유 home의 공개 `daemon stop` exit 0. 배포 경로 프로세스와 TCP 52335 잔여 0. 새 profile·sandbox·증거 보존 |

캡처의 작은 한글 획 일부가 끊겨 보이는 현상은 원인 미확정이다. 배율 및 캡처 렌더링 영향을 분리하지 못했으므로 가독성 통과로 처리하지 않는다. 접근성 `focused_element`가 실제 포커스 대신 텍스트 노드를 반환한 경우는 화면의 포커스 테두리로 확인했다. 앱 테마는 원래 시스템 설정(`theme=0`)으로 복원했고 창 닫기 설정(`close=0`)도 유지했다. Windows 설정 시험 창도 종료했다. 제품 실패로 확정한 항목은 없으며 미실행·차단을 통과로 집계하지 않는다.

## 남은 조건

- 개발 도구·기존 Orchiva 데이터·인증이 없는 별도 Windows 11 x64 PC/VM에서 새 실행 ID와 격리 프로젝트로 N01~N07을 수행한다. 이번 PC의 기존 항목을 제거해 조건을 흉내 내지 않는다.
- 로그인은 사용자가 직접 한다. 실제 모델 실행 전 인증 방식·사용 한도/예산을 재합의한다. 상담·AI PLAN 작성·제작의 새 모델 호출과 동일 명령 재호출을 구분한다. 이번 제품 모델 호출·재호출은 모두 0이다.
- 재부팅 전에 기록 저장·활성 작업 종료와 사용자 준비 여부를 확인한다. 이번 재부팅·네트워크 장애 주입은 모두 0이다.
- 디스플레이 설정이 정상인 환경에서 배율별 가독성·조작성과 G01 순간 노출, G04 나머지 키보드 수용을 이어간다. MA3 독립 리뷰는 기존 후속 항목으로 유지한다.

검증 완료 시점에는 문서·증거를 로컬에만 저장했다. 이후 2026-11-26 사용자가 작업 결과의 main push를 지시하여 공유용 문서·증거를 커밋·반영한다. 최종 반영 결과는 Git 이력을 따른다. 원본 ZIP·해제 배포본·실행 profile·sandbox·인증 파일은 커밋 대상에서 제외하고 로컬에 보존한다.
