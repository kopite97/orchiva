# G01·G04 GUI 후속 관측

2026-11-26 Asia/Seoul. `f9473f8` 기준, 제품 소스는 `19741ab`와 동일. 배포본 `0.1.0-d6b-preview`, manifest SHA-256 `ff39605a940f03c1f9e5a48d173466db58d055906dc1e8433445cb1ac7aeb39d`. [PLAN](../../../plans/desktop-fresh-pc-validation.md)의 후속 기록이다.

G01은 [사용자 직접 관측](g01-witness.json)으로 이번 시작의 순간 콘솔 부재를 확인했다. G04는 아래 경로의 키보드 도달·포커스 식별·영역 이탈을 확인했다. 어두운 배포본 1280×900/100%가 기본이며 밝은 설정과 모의 화면도 확인했다. 중요한 동작 버튼은 포커스만 확인했고 실제 모델/권한 응답/게시/병합/원본 반영은 실행하지 않았다. 페이지 진입과 포커스 시작점에는 마우스도 사용했으므로 전체 시험을 마우스 없는 end-to-end 실행으로 표현하지 않는다.

| 화면·경로 | 키보드로 확인한 대상 | 대표 화면 |
| --- | --- | --- |
| 탐색·프로젝트 | 주 탐색 방향키/Enter, 프로젝트 목록 Space 선택, 추가 | [탐색](shell-02-arrow-navigation.png), [목록](projects-06-list-recheck.png) |
| 연결·초기화 | 이름/소스, 등록, 미리보기/원문, 목록·설정으로 돌아가기. 비활성 초기화 실행 제외 | [이름](setup-08-name.png), [미리보기](setup-05-preview-button.png) |
| 작업실 | Milestone, 프로젝트 설정, 기획/코딩/아트/사운드/특수효과/상담, 새 요청/수정 | [Milestone](home-11-milestone.png) |
| 프로젝트 설정 | 기준 브랜치, 출력 경로, 이름/소스 확인, 저장 | [경로](configuration-03-output.png), [저장](configuration-01-save.png) |
| 지침 편집 | 파일 목록 Down/End, 경로·범위·내용·저장. 실제 편집/저장 없음 | [내용](instructions-06-content.png), [저장](instructions-07-save.png) |
| 요청·미디어 | 제목/목표/범위/제약, 분야/유형/이전 작업, 출력/모델/수준/검사/지침, 저장/AI PLAN/PLAN 보기. 미디어 6개 규격 입력 및 이탈 | [분야](request-11-domain.png), [미디어](media-08-frames.png) |
| PLAN | 원문, 수정/지침, 다시 읽기, 확인 체크, 실행/상태 | [확인](plan-03-confirm.png), [원문](plan-07-text.png) |
| 이력 | 새로고침/새 요청/목록 Space, PLAN/실행/결과, 기존 이력 expander·ID·가져오기 | [결과](history-06-result.png), [가져오기](history-10-legacy-import.png) |
| 결과 | 품질/검사 확인, 메모, 근거 expander/원문, 승인/수정/재검사/반영 검토 | [메모](result-09-memo.png), [근거 원문](result-07-evidence-text.png) |
| 소스 차이 | 파일 Space 선택/미리보기, 반영/돌아가기. 실제 파일 적용 없음 | [차이](apply-04-preview-text.png), [돌아가기](apply-06-back.png) |
| Milestone·Git | 로드맵/저장/다시 읽기/구간/모델/수준, Git expander의 정책·대상·게시·대조·병합 컨트롤, 실행 목록/선택/생성/재실행/조회/Unity/PLAN/일시중지/취소/재개 | [Git 공개 PLAN](git-19-public-plan.png), [마지막 실행 제어](milestone-24-resume.png) |
| 상담 | 프로젝트·저장 대화·턴, 새 초안 모델/수준/권한/승인 방식, 입력·전송·새로고침, 승인 요청 선택/응답/버튼. 권한/승인 값 변경 없음, 완료 상태의 중단 버튼 건너뜀 | [메시지](conversation-09-message.png), [권한 포커스만](conversation-draft-04-access-focus-only.png), [순환](conversation-15-cycle.png) |
| 앱 설정·연결 | 테마 Enter/Down/Enter, 닫기·진단 버튼, 밝은 포커스 대비, 시스템 테마 복원. 실행부 시작/다시 연결/진단 expander | [밝은 포커스](settings-06-diagnostics.png), [원복](settings-08-restored.png), [시작](connection-06-start.png) |
| 기존 MVP 빈 화면 | 프로젝트 새로고침, 빈 이력의 비활성 다음 페이지 건너뜀 | [빈 이력](legacy-history-01-disabled-skip.png) |
| 실행/복구 **모의** | 상태 새로고침, 권한 expander/조회/선택/원문/처리/확인/전송, 보완 내용/재개/대조/재시도/중단/결과/PLAN 및 순환. 실제 권한 응답 없음 | [복구](mock-execution-12-retry.png), [순환](mock-execution-16-cycle.png) |
| 반영 복원 **모의** | 이력 조회, 보존 작업 선택, 이어서 처리, 식별자, 되돌리기 | [이력](mock-apply-05-history.png), [되돌리기](mock-apply-01-undo.png) |
| Phase 검토 **모의** | 진행 조회 → 메모 → 승인 → 반려 → Feature 선택. 800×600 자동 스크롤, 실행 선택 Escape 닫기 | [승인](mock-phase-03-approve.png), [compact](mock-phase-09-compact-reject.png), [Escape](mock-phase-10-escape.png) |

`keyboard-events.json`은 키·시간과 **도구가 보고한** 포커스의 원자료다. 보고된 포커스가 이전 텍스트에 머무르는 경우가 있어 실제 스크린샷의 테두리·캐럿·선택 표시를 판정 근거로 삼았다. 일부 파일명은 당시 의도이며 화면 내용이 우선한다(`apply-05-confirm`은 체크박스가 아니라 반영 버튼, `history-09-legacy-fetch`는 식별자 입력). 캡처 오류·입력 감지 후 재관측한 기록을 포함한다. 대표 증거 외 각 단계의 PNG/TXT도 보존한다.

모의 실행은 동일 제품 XAML을 링크한 `Orchiva.Desktop.UiTests`이고 배포 exe 자체가 아니다. [기존 모의 21개](mock-phase/mock-results.json)와 [Phase 표시 검사](mock-phase/keyboard-phase.json)를 구분한다. Phase fixture의 최초 준비 실패는 [실패 기록](mock-phase/keyboard-phase-initial-failure.json)에 보존했다. 프로젝트 로드 조건 누락을 `roadmap-open` 호출로 보완했다. 화면 표시가 제품의 Phase 검증·빌드 성공을 증명하지 않는다.

재현: 기존 로컬 SDK로 `dotnet build desktop/Orchiva.Desktop.UiTests/Orchiva.Desktop.UiTests.csproj -p:Platform=x64 -p:RestoreLockedMode=true -o <별도 출력 폴더>` 후, 자식 환경에 `ORCHIVA_DESKTOP_CONFIG=<별도 격리 설정>`, `ORCHIVA_UI_EVIDENCE=<증거 폴더>`, 필요 시 `DOTNET_ROOT=<로컬 SDK>`를 지정한다. `ORCHIVA_D123_UI`/`ORCHIVA_MILESTONE_UI`는 설정하지 않는다. 모의 창의 **Phase 키보드 검증** 버튼은 모델/Bridge 없이 표시 경로를 준비하고, 판정 저장은 거절한다. 실제 GUI 키 입력은 Computer Use로 별도 관측한다.

관측 범위에서 키보드 포커스 함정·도달 불가·포커스 가림은 발견하지 않았다. 대비는 육안이며 비율 측정·스크린리더 수용이 아니다. 모든 데이터 상태×창 크기×100/150/200%×테마 조합을 전수 통과한 것으로 확대하지 않는다. 재부팅·VM·MA3 독립 리뷰는 후속이다. [보존 대조](preserved-run-verify.json), [정리](cleanup.json), [요약](summary.json)을 따른다.

공유용 TXT는 줄 끝 공백만 정리했다. `inventory.json`은 이 PC에서 저장한 파일 바이트의 SHA-256이며 Git의 줄바꿈 변환 후에는 텍스트 파일의 바이트 지문이 달라질 수 있다.
