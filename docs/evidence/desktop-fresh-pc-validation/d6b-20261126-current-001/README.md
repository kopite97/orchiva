# 현재 PC 검증 증거 · d6b-20261126-current-001

2026-11-26 · Asia/Seoul. 최신 판정은 [PLAN](../../../plans/desktop-fresh-pc-validation.md), 요약은 [summary.json](summary.json)이다. 깨끗한 Windows 설치 수용 또는 모든 화면 조합의 합격 증거가 아니다.

- [run.json](run.json): 첫 모델 전송 전 고정한 조건. `budget.started=false`는 준비 당시 값이다. 최종 사용량은 summary를 따른다.
- [baseline](baseline-1795694427896.json) 및 `verify-*.json`: 실제 완료 기준과 재시작/단절/복구 전후 Agent·Workspace·메시지·결과·응답/파일 해시 대조. [최종 대조](verify-1795695225396.json)는 GUI 관측 종료 전이다.
- [window-closed.json](window-closed.json): 활성 제작 중 앱 종료 직후 UI 부재·소유 daemon listener 유지.
- [network-topology.json](network-topology.json), [network-events.json](network-events.json): 시험 전용 loopback TCP proxy의 실제 단절/복구. 외부 provider 인터넷 장애와 구분한다.
- [harness-notes.json](harness-notes.json): 최초 대조 실패와 하네스 비교 보완, 사용한 명령의 역사적 기록. 모델 명령 재실행 지침이 아니다. 원본 하네스와 실패 상태는 로컬 실행 루트에 보존했다.
- [cleanup.json](cleanup.json): 소유 프로세스/포트 부재, 설정 원복과 데이터 보존.

화면은 이름의 100/150/200이 실제 Windows 배율이다. `150-*`에는 Windows 설정에서도 관측된 한글 획 누락이 보일 수 있다. 사용자가 실제 모니터의 글자는 정상이라고 확인했으며 캡처 원인은 미확정이다. Window 캡처 크기를 정확한 OS 창 크기와 동일하다고 가정하지 않는다. 접근성 텍스트는 수집한 화면에만 `.txt`로 남겼다.

`200-projects.png`는 proxy 광고 endpoint를 맞추기 전의 **연결 실패 상태**다. `200-workspace.png`는 로딩 시점으로 최종 작업실 가독성의 합격 근거로 사용하지 않는다. 실패·중간 화면을 삭제해 성공 화면처럼 대체하지 않았다. `200-proxy-reconnected.png`와 `200-connected.png`가 연결 후 화면이다.

통신 시험은 `network-before-disconnect.png` → `network-disconnected-input-preserved.png` → `network-reconnected-input-preserved.png`를 비교한다. 미전송 시험 문장은 모델에 보내지 않았다. `200-light-*`, `150-tab-project.png`, `200-history-keyboard.png`, `200-completed-result.png`는 실제 키보드 조작/포커스 관측이며, 전체 Milestone·미디어·지침 편집 경로 전수 검사를 뜻하지 않는다. `200-system-theme-restored.png`와 cleanup 기록으로 테마 원복을 확인한다. 개인정보가 보이는 Windows 설정 전체 캡처는 이 증거 폴더에 저장하지 않았다.
