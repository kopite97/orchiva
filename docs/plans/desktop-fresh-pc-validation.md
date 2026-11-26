# D6 새 PC 설치·로그인 검증

- 상태: 상위 [데스크톱 전환](desktop-transition.md) `active`의 D6 상세 단계 · 현재 PC 시험·G01 직접 관측·G04 화면별 키보드 확인 완료, 재부팅·깨끗한 설치/VM·화면 조합 전수는 후속 (독립 active PLAN 아님)
- 작성일: 2026-11-17 · Asia/Seoul
- 관련 설계: [데스크톱 전환](../design/desktop-transition.md), [배포 안내](../guides/desktop-package.md)
- 선행 조건: [D6 배포·통합 작업](desktop-transition.md)의 시험할 배포본 고정, 별도 Windows 11 x64 PC 또는 깨끗한 VM, 사용자 로그인 참여
- 실행 근거: 최초에는 계획 작성만 승인됐다. 2026-11-26 사용자가 `19741ab` 기준 초기 조사·N01~N07·통합 GUI 재관측을 지시하여 상위 D6 상세 단계로 재개했다. 초기 조사에서 깨끗한 환경 조건 불충족을 확인했다. 별도 active PLAN은 추가하지 않는다.

## 목표

개발용 .NET·Node와 기존 Orchiva 데이터가 없는 환경에서 배포본을 실행하고, 사용자가 Git·Codex 설치 및 정상 인증을 마친 뒤 실제 작업과 재시작을 수행할 수 있는지 확인한다. 현재 PC에서의 격리 profile 시험을 새 PC 수용으로 대체하지 않는다.

## 현재 근거와 확인할 사항

[D6a 결과](../decisions/desktop-d6-package.md)는 현재 개발 PC에서 동봉 런타임·첫 실행·빈 데이터·GUI·재접속을 검증했다. 새 OS의 네이티브 의존성, 사용자 설치/인증, 방화벽·보안 정책, PC 재부팅은 미검증이다. Windows 11 x64를 최초 대상으로 하며 Windows 10/ARM64 지원은 별도 결정이다.

## 범위

2026-11-26 현재 PC 후속 승인: 사용자는 개인 사용을 우선하여 깨끗한 환경 검증을 미루고 현재 PC에서 가능한 N04~N07·잔여 GUI와 원격/로컬 기록 통합을 지시했으며, 가능하면 VM 검증을 요청했다. `4f45127`을 fast-forward하고 이전 로컬 조사·지문을 아래 이력과 별도 증거 폴더로 보존했다. 현재 PC 시험 `d6b-20261126-current-001`은 기존 profile을 변경하지 않는 별도 data/Paseo home/프로젝트를 사용한다. CLI status만으로 ChatGPT 계정 로그인을 확인했고 인증 내용은 수집하지 않았다. 사용자 설명 후 상담 1턴·AI PLAN 1턴·최소 제작 1턴, 최대 3턴·30분을 승인받았다. 이는 앱 수준 작업 턴/시간 예산이며 내부 API 요청 수나 고정 토큰·요금 한도가 아니다. 추가 모델 턴·재시도는 별도 조율한다. VM은 Windows 11 Home, 가상화 활성·RAM 약 32GB·디스크 약 559GB 여유를 확인했으나 VM 제품/ISO가 없어 별도 준비가 필요했다. 사용자는 최종적으로 **현재 PC 마무리, VM은 후속**, **재부팅은 나중에**로 결정했다. N01~N03 보류를 통과로 바꾸지 않으며 현재 PC 개인 사용 확인과 깨끗한 설치 지원 판정을 구분한다.

2026-11-26 실행 제약: 설치 전 초기 환경과 인증 파일 존재 여부만 조사하며 인증 내용은 읽거나 복사하지 않는다. Git 설치로 초기 조건을 바꾸지 않고 필요하면 소스 ZIP을 사용한다. 별도 빌드 PC의 전체 배포 폴더만 사용하며 시험 PC에 SDK·Node를 설치해 빌드하지 않는다. 기존 데이터 삭제·로그아웃으로 깨끗한 상태를 만들지 않는다. 실제 모델 호출 전 Codex 인증 방식·사용 한도/예산을 다시 조율하며 상담·AI PLAN·제작의 새 호출과 같은 명령 재호출을 구분한다. 로그인은 사용자가 직접 진행한다. 재부팅 직전 기록을 저장하고 사용자 준비 여부를 확인한다. 아래 계획 작성 당시 실행 제외 문장은 당시의 이력이다.

새 시험 계정과 소유 sandbox 프로젝트만 사용한다. 실제 모델 호출은 사용자 재개 시 예산을 확인해 상담 1건과 최소 제작 1건으로 시작한다. 개발 PC의 인증·설정·요청·Paseo home은 복사하지 않는다. 로그인 화면은 사용자가 직접 조작하고 인증값은 증거에 남기지 않는다. 이번 계획 작성에는 설치·VM 생성·로그아웃·재부팅·외부 호출이 포함되지 않는다.

## 작업 순서와 산출물

| 작업 | 변경할 파일 또는 예정 파일 | 수행 내용 | 다음 단계로 넘길 결과 |
| --- | --- | --- | --- |
| 1 | 이 PLAN·배포 manifest | 사용자 실행 지시 후 OS/아키텍처·깨끗한 환경·패키지 버전/hash·시험 범위 고정 | 소유 실행 ID와 비밀값 없는 환경 목록 |
| 2 | 예정 `docs/evidence/desktop-fresh-pc-validation/<run-id>/` | 전체 폴더 복사·무결성 검사·exe 시작, 동봉 runtime 확인 | 시작 결과·누락 의존성·화면 |
| 3 | 같은 증거 경로 | Git/Codex 없음→설치, 미인증→사용자 로그인→앱 재확인 | 상태 전이·안내·실패 원인, 인증 원문 제외 |
| 4 | 소유 sandbox·같은 증거 경로 | 등록/초기화→상담→PLAN/제작→검토·내보내기 | 실제 파일/세션/명령 수와 결과 지문 |
| 5 | 같은 증거 경로 | 앱 종료·재열기·PC 재부팅, 네트워크 오류 후 복구 | 인증 재사용·기록 보존·중복 생성 없음 |
| 6 | 예정 `docs/decisions/desktop-fresh-pc-validation.md`, 계획 목록 | 실패/미실행/통과와 정리·지원 범위 기록 | 새 PC 수용 판정 |

## 검증 계획

통합 GUI 관측은 G01 콘솔 노출, G02·G11의 100/150/200% 가독성·조작성, G04 키보드 이동·포커스·밝은/어두운 대비를 확인한다. 변경한 배율은 원래대로 복원한다. 기존 도구가 있는 PC의 GUI 관측은 깨끗한 새 PC 수용과 구분한다.

| ID | 종류 | 조건과 절차 또는 명령 | 기대 결과 | 보존할 증거 |
| --- | --- | --- | --- | --- |
| N01 | 실제·GUI | 개발용 런타임·도구 설치 전 exe 시작 | .NET/Node 설치 요구 없이 UI 및 실행부 연결. 필요한 OS 의존성이 있으면 명시적 실패 | OS build·배포 hash·화면·오류 코드 |
| N02 | 실제·GUI | Git/Codex 미설치 상태 확인 후 공식 설치 | 부족한 도구와 해결 절차 안내, 설치 후 상태 갱신 | 버전·상태 전이 |
| N03 | 실제·GUI | 미인증 상태 확인, 사용자 정상 로그인 | 인증 필요/준비됨 구분. 원문·키·인증 파일 수집 없음 | 성공 여부와 앱 표시 |
| N04 | 실제 연동 | 새 소유 sandbox에서 상담 1건·최소 제작 1건 | 응답/산출물·검토 가능, 같은 명령 재호출로 새 실행 없음 | ID·개수·파일 hash·결과 |
| N05 | 실제·GUI | 활성 작업 중 앱 닫기/재열기, idle 상태 PC 재부팅 | 창 종료 중 실행 유지, 재부팅 후 기존 기록 복원·상태 정직 표시 | 전후 ID/hash·프로세스·화면 |
| N06 | 실제·GUI | 소유 환경의 네트워크 단절 후 재연결 | 입력/마지막 결과 보존, 관측 실패를 작업 실패로 오판하거나 재전송하지 않음 | 오류·복구·개수 대조 |
| N07 | 실제 정리 | 시험 앱/daemon 종료, 데이터 보존 | 소유 프로세스/포트 정리, 사용자 시스템·다른 프로젝트 무변경 | 정리 목록·보존 경로 |

실행 명령과 로그인 절차는 해당 배포본·공식 도구 버전에 맞춰 확인한다. 아직 구현되지 않은 자동 검증 명령을 존재하는 명령처럼 안내하지 않는다. N01~N07의 깨끗한 새 PC 시험은 환경 차단이며 기존 PC의 보조 관측은 아래 기록과 구분한다.

## 실패 처리와 복원

보안 경고·인증 요청은 우회하지 않는다. 설치 실패·지원 OS 불일치·공용 서비스 장애는 시험 결과에 남기고 기존 데이터를 삭제해 재시도하지 않는다. 불확실한 모델 전송은 새 요청으로 대체하지 않고 기존 명령/세션을 대조한다. 재부팅 전 활성 모델 작업을 마치거나 명시적 중단을 확인한다. 소유 VM snapshot은 복구 기준으로 쓸 수 있지만 실패 증거를 별도 보존한 후 복원한다.

## 완료 조건

- [ ] N01~N07의 실제 결과와 증거를 기록했다.
- [ ] 인증/네이티브 의존성·설치 문제를 해소하거나 지원 제한을 명시했다.
- [x] 현재 PC 범위에서 실제 산출물과 기록 보존·중복 방지·정리를 확인했다. 새 OS/PC 재부팅 수용은 별도 잔여다.
- [x] 결정 기록·배포 안내·D6 계획·목록을 함께 갱신했다.

## 실행 및 검증 기록

### 2026-11-26 G01 직접 관측과 G04 화면별 키보드 후속

사용자가 재부팅·VM을 계속 후속으로 두고 G01 순간 콘솔과 G04 전체 키보드 이동 검증을 지시했다. 관측 실행 ID는 `d6-gui-20261126-002`, 소스 기준은 `f9473f8c5b7492efc7113a31a4cbeab264c5ae01`이다. 고정된 `0.1.0-d6b-preview` 배포본과 완료된 시험 전용 `d6b-20261126-current-001` profile을 재사용하여 조회했다. 새 모델 턴, 제작 요청 저장, Git 게시/병합, 원본 적용, 권한 변경은 없다. 과거 기록의 G01/G04 잔여 판정은 당시 이력이며 아래 관측이 보완한다.

| 항목 | 판정 | 절차·근거·한계 |
| --- | --- | --- |
| G01 | 통과 · 이번 시작 1회 직접 관측 | 준비됨 확인 후 exe 시작 → 격리 실행부 시작 → 연결됨을 함께 관측했다. 사용자는 **“순간 노출 없이 정상”**이라고 답했다. [사용자 확인](../evidence/desktop-fresh-pc-validation/d6-gui-20261126-002/g01-witness.json). 정지 화면만으로 순간 노출 부재를 추정한 것이 아니며 모든 시작 조건의 반복 시험은 아니다. |
| G04 | 통과 · 화면별 키보드 이동 범위 | 배포본의 프로젝트/초기화/작업실/설정/지침/요청/미디어/PLAN/이력/결과/반영/상담/Milestone·Git/연결/앱 설정/기존 MVP 빈 화면을 순회했다. Tab·Shift+Tab, 탐색/목록 방향키, Enter·Space, 펼침, 긴 페이지 자동 스크롤과 가시 포커스를 확인했다. 실행/복구·반영 복원 하단·조건부 Phase 검토는 같은 제품 XAML을 사용하는 **모의 GUI**로 보완했다. [경로별 증거](../evidence/desktop-fresh-pc-validation/d6-gui-20261126-002/README.md). |
| 대비·조합 | 육안 확인 · 수치/전 조합 제외 | 실제 어두운 화면과 밝은 설정, 모의 밝은 실행·복원·Phase에서 글자와 포커스 경계를 구별했다. Phase는 1280×900과 800×600에서 추가 확인했다. 대비 비율 측정·스크린리더·모든 상태×배율×테마 조합 전수 및 실제 권한 응답/파괴적 버튼 활성화는 포함하지 않는다. |
| 보존 대조 | 통과 · 추가 모델 호출 없음 | 실제 GUI 종료 전 readonly `driver.mjs verify` 통과: Agent 2, Workspace 2, 메시지 각 1, 기존 결과·응답·파일 정체성 보존. [대조](../evidence/desktop-fresh-pc-validation/d6-gui-20261126-002/preserved-run-verify.json). |

조건부 Phase를 모델 실행 없이 관측하기 위해 `Orchiva.Desktop.UiTests`에 **Phase 키보드 검증** 진입점을 추가했다. 모의 응답을 기존 `roadmap-open`/`run-read` 표시 경로로 전달하며 실제 Bridge는 연결하지 않고 Phase 판정 저장은 거절한다. 최초 fixture는 프로젝트 로드 조건을 준비하지 않아 표시 검사가 실패했다. 실패 JSON을 보존하고 `roadmap-open`을 거치도록 보완했다. 최종 build는 경고/오류 0, 기존 모의 검사 21개 및 Phase 표시 검사 통과, Computer Use에서 메모 → 승인 → 반려 → 다음 컨트롤 이동과 compact 자동 스크롤, Escape 닫기를 확인했다. 제품 코드·고정 배포본을 변경한 것은 아니다.

배포본의 초기 로드맵은 저장 revision이 없는 기본 예시여서 구간 미리보기에 저장 안내가 표시됐다. 저장하지 않고 포커스만 점검했으며 이를 키보드 결함으로 판정하지 않았다. UI Automation의 `focused_element`는 일부 이전 텍스트를 반복 보고했으므로 판정은 실제 화면의 테두리·캐럿·선택 표시를 사용했다. 도구의 사용자 입력 감지/캡처 오류 뒤에는 재관측했고 불확실한 중간 시도를 통과 근거로 삼지 않았다.

마지막 [정리](../evidence/desktop-fresh-pc-validation/d6-gui-20261126-002/cleanup.json): 배포 앱과 모의 앱 종료, 시험 home의 공개 daemon stop 성공, 소유 프로세스와 60596/54927 listener 0. theme/close는 0으로 복원했고 이번에는 배율을 변경하지 않았다. profile·소스·산출물·실패 근거는 보존했으며 manifest 지문도 동일하다. [정적 검증](../evidence/desktop-fresh-pc-validation/d6-gui-20261126-002/validation.json)은 변경 Markdown 5개·상대 링크·증거 JSON·UTF-8·단일 active PLAN·diff 확인을 포함한다. 제품 TypeScript 테스트나 전체 배포 재빌드를 반복한 결과와 혼동하지 않는다.

검증 종료 후 사용자가 이번 G01·G04 증거·모의 하네스·문서 변경을 커밋하고 main에 push하도록 지시했다. 증거 JSON의 로컬 저장 상태는 검증 종료 당시 이력이며 최종 반영 커밋은 Git 이력을 따른다. 재부팅, VM/깨끗한 설치, MA3 독립 리뷰는 계속 후속이다. 전체 D6/공개 배포 수용 완료로 확대하지 않는다.

### 2026-11-26 검증 기록 main 반영 지시

현재 PC 시험 종료 후 사용자가 검증 결과·문서 변경을 커밋하고 main에 push하도록 지시했다. 아래의 로컬 저장/미커밋 문구와 증거 JSON의 `committedOrPushed=false`는 검증 종료 당시의 상태다. 이번 반영 범위는 문서와 공유용 환경·해시·화면 증거이며 배포 바이너리, 인증 파일, 실행 profile·원본 요청·로컬 하네스는 제외한다. 최종 반영 커밋은 Git 이력을 따른다. **PC 재부팅과 VM/깨끗한 설치 검증은 후속으로 유지**하며 새 시험이나 모델 호출은 수행하지 않는다.

### 2026-11-26 현재 PC 실제 연동·GUI·정리 완료

기준은 최신 `main`/`origin/main`의 `4f45127a39b4e5878d40cbbd7d5d37301d7966c1`이며 종료 전 fetch에서도 차이 0/0이다. 제품 코드는 인계 `19741ab`와 같고 변경은 문서·증거뿐이다. 배포본은 위와 같은 `0.1.0-d6b-preview`, manifest SHA-256 `ff39605a940f03c1f9e5a48d173466db58d055906dc1e8433445cb1ac7aeb39d`로 종료 후에도 같다. 최초 전체 파일 검사와 마지막 manifest 동일성 검사를 구분한다.

- 실행 ID `d6b-20261126-current-001`, 로컬 보존 루트 `.desktop-local/d6b-20261126-current-001/`. 별도 profile/data/Paseo home, 한글·공백 경로의 `시험 소스`와 `결과물`을 사용했다. project ID `60531da9-dffa-4ede-83ed-7f6eeb02f6cb`. 기본 runtime-v1은 시험 대상으로 사용하지 않았다.
- 동봉 Node/Paseo/Plugin 및 고정 배포 exe로 실행했다. 실제 변경 명령은 공개 SDK/RPC 하네스, 화면 읽기·조작은 통합 WinUI에서 수행했다. 모든 모델 버튼을 GUI로 누른 end-to-end 시험으로 표현하지 않는다.
- 승인 예산 3턴/30분에서 **AI PLAN 1 + 제작 1 + 상담 1** 완료. 첫 전송 `2026-11-26T11:55:29.558Z`, 완료 기준 대조 `12:00:27.897Z`까지 298.339초(약 5분). 이후 모델 새 턴 0. API key를 등록하지 않았으며 CLI가 보고한 ChatGPT 계정 인증을 재사용했다. 내부 HTTP 요청/토큰/금액은 측정하지 않았다. [요약](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/summary.json)

| 항목 | 판정 | 실제 결과·근거와 한계 |
| --- | --- | --- |
| N01~N03 | 보류 · 초기 환경 불충족 | 기존 도구/인증이 있어 설치·로그인 상태 전이 미실행. 개인 사용 우선 결정으로 VM/깨끗한 OS 준비를 후속으로 둠 |
| N04 | 통과 · 현재 PC 실제 연동 | AI PLAN 확인 후 최소 제작, `answer.txt`의 `42\n` 3 bytes와 고정 Node 검사 1/1 통과, 검토 승인·내보낸 파일 확인. 상담 answered 1건. 같은 제작/상담 명령 재호출 후 Agent 2, Workspace 2(제작 worktree 1 + 상담 checkout 1), 각 user message 1 유지. [완료 기준](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/baseline-1795694427896.json) |
| N05 | 부분 통과 · 재부팅 보류 | 제작 running 중 Alt+F4로 UI 종료, 소유 daemon/포트 유지 및 창 없는 동안 완료. 재열기와 idle daemon 정상 재시작 후 같은 ID/결과/응답/파일 복원. [창 종료 증거](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/window-closed.json). PC 재부팅은 사용자 결정으로 미실행 |
| N06 | 통과 · 로컬 통신 경계 | 소유 TCP proxy 54927→60596의 실제 연결을 17.716초 끊음. WinUI 새로 고침은 조회 실패·마지막 정보 유지로 표시하고 미전송 입력/응답 보존. 재연결 후 동일 결과/개수/해시. [단절 화면](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/network-disconnected-input-preserved.png), [복구 화면](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/network-reconnected-input-preserved.png), [이벤트](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/network-events.json). 외부 모델 서비스 인터넷 단절은 미실행 |
| N07 | 통과 · 현재 PC 정리 | UI 종료, 해당 home의 공개 `daemon stop` exit 0, proxy stop. 소유 프로세스/60596·54927 listener 0. 배율 100%, theme/close 0으로 원복, 설정 창 종료. profile·sandbox·결과·실패 증거 보존. [정리](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/cleanup.json) |
| G01 | 부분 관측 · 잔여 | 시작/연결 표본에서 지속 콘솔 없음. 순간 노출은 자동 연속 관측하지 못했고 사용자는 주의 깊게 보지 않아 모른다고 답함. 전체 통과로 표시하지 않음 |
| G02·G11 | 배율 관측 통과 · 조합 잔여 | 주 모니터 3440×1440의 실제 Windows 100→150→200%에서 연결/프로젝트/작업실/상담/이력/설정의 해당 화면 조작, compact 탐색 축소·줄바꿈·스크롤 확인. [150% Tab](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/150-tab-project.png), [200% 상담](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/200-conversation-result.png). 150% 캡처는 Windows 설정과 앱 모두 한글 획이 일부 빠졌으나 **사용자가 실제 모니터 글자는 정상임을 확인**. 캡처 원인은 미확정. 모든 화면×정확한 창 크기×테마 조합을 전수 통과한 것은 아님 |
| G04 | 부분 통과 · 잔여 | 프로젝트 Tab/Enter, 이력 Tab 자동 스크롤/Enter 실행 결과 열기, 설정 Tab·Shift+Tab·방향키·Enter·Space·Escape와 밝은/어두운 포커스·대비 육안 확인. [밝은 Tab 포커스](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/200-light-tab-focus.png), [이력 포커스](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/200-history-keyboard.png). 전체 Milestone/미디어/지침 편집 경로의 키보드 전수 및 대비 수치 측정은 미실행 |

N04 결과 ID `d382a05d-1a39-4908-ac67-b1aa399a14cb`, 결과 파일 SHA-256 `084c799cd551dd1d8d5c5f9a5d593b2e931f5e36122ee5c793c1d08a19839cc0`. 원본 소스에 결과를 적용하거나 push/merge하지 않았다. 마지막 [복구 대조](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/verify-1795695225396.json)는 Agent/Workspace/turn/message/result ID, 응답·파일 해시와 개수를 확인했다. 공급자 timeline은 daemon 재시작 후 `clientMessageId`를 생략할 수 있어 최초 엄격 비교가 실패했다. 이전 ID→null만 허용하도록 하네스 대조를 수정했으며 영속 상담 turn/message ID와 내용 해시·개수는 여전히 동일해야 한다. 이를 새 메시지 또는 제품 복원 실패로 숨기지 않고 [하네스 기록](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/harness-notes.json)에 남겼다.

제작 중 상담 전송은 `GLOBAL_EXECUTION_BUSY`로 거절됐다. 제작 검토 후 **기존 예약 명령**으로 대조하여 answered 1건만 생성했다. proxy 첫 연결은 광고 endpoint 불일치로 거절됐고, 공개 daemon 실행의 자식 환경에서 광고 endpoint를 proxy와 일치시켜 재시작했다. [시험 통신 구성](../evidence/desktop-fresh-pc-validation/d6b-20261126-current-001/network-topology.json)은 backend bind 60596, UI/광고 54927이다. 제품의 endpoint 보호를 변경하지 않았다. 초기 SDK entry 구조 해석 오류도 하네스 수정이며 제품 소스는 변경하지 않았다. 과거 npm lifecycle 경고는 보존하며 이번 실제 성공으로 모든 네이티브 경로의 성공을 주장하지 않는다.

재현 기록: 기존 `scripts/desktop-integrated.mjs setup <run-id>`로 격리 환경 준비 후 로컬 `driver.mjs`의 plan/start/conversation/review/conversation-reconcile/baseline/verify를 사용했다. 모델 전송 명령은 재실행용 안내가 아니다. 현재 run은 종료 상태이며 후속 재부팅 시험을 할 때 먼저 사용자 준비를 확인하고 원래 `desktop.json`(직접 endpoint)으로 재개한다. 새 VM 검증은 별도 실행 ID로 초기 상태부터 기록한다. 현행 로그·profile을 삭제하거나 이 기록을 새 PC 합격으로 바꾸지 않는다. 이번 문서·증거는 로컬 저장이며 commit/push하지 않았다.

최종 정적 검증: 변경/추가 Markdown 6개, 상대 링크 167건, 로컬 초기 조사·현재 시험 JSON 14개, UTF-8·코드 블록·필수 절·단일 active PLAN 및 `git diff --check` 통과. 로컬 driver/proxy의 `node --check`도 통과했다. 제품 소스 변경이 없으므로 제품 전체 단위 테스트·재빌드는 반복하지 않았다. 이는 위 실제 연동/GUI 결과와 별도의 문서 검증이다.

### 2026-11-26 초기 조사와 사용자 대기 요청

- 실행 ID: `d6-fresh-20261126-001`. `C:/Dev/Orchiva`의 clean main에서 `git pull --ff-only origin main` 실행, 최신 기준은 인계 커밋 `19741abec12cc7315281e5223604d7ddff5c7957`과 동일했다.
- [초기 상태](../evidence/desktop-fresh-pc-validation/d6-fresh-20261126-001/initial-state.json): Windows 11 Home x64 build 26300. 기존 Node 26.13.0, Git 2.56.0.windows.3, Codex CLI 0.166.0, 로컬 .NET SDK 10.0.401, 인증 파일 존재, 기존 Orchiva runtime-v1 및 과거 배포·개발 폴더를 발견했다. 인증 파일 내용은 읽지 않았다. 따라서 깨끗한 새 PC 조건은 **환경 차단**이며 설치/미인증 상태의 N01~N03 통과로 간주하지 않는다.
- 초기 기록 후 기존 SDK로 `.desktop-local/d6-fresh-20261126-001-package`의 별도 배포 준비를 시작했다. 이 PC를 빌드 환경으로 사용할 수 있으나 새 PC 수용 환경으로 대체하지 않는다. 로그는 `%TEMP%/d6-fresh-20261126-001/package-build.log`에 보존한다. 전역 개발 도구 설치·기존 데이터 복사/삭제·앱 실행·모델 호출은 하지 않았다.
- 준비 중이던 패키지는 build 및 전체 manifest 검사를 종료 코드 0으로 마쳤다. [배포 지문](../evidence/desktop-fresh-pc-validation/d6-fresh-20261126-001/package-summary.json): `0.1.0-d6b-preview`, 32,640파일, 1,154,704,642 bytes, manifest SHA-256 `ff39605a940f03c1f9e5a48d173466db58d055906dc1e8433445cb1ac7aeb39d`. npm은 esbuild/msgpackr-extract/node-pty의 lifecycle script 승인 누락 경고를 냈으며 실행부 동작은 아직 검증하지 않았다. 다른 PC에는 폴더 전체를 전달하고 재검사해야 한다. 초기 기록·PLAN 변경은 로컬 저장이며 commit/push하지 않았다.
- 문서 검증: 변경 PLAN 3개의 상대 링크 120건, UTF-8 읽기, `git diff --check` 통과. 런타임 수용 시험의 통과를 의미하지 않는다.
- Computer Use 초기화와 앱 목록 조회만 수행했다. G01·G02·G04·G11의 실제 Orchiva 화면 관측은 미실행이다. N04~N07도 미실행이다.
- 사용자는 별도 PC 준비를 위해 대기를 요청했다. 새 PC에서는 새 실행 ID를 사용하고 개발 도구 설치 전 상태부터 다시 기록한다. Git·Codex·인증·기존 데이터가 있으면 사실대로 남기고 조건을 우회하지 않는다. 상담/PLAN/제작 모델 호출 전 사용 방식과 예산을 다시 조율한다. MA3 독립 리뷰는 후속 항목으로 유지한다.


### 2026-11-26 초기 조사

후속 전달본 무결성과 보조 GUI의 최종 결과는 [판정 기록](../decisions/desktop-fresh-pc-validation.md)에 모았다. 버전 `0.1.0-d6b-preview`, 사용자 제공 소스 `19741abec12cc7315281e5223604d7ddff5c7957`, manifest SHA-256 `ff39605a940f03c1f9e5a48d173466db58d055906dc1e8433445cb1ac7aeb39d`, 전체 32,640파일 / 1,154,704,642 bytes 검사는 통과했다. [패키지 증거](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/package.json). manifest에 커밋 필드가 없어 빌드 출처 자체는 사용자 인계에 의존한다.

소유 sandbox는 `.desktop-local/d6-freshpc-20261126-201818-001/sandbox/source`, 등록 project ID는 `cafdadbf-cd29-44f8-80ed-28d20572ce4a`다. 초기화·모델 호출 없이 등록·idle 창 재열기에서 같은 등록 파일 해시를 확인했다. 앱/daemon/포트 정리를 마치고 profile·sandbox를 보존했다. [GUI 요약](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/gui-summary.json). G01의 지속 콘솔 부재, G04의 설정 테마/키보드 일부는 실제 관측했지만 순간 콘솔·전체 키보드 수용은 미실행 잔여로 남긴다. G02·G11은 Windows 디스플레이 설정의 지속 로딩으로 환경 차단이다. 배율 변경 0, 테마는 원복했다. lifecycle 승인 누락 경고를 실제 제작 성공으로 간주하지 않는다.

실행 ID `d6-freshpc-20261126-201818-001`, 소스 `main`의 `19741abec12cc7315281e5223604d7ddff5c7957`에서 변경 없이 시작했다. [초기 환경 증거](../evidence/desktop-fresh-pc-validation/d6-freshpc-20261126-201818-001/environment.json)는 읽기 전용 CIM·명령 경로·설치 레지스트리·파일 버전·Test-Path와 Git 상태 조회 결과다. Windows 11 Home build 26200 x64이지만 Node 24.14.0·Git 2.43.0·Codex CLI·.NET SDK 8.0.101과 Codex 인증 파일이 이미 있어 깨끗한 환경 조건은 불충족이다. 인증 유효성/방식은 미확인이다. 조사 시 기본 Orchiva/Paseo 데이터 경로는 없었다. 이전 PC의 미커밋 조사 기록은 사용자 인계 사실로만 보존하며 이번 증거와 혼합하지 않는다.

| 항목 | 판정 | 실제 실행/근거 |
| --- | --- | --- |
| OS/아키텍처 | 통과 | Windows 11 x64 |
| 깨끗한 초기 환경 | 환경 차단 | 개발 도구·기존 인증 파일 존재 |
| N01 | 환경 차단 | 개발 런타임 설치 전 첫 실행 조건 재현 불가 |
| N02 | 환경 차단 | Git/Codex 미설치→설치 전이 재현 불가. 설치 0 |
| N03 | 환경 차단 | 기존 인증 파일 존재. 로그인·로그아웃 0 |
| N04 | 환경 차단 | 새 PC 선행 조건 미충족, 모델 예산 미조율. 모델 실행·명령 재호출 0 |
| N05 | 환경 차단 | 새 PC 수용용 활성 작업·재부팅 미실행 |
| N06 | 환경 차단 | 새 PC 수용용 네트워크 단절/복구 미실행 |
| N07 | 환경 차단 | 새 PC 시험 소유 실행이 없어 해당 정리 검증 미실행. 기존 PC GUI 정리는 별도 |

| 날짜 | 변경 기준점 | 실행한 절차 | 실제 결과와 증거 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 2026-11-17 | `e0248d9` 이후 로컬 D5/D6 변경 | 계획·목록·활성 계획 3개 문서의 정적 검사 | 로컬 링크 96건·템플릿 필수 절 9개·UTF-8·코드 블록·proposed 상태 일치 및 diff 검사 통과. 새 PC 설치·로그인·VM/모델 호출 0 | 사용자 후속 실행 지시와 새 환경 확보 |
| 2026-11-26 | `19741ab`, `d6-freshpc-20261126-201818-001` | 실제 초기 조사·전달본 전체 검사·기존 PC 보조 GUI·idle 재열기·소유 실행부 정리, 문서 정적 검증 | N01~N07 환경 차단. 32,640파일 해시·연결·프로젝트 등록/해시 보존·정리 통과. 배율 환경 차단, G01/G04 잔여 미실행. 변경 Markdown 5개·로컬 링크 135건·필수 절 9개·증거 JSON 3개·UTF-8·코드 블록·diff 검사 통과. 모델/로그인/재부팅/네트워크 변경 0 | 깨끗한 환경에서 새 ID로 재개, G01/G04 잔여와 배율 수용. 로컬 저장, commit/push 안 함 |

## 결정과 후속 작업

최초에는 새 PC 검증을 분리해 대기시켰다. 2026-11-26 후속 지시로 기존 [활성 계획](desktop-transition.md)의 D6 상세 단계로 통합했으나 깨끗한 Windows 11 x64 PC/VM이 여전히 필요하다. 다른 환경에서 재개할 때 새 실행 ID와 격리 프로젝트를 사용한다. MA1~MA6·두 게임 Polish 완료 및 MA3 독립 리뷰 후속 항목은 유지한다. 자동 실행·알림·일정은 만들지 않는다. 조사·배포본 검사·기존 PC GUI 관측을 새 PC 수용 통과로 표시하지 않는다.
