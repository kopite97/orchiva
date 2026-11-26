# D6 새 PC 초기 조사와 전달 배포본 검증

2026-11-26 · Asia/Seoul · 실행 ID `d6-freshpc-20261126-201818-001`

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
