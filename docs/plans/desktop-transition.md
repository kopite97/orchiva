# D1~D6 데스크톱 전환 계획

- 상태: `active`
- 작성일: 2026-11-16 · Asia/Seoul
- 관련 설계: [전환 설계안](../design/desktop-transition.md), [사용자 합의와 인계](../design/desktop-handoff.md), [기존 MVP](../design/mvp-design.md)
- 선행 조건: M0~M6 `completed`, 현재 소스·개발 환경의 [점검 기록](../decisions/desktop-readiness-20261116.md)
- 최초 작성 근거: 환경 점검·기존 테스트·설계/계획 작성 요청에서는 앱 구현이 제외됐다. 이후의 현재 실행 승인은 아래에 기록한다.

## 현재 실행 승인

2026-11-16 사용자가 “PLAN을 승인할게 작업 시작해줘”라고 지시했다. D1부터 순서대로 구현한다. 이전의 구현 제외 기록은 당시 범위의 이력이며 이번 승인으로 착수 근거가 갱신됐다. 최초 착수 범위는 D1 조회 UI·stdio 연결·격리 수명 검증이었다. D2~D6는 상세화 후 순차 진행하며 D1 완료를 전체 완료로 표시하지 않는다. 실행 결정: .NET 10 + WinUI 3, 공개 SDK를 사용하는 stdio bridge 채택. 창 닫기 설정 기본값은 앱 종료로 두고 D1은 조회 전용이라 작업 중단 동작을 추가하지 않는다. daemon 수명은 UI/bridge와 분리하고 D3 활성 작업 정책은 별도 상세화한다.

2026-11-16 후속 지시: Paseo 콘솔 생성 경로를 수정하고 남은 비GUI 검증을 수행한다. 컴퓨터 유스는 사용하지 않고 GUI 수용 조건을 대기 목록으로 분리한다. 해당 범위의 구현·비GUI 검증을 완료해도 GUI 조건을 통과 처리하지 않는다.

2026-11-16 후속 실행 승인: 사용자가 D3까지 컴퓨터 유스 없이 연속 진행하도록 지시했다. D2a/D2b → D3 구현·자동/격리 실제 연동까지 수행하고 GUI는 대기한다. D2/D3 상세 계약과 파일·검증은 아래 추가 절을 따른다. 착수 전 소스 백업: `C:/Users/USER/AppData/Local/Temp/orchiva-d2-d3-baseline-1794797440557`.

## 현재 단계 상태

2026-11-16 D2a/D2b와 D3 구현·비GUI 검증을 완료했다. 프로젝트 실제 docs/지침, v3 기록·전역 슬롯, AI PLAN, 제작·복구·중단·검토, B안 내보내기/선택 반영/부분 복원/undo를 연결했다. [완료 기록과 검증 구분](../decisions/desktop-d2-d3-completion.md), [증거 요약](../evidence/desktop-transition/d2-d3-20261116/summary.json)을 따른다. GUI G01~G11은 사용자 지시에 따라 대기이며 D4~D6는 미착수다. 전체 PLAN은 `active`다.

## 목표

Windows exe에서 프로젝트와 분야를 고른 뒤 제작의 새 요청/수정 요청 또는 자유 질문을 진행하고, PLAN·실행·산출물·검토 이력을 보존하는 제품으로 전환한다. 기존 Node/Paseo 실행부를 유지하면서 중복 생성·재전송·실패 근거 유실을 방지한다.

**첫 구현 단계 D1의 목표는 조회 가능한 .NET 화면과 연결·종료·재연결 기반**이다. D1만으로 제작 실행이나 다중 프로젝트가 완성됐다고 표시하지 않는다. 현재 **D1 구현·비GUI 검증은 완료했고 GUI 수용 검증은 대기**다. 숨김 runtime host와 공개 daemon run 연결, Node 97/97·C# 12/12, 경로·실패·재시작·정리를 확인했다. [최신 결과와 GUI 대기 G01~G05](../decisions/desktop-d1-runtime-completion.md)를 따른다. 이전 [화면 검증](../decisions/desktop-d1-gui-verification.md)은 보존하며 전체 계획은 `active`다. [구현 결과](../decisions/desktop-d1-foundation.md)와 [실행 안내](../guides/desktop-development.md)를 따른다.

## 현재 근거와 확인할 사항

| 구분 | 근거·내용 |
| --- | --- |
| 기준 소스 | ROOT `C:/Users/USER/lib/orchiva-plugin`, `main`, `b08dc1384698d988c76bdd5d24f91307fae857f4`. clean 상태에서 ff-only 갱신, 원격 차이 0/0, 인계 이후 커밋 없음 |
| 기존 회귀 | 2026-11-16 `npm ci`·typecheck·89개 테스트 통과, lockfile 변경 없음 |
| 로컬 실행 상태 | 요청 JSON 54개·참조 Worktree 경로 49개 존재, daemon stopped. 세션 생존·인증·기존 verify는 미검증 |
| 재사용 | Plugin 단일 writer, 원자적 요청 JSON, 명령키/해시/revision, 단일 슬롯, 독립 관측, 고정 SHA, 실패 복구·불변 결과/판정 |
| 기존 결합 | entry point의 Plugin context, fixed data/home/endpoint, sandbox-only 검사, `defineRpc`, Git 전용 evidence, 수동 조건/검사 폼 |
| 사용자 확정 | 초기 보류 후 WinUI 3 + .NET 10, 첫 단계부터 디자인, B안 선택 적용, 프로젝트별 docs/에서 지침·PLAN·결정/작업 이력 관리로 결정 |
| 추가 사용자 확정 | 제작 PLAN은 정형 입력 → AI가 정해진 템플릿 안에 내용 작성 → 사용자 확인. 닫기 버튼은 설정에서 앱 종료/트레이 최소화 선택 가능하게 설계 |
| D1 실행 결정 | stdio bridge → 공개 SDK Plugin RPC, SDK 10.0.401 + Windows App SDK 2.6.5. 닫기 기본 앱 종료·설정으로 트레이 선택, daemon 독립 수명. 제작 실행 중 정책과 최종 배포는 후속 결정 |

소스별 근거·제약과 아키텍처는 [전환 설계의 대응표](../design/desktop-transition.md#재사용-범위와-변경-지점)에 있다. D1의 정확한 도구·연결 선택은 구현 결과에 기록했다. D2는 프로젝트 docs/를 원본으로 관리하고 D3는 B안의 선택 적용·충돌·복원을 포함한다.

## 범위

후속 승인에 따라 D3까지 구현·격리 실제 연동을 수행했다. D4~D6는 후속 단계이며 아직 구현하지 않았다.

후속 구현에는 프로젝트별 설정과 이력, 분야별 규격 프롬프트·모델/수준, PLAN 확인, 새 요청/수정 요청/질문, 지침 조회·작성·수정·적용, 자동 확인과 결과 검토, 산출물 분리·보존, exe 진입과 프로세스 복원을 포함한다.

병렬 실행·스케줄러·클라우드 동기화·다중 사용자·원격 서비스·무인 자동 수정·자동 Git 게시·Paseo 제거·전체 C# 재작성은 제외한다. 아트·사운드·특수효과는 실제 생성 어댑터를 검증하기 전까지 지원 완료로 표시하지 않는다.

D1의 실제 연동 대상은 **새 실행 ID의 격리 dataHome·daemonHome·loopback 포트와 기존 허용 PoC sandbox의 읽기 전용 확인**이다. Agent/Workspace 생성, 메시지 전송, 원본 프로젝트 편집은 0건을 목표로 한다. 실제 모델 실행과 성공/실패/재개는 D3 이후의 별도 단계에서 수행한다. D1 장애 검증은 시험 소유 UI/bridge 및 격리 daemon에 한정한다. 기존 `.orchiva`, `.paseo-orchiva`와 RNG 등 운영 프로젝트를 시험 재료로 쓰지 않는다.

## 작업 순서와 산출물

아래 표의 D1은 초기 작업 순서이며 실제 생성한 파일과 차이는 구현 결과에 기록한다. D2~D6 경로·명령은 **예정**이다. 한 계획만 `active`로 두며 D1 완료만으로 전체 계획을 `completed`로 바꾸지 않는다. D1 stdio와 Paseo 연결 코드는 별도 stdio.ts/paseo-client.ts 대신 `bridge/index.ts`와 `protocol.ts`로 구성했다.

| 작업 | 변경할 파일 또는 예정 파일 | 수행 내용 | 다음 단계로 넘길 결과 |
| --- | --- | --- | --- |
| D1 연결 기반 | 예정 `desktop/`, `bridge/`, runtime 설정·계약 확장. 아래 상세 | WinUI 개발 환경, 디자인 기준·시안, .NET 조회 화면, stdio bridge, 격리 실행 환경, 수명·복원 진단 | 실제 SDK 조회·UI·종료 근거. 모델 생성 0건 |
| D2 프로젝트·지침·저장 | 예정 `shared/contracts/project.ts`, v3 요청 계약, `server/application/projects.ts`, `instructions.ts`, storage/파일 어댑터, 공통 지침 CLI | 대상 프로젝트 추가 → 소스 경로 지정 → 초기화 실행으로 파일 자동 생성, source/output 분리, 필수 docs/agents·plans·decisions·evidence와 루트 단일 AGENTS·역할별 지침 연결, 전역 슬롯, v3 사본 이관, 실제 지침 조회/편집/누락/해시 고정 | 두 합성 프로젝트의 격리·경합·원본 보존. 지침 외부 변경/경로 이탈 검증 |
| D3 제작 흐름 | draft/plan/start/runtime/evidence/review 확장, desktop 제작 화면, 예정 export 어댑터 | 우선 기획·코딩. 규격 입력→AI의 템플릿 내 PLAN 작성→사용자 확인→실행→자동 확인→간단 검토. 수정 요청과 동일 세션 복구 분리. B안의 변경 비교·선택 적용·백업·충돌·부분 실패 복원 | 새 sandbox 요청의 성공·의도적 실패·동일 세션 복구·새 수정 PLAN·결과 내보내기·이력 불변 |
| D4 질문/상담 | 예정 conversation 계약·application·runtime·화면 | 자유 입력 1개, 대화/턴 명령·이력, 같은 대화의 후속 메시지, 읽기/도구 제한. 대화에서 PLAN 자동 작성·완성·제작 전환 기능은 제외 | 경로/검사 입력 없는 대화, 중복 전송·응답 유실·재시작 검증 |
| D5 제작 분야 확장 | 예정 분야별 profile·생성/검증/미리보기 어댑터 | 아트·사운드·특수효과 도구 연결, 큰 파일/ignored 산출물, 모델 capability·형식 규격 검사 | 각 분야 실제 산출물과 미지원/도구 부재/예산 초과 구분. 텍스트 대체물을 완료로 오인하지 않음 |
| D6 배포·통합 수용 | 예정 publish/설치 설정·진단 도구, guides·decisions/evidence | 배포 형식·동봉·인증·업데이트 결정, 새 PC 설치, 종료·복원, 전 단계 회귀 | exe 진입 전체 흐름, 파일/세션/명령 수·보존 해시, 새 PC 실측과 사용자 확인 |

단계는 위 순서로 진행한다. D2 이후에는 변경 파일·스키마·검증 예산을 확정한 상세 절을 추가하고 착수한다. D5의 생성 도구 계약과 D6 배포 형태는 현재 미정이므로 존재하지 않는 실행 명령을 제시하지 않는다.

### 계획 재검토: 보완과 결정 시점

2026-11-16 사용자 요청에 따라 재검토했다. 아래 추천은 사용자 확정이나 구현 권한을 뜻하지 않는다. 대상 프로젝트의 제품 정책만 다루며 Orchiva 개발 지침은 변경하지 않는다.

| 보완 항목 | 보완할 계약과 검증 | 적용 시점 |
| --- | --- | --- |
| 첫 사용 가능한 단계 | D1은 조회 기반, D2a는 프로젝트 추가·초기화·지침 편집, D2b는 프로젝트별 실행 이력·v3 이관·전역 슬롯으로 나눠 완료를 추적한다. D2a 완료 시 아직 제작 실행은 불가하며 첫 제작은 D3 완료 시 제공한다. D2a는 설정·지침 저장의 최소 계약을 먼저 정의하고 D2b와 충돌하지 않게 한다 | 단계 세분화; D1~D6 순서·범위는 유지 |
| 초기화 템플릿과 갱신 | 생성할 공통 지침의 정확한 파일명·내용·템플릿 버전, 기존 루트 지도 병합과 하위 AGENTS 이관 범위를 D2a 전에 고정한다. 기본 템플릿 갱신이 사용자 편집을 덮지 않게 하고 기존·기본·새 기본의 차이를 제시한다. 버전 미기록/부분 초기화도 재발견해야 한다 | D2a 상세 설계 |
| 문서와 구조화 데이터의 권위 | PLAN Markdown이 사용자 문서 원본이며 JSON은 명령·실행 복원의 구조화 근거다. 필드별 소유권과 외부 편집 허용 범위를 표로 정한다. 제목 변경·파일 이동·중복 ID·JSON 누락/손상·확정 PLAN 외부 편집 시 이력을 잃지 않는 검증을 추가한다 | D2b 계약 확정 전 |
| 프로젝트 수명 | 폴더 이동/재등록·같은 프로젝트의 다른 경로·복제된 projectId·연결 해제·이동식 경로 미접속을 구분한다. 연결 해제는 실제 파일 삭제와 분리하고 활성/미확정 작업이 있는 프로젝트를 조용히 목록에서 제거하지 않는다 | D2b |
| 실행과 중단 | 창 닫기·연결 끊김·사용자 중단 요청·실제 중단 확인·실패·완료를 구분하는 상태표를 추가한다. 중단 응답 유실 때 성공을 추정하거나 슬롯을 조기 해제하지 않고 부분 결과·근거를 보존한다. 실제 지원 가능한 중단/재개 동작은 SDK 검증 후 정한다 | D3 전에 상세화 |
| PLAN 생성과 자동 검사 | 현재 buildPlan은 입력 기반 템플릿이다. 확정한 정형 입력 → AI의 템플릿 내 내용 작성 방식에 따라 준비 단계 모델 호출·명령키·비용/제한·도구 권한·실패 복구를 별도로 정의한다. 제안된 검사 명령은 등록된 검증 profile과 대조하며 임의 명령을 자동 실행하지 않는다 | 제품 방식 확정, D3 전에 호출·검증 계약 상세화 |
| 초기화한 지침과 실행 입력 | 신규 지침은 미추적 파일일 수 있다. docs 초기화 때문에 미커밋 파일이 생겨도 자동 commit하지 않으며, 승인한 지침 snapshot이 Worktree에 적용되는지 검증한다. 일반 소스의 미커밋·ignored·큰 파일 입력 정책은 별도로 정한다 | D2b~D3 |
| 저장 공간과 보존 | 결과물·snapshot·백업·evidence의 예상 크기와 디스크 부족을 진단한다. 결과 누락은 삭제된 파일로 명시하고 과거 성공 기록을 변경하지 않는다. 정리 범위·보관 기간은 별도 선택 전까지 자동 삭제하지 않는 안을 추천한다 | D3, 큰 미디어는 D5 |
| 배포 전제의 조기 확인 | 지원 OS/CPU·개발용 packaging·프로세스 시작·쓰기 위치를 D1에서 검증한다. 최종 설치 프로그램·서명·업데이트 결정은 D6에 남기되 모든 배포 위험을 D6까지 미루지 않는다. packaged/unpackaged와 runtime 배포 선택은 별개다: [Microsoft 배포 안내](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/deploy-overview) | D1 기술 결정, D6 최종 배포 |

후속 사용자 답변을 반영한 상태는 다음과 같다. 확정한 제품 방향과 남은 기술 세부 사항을 구분한다.

| 시점·상태 | 제품 동작 | 확정 내용과 남은 사항 |
| --- | --- | --- |
| 방식 확정, D1 수명 설계 | 닫기 버튼 설정 | 앱 종료 또는 트레이 최소화를 사용자가 설정에서 선택. 기본값과 앱 종료 시 진행 작업 처리 정책은 별도 미정. 트레이 복원·명시적 종료·설정 유지와 중복 프로세스 방지를 검증 |
| 사용자 보류 | Git 없는 일반 폴더 제작 | 필요성을 추후 판단. 현재 Git 기반 실행 설계를 유지하며 일반 폴더 제작용 snapshot 실행부는 범위에 추가하지 않음. 초기화와 제작 가능 여부는 별도 표시 |
| 사용자 확정, D3 | 정형 입력 → AI가 템플릿 안에서 내용 작성 | 기존 정형 입력과 PLAN 형식을 유지하며 AI가 내용을 분석해 구체적인 계획을 작성. 사용자 확인 후 제작 실행. 현재 코드의 단순 문자열 조립에 AI 작성 단계는 아직 없으므로 모델 호출·실패/비용·revision 검증을 추가 |
| 향후 아이디어, 구현 제외 | 질문/상담에서 PLAN 자동 작성·완성 | 자유 대화를 바탕으로 PLAN을 만들 수 있는 기능은 추후 검토. 현재 D4에는 대화와 턴 이력만 포함하며 자동 PLAN 완성·제작 전환 버튼·완료 조건은 추가하지 않음. 내부 PLAN과 대화의 매핑은 미정 |

정확한 SDK 패치·Windows App SDK·통신 framing·초기 템플릿 파일명 등은 검증으로 결정할 기술 사항이다. 사용자에게 버전 번호를 고르게 하기보다 D1/D2에서 호환성·재현성 근거를 기록한다. D1에서는 stdio/공개 SDK 연결을 채택했으며 근거와 현재 계약은 구현 결과에 기록했다. 시각 디자인은 D1 초기에 프로젝트 목록·초기화·요청/PLAN·진행/결과 화면 시안으로 구체화하고 테마·여백·상태 표현을 함께 검토한다.

제작 PLAN의 AI 템플릿 작성 방식은 확정했다. 확인 전에는 제작 실행용 Agent/Worktree와 원본 소스 변경이 없어야 하며, 별도 계획 작성 모델 호출은 허용된 입력·지침 snapshot만 사용한다. 계획 작성용 세션·도구 제한·명령키와 실패 복구 계약은 D3에서 확정한다. 생성 중 입력 변경·응답 유실·중복 클릭·템플릿 필수 절 누락·임의 검사 명령을 검증하고, 생성 결과가 유효한 revision으로 저장·확인되기 전 제작을 시작하지 않는다. D1은 계속 모델 호출 0건이며, 현재 단순 템플릿 조립 코드에 AI 내용 작성이 구현됐다고 표현하지 않는다.

### 와이어프레임 참고 이미지

사용자가 2026-11-16 대화에서 확인한 14개 화면 시안을 저장했다. 구현 시 [화면 설계](../design/desktop-ui.md)와 함께 아래 이미지를 참고한다. 밝은 테마·1280 CSS px 폭의 화면을 2배 해상도 PNG로 캡처했으며, 실제 앱 구현 화면이나 실행 성공 증거가 아니다. 최종 색상·세부 동작·미정 정책은 별도 설계를 따른다.

저장 위치: `docs/evidence/desktop-transition/20261116-wireframe-capture-001/`. 저장소 상대 경로로 연결하므로 다른 PC에서도 같은 경로를 사용할 수 있다.

| 화면 | 참고 이미지 |
| --- | --- |
| 01 · 프로젝트 목록 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/01-projects.png) |
| 02 · 프로젝트 추가 / 초기화 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/02-setup.png) |
| 03 · 프로젝트 / 작업 분야 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/03-home.png) |
| 04 · 새 요청 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/04-new.png) |
| 05 · 수정 요청 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/05-modify.png) |
| 06 · PLAN 확인 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/06-plan.png) |
| 07 · 실행 / 복구 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/07-run.png) |
| 08 · 결과 검토 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/08-result.png) |
| 09 · 소스 반영 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/09-apply.png) |
| 10 · PLAN 이력 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/10-history.png) |
| 11 · 지침 관리 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/11-instructions.png) |
| 12 · 질문 / 상담 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/12-chat.png) |
| 13 · 설정 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/13-settings.png) |
| 14 · 연결 / 환경 | [PNG 보기](../evidence/desktop-transition/20261116-wireframe-capture-001/14-connection.png) |

파일별 크기·해시와 캡처 조건은 [저장 기록](../evidence/desktop-transition/20261116-wireframe-capture-001/summary.json)을 따른다. 이 캡처는 페이지별 기본 상태이며 실행 실패·외부 변경 등의 대체 상태는 화면 설계와 기존 시안 검증 기록을 함께 참고한다.

### 첫 구현 단계 D1

사용자에게 보일 결과는 **연결 상태·환경 문제·프로젝트 정보·작업 요약/상세를 조회하는 Windows 창**이다. 실행 버튼·검토 저장·지침 편집·대화 전송은 D1 capability에 포함하지 않는다. 일반 화면에는 내부 protocol/SDK 용어를 요구하지 않고 상세 진단에서만 노출한다.

| 순서 | 파일·변경점 | 상세 작업·완료 산출물 |
| --- | --- | --- |
| 1 | 이 계획, 예정 `global.json`, `desktop/Orchiva.Desktop.slnx`, `.gitignore` | 확정한 WinUI 3 + .NET 10의 workload·Windows SDK·Windows App SDK 호환 조합과 정확한 SDK 패치 고정. desktop/bridge 빌드 산출물 제외. 기존 lockfile 기반 유지, 필요한 패키지 변경은 manifest/lock 함께 관리 |
| 1a | [화면 와이어프레임](../design/desktop-ui.md), 예정 `desktop/Orchiva.Desktop/Themes/` | 2026-11-16 검토용 페이지별 와이어프레임 작성. D1에서 화면 배치·색상·타이포그래피·간격·아이콘·상태 표현을 확정하고 디자인 기준을 구체화. 밝은/어두운 테마·키보드·대비·DPI를 공통 리소스에 반영 |
| 2 | 예정 `shared/contracts/desktop-protocol.ts`, `desktop/Orchiva.Bridge/` | 버전 envelope·요청 ID·method allowlist·구조화 오류·크기/timeout·handshake 계약. C# DTO와 Node schema의 공용 wire fixture. 인증값/원문 로그 금지 |
| 3 | 예정 `server/config/runtime-settings.ts`; 기존 `project-config.ts`, `connection.ts`, `service.ts`, `index.server.ts` | dataHome·paseoHome·endpoint를 구성 시 주입. 기존 기본 동작 유지. 테스트 모드에서 production home으로 fallback 금지. sandbox 경로/remote 검사는 그대로 유지 |
| 4 | 기존 계약·entry point, 예정 `runtime.info` RPC | 서버 버전·capability·실제 data/home 식별·복원/소유 상태를 진단. 비밀값 없음. 클라이언트가 다른 home/서버에 연결된 상황을 판별 |
| 5 | 예정 `bridge/index.ts`, `bridge/stdio.ts`, `bridge/paseo-client.ts` | `createHostClient`/`invokePluginRpc` 사용, 단일 SDK 연결 소유. 조회 allowlist: `project.read`, `request.page`, `request.detail`, `runtime.status`, `storage.diagnostics`, 예정 `runtime.info`. stdout 전용 framing, stderr 비동기 drain, bounded reconnect/dispose |
| 6 | 예정 `desktop/Orchiva.Desktop/`, `desktop/Orchiva.Bridge/RuntimeLauncher.cs` | WinUI 3의 MVVM 조회 화면과 공통 디자인 리소스. 실행 파일/인수 배열·숨김 실행, source/install 경로의 공백·한글 처리. 사용자 전역 환경·정책 무변경. 명시한 시험 home만 시작, 다른 프로세스 재사용/종료 금지 |
| 7 | 같은 desktop/bridge 모듈 | 시작→handshake→서버 복원→조회 순서. 연결 오류 때 마지막 목록 유지. 앱 종료 시 pending 조회 정리, daemon 수명과 분리. 닫기 설정(앱 종료/트레이 최소화)·트레이 복원·명시적 종료 처리와 설정 저장. 앱 재열기에서 같은 기록 재조회 |
| 8 | 예정 `scripts/desktop-foundation.mjs`, bridge tests, `.NET Tests` | 새 실행 ID별 격리 v2 fixture·설정·daemon·포트·PID manifest. 합성 완료/초안·빈 목록/오류만 사용. 실제 SDK와 모의 전송 장애 구분 |
| 9 | docs/decisions·evidence·guides, 이 계획/목록 | 명령/버전/결과·모델 효과 0·정리 증거 기록. D1 완료 체크와 남은 D2~D6를 구분 |

step 3에서 일반 프로젝트 실행 허용을 추가하지 않는다. 포트/home 주입은 시험·수명 분리를 위한 것이며 현재 sandbox 제한 완화와 별도다. 기존 v2의 필드나 판정 정책도 D1에서 바꾸지 않는다.

실제 연동 fixture는 새 dataHome에 **합성된 유효 v2 초안·완료 기록**만 만든다. 기존 기록을 원본 상태로 복사해 활성 작업이 재개되는 시험은 하지 않는다. app/daemon/Plugin/bridge의 실제 경로·PID·시작 식별·포트와 기존 데이터 접근 여부를 manifest에 기록한다. 기존 포트 6767을 차지하거나 기존 Plugin을 reload하지 않는다.

## 검증 계획

아래는 D1의 수용 기준이다. 초기 결과는 [구현 검증](../decisions/desktop-d1-foundation.md#검증-결과), 실행 차단 해소 후 결과는 [화면 검증](../decisions/desktop-d1-gui-verification.md), 최신 비GUI 완료와 사용자 요청에 따른 GUI 대기는 [실행부 보완 결과](../decisions/desktop-d1-runtime-completion.md)에 기록한다. 기준표 자체를 통과 결과로 읽지 않는다.

| ID | 종류 | 조건과 절차 또는 명령 | 기대 결과 | 보존할 증거 |
| --- | --- | --- | --- | --- |
| V01 | 정적 | 기존 `npm run typecheck`, `npm test`; 새 bridge 타입/테스트 포함 방법 확정 | 기존 89개 회귀 유지, 추가 의미 있는 연결 경계 통과 | 버전·테스트 수·실패/미실행 목록 |
| V02 | 정적·자동 | `npm run desktop:build`, `npm run desktop:test` | 선택 SDK/UI 조합 빌드와 연결 라이브러리 테스트 통과 | SDK/NuGet lock·build/test 요약 |
| V03 | 모의·실제 로컬 IPC | 부분/합쳐진 JSON frame, 한글·줄바꿈, out-of-order 응답, 중복 통신 ID, 잘못된 major/schema·1 MiB 초과 | 정확한 응답 대응·구조화 거부, stdout 오염·메모리 무제한 누적 없음 | 비밀값 없는 wire fixture·실패 코드 |
| V04 | 모의 | 허용하지 않은 start/resume/review/refresh 메서드, 악성 경로·미등록 endpoint | SDK 호출 전에 거부, 저장·외부 효과 0 | RPC spy 카운트·거부 결과 |
| V05 | 실제 연동 | 새 시험 home/port의 daemon + Plugin + bridge에서 조회 | 유효 handshake, home/서버 정체성 일치, Agent/Workspace/메시지 생성 0, 요청 fixture bytes 불변 | 전후 inventory·hash·PID/port manifest |
| V06 | 실제 프로세스 | 같은 dataHome의 두 Plugin owner, 기존 실행부와 다른 home 오접속 | 두 번째 writer 거부, 잘못된 환경 진단, 기존 프로세스 종료 없음 | owner 오류·PID·원본 해시 |
| V07 | 모의·실제 IPC | daemon 없음, 잘못된 local credential 파일, 연결 timeout, 로그 stdout 오염 | 입력/마지막 목록 보존, 비밀값 로그 0, 명확한 재연결 상태 | redacted 오류·UI 관측 |
| V08 | 실제 프로세스 | 소유 bridge만 종료/재시작, 닫기 설정별 앱 종료/트레이 최소화·복원·설정 유지, 명시적 종료/재열기, 반복 dispose | child/SDK/timer 정리, daemon 수명 유지, 같은 요청 ID·결과 재조회 | 3회 연속 수명 관측·잔여 프로세스/포트·닫기 설정별 종료/트레이 복원 |
| V09 | 실제 연동 | 활성 모델 없는 격리 daemon 정상 재시작 후 연결 | restoring 동안 실행 capability 없음, 같은 기록·결과·판정 유지 | 전후 해시·연결/복원 시간 |
| V10 | GUI | 빈 목록/합성 목록·상세/오류/오래된 상태, 키보드·스크롤 | 1280×900과 800×600에서 주요 행동 가능, 100%/150% DPI·밝은/어두운 테마·대비·포커스·긴 한국어 확인, 디자인 기준과 실제 화면 대조, 오류에 입력 소실 없음 | 화면·환경·관측 기록 |
| V11 | 실제 경로·모의 | 한글/공백 설치·data 경로, 잘못된 child 실행 파일, production home fallback 시도 | shell 조합 없이 실행 또는 구체적 오류, 허용 루트 밖 변경 0 | 경로 사례·원본 파일 해시 |
| V12 | 정적·실제 정리 | 시험 소유 PID/port·UI/bridge 종료, 증거 남긴 뒤 소유 임시 리소스만 정리 | 기존 daemon stopped 유지, 원본 데이터·sandbox 불변, 시험 child/port 잔여 없음 | cleanup manifest·Git diff |

현재 .NET 프로젝트와 `desktop:build`, `desktop:test`, `desktop:verify`를 등록했다. 실행 조건은 개발 안내를 따른다. D1의 live 조회는 모델 인증·실제 제작 성공을 증명하지 않는다.

후속 단계의 필수 검증은 다음과 같다. 세부 ID·실행 예산은 각 단계 착수 전에 위 검증 표를 확장한다.

| 단계 | 추가 필수 경계 |
| --- | --- |
| D2 | 소스 경로 지정만으로 쓰기 0·초기화 실행 시 루트 AGENTS와 필수 docs 파일 생성·재초기화 중복/덮어쓰기 0·중단/권한 오류 복구·Agent/Worktree/모델 호출 0, 기존 docs/문서 무덮어쓰기·누락 골격 생성·하위 AGENTS 이관/충돌·루트 단일 AGENTS 연결·플랜별 evidence 경로/재검증 보존, 외부 편집 감지·프로젝트 재등록 시 문서/이력 재발견, 프로젝트 A/B 요청 격리·동시 시작 단 1개, 손상/미지원 전역 차단, v2 사본/원본 hash 보존·중단 복구, 지침 누락/외부 변경/심볼릭 링크/하위 적용/PLAN 무효화 |
| D3 | 정형 입력·템플릿·지침 기반 AI PLAN 내용 작성, 생성 중 입력 변경·중복 호출·응답 유실·필수 절 누락·계획 단계 구현/원본 쓰기 0, 변경된 입력/지침/SHA로 실행 거부, 두 번 클릭·응답 유실 생성 수 1, 같은 세션 실패 복구·원래 검사 불변, 새 수정 PLAN의 부모 연결, 검증 오류·미실행 구분, stale 결과 승인 거부, 내보내기 중단/재호출/충돌·무요청 README 0, 미커밋 원본 입력·적용 직전 외부 변경·선택 추가/수정/삭제·중복 적용·부분 실패 복원·되돌리기 후속 편집 보호 |
| D4 | 자유 입력만으로 여러 턴, 같은 Agent·턴별 명령, 미확정 전송 재송신 차단, 질문의 파일 쓰기/제작 실행 거부, 대화·턴 근거 복원, PLAN 자동 작성/완성·제작 전환 기능 없음 |
| D5 | 실제 이미지·음원·효과 파일과 규격·미리보기, 큰 파일/검증 예산, unsupported 명확 표시, 실패 결과 보존 |
| D6 | 빈 새 PC 설치·로그인·exe 시작, 창 닫기 중 진행과 재접속, 소유 worker 장애·저장 경계·중복 방지, 앱 업데이트/복구·데이터 호환, 성공/실패/복구 사용자 확인 |

## 실패 처리와 복원

- 준비·버전·home 검증 실패는 실행을 막고 원인과 해결 방법을 보여준다. 기존 인증·전역 환경·sandbox/승인 정책을 우회하지 않는다.
- 조회 timeout·SDK 연결 실패는 관측 실패다. 요청 상태·완료·실패를 추정해서 바꾸지 않는다. bridge는 범위 있는 재연결만 수행하고 신규 실행키를 만들지 않는다.
- 현재 Plugin의 store owner·불변 이력·unknown 정책을 훼손하는 회귀가 있으면 다음 단계로 넘어가지 않는다. 원래 소스·격리 시험 기록·실패 로그를 보존한다.
- D1에서 기존 요청 파일 수정, 예상 밖 Agent/Workspace/메시지 생성, 다른 home 연결이 발견되면 시험을 중단한다. 자기 소유 신규 프로세스만 정상 정리하고 원인을 기록한다. 생성된 리소스·실패 증거를 지워 성공한 것처럼 재시험하지 않는다.
- 강제 종료는 manifest로 확인한 시험 소유 bridge 등으로 제한한다. PID 단독 일치나 나이만으로 다른 프로세스를 죽이거나 store 잠금을 강제 해제하지 않는다.
- cleanup은 실제 절대 경로가 해당 실행의 임시 루트 안인지 확인한다. 이전 PoC 요청·PLAN·검사·Worktree·실패 로그를 임시물로 취급하지 않는다.
- D2 이후 마이그레이션·지침 편집·내보내기의 부분 완료는 intent·snapshot·해시로 복원한다. 원본을 역변환하거나 이전 결과를 덮어쓰지 않는다. 새 버전 데이터를 이전 앱이 읽게 하는 rollback은 자동으로 하지 않는다.

## 완료 조건

### D1의 완료 조건

2026-11-16 사용자 요청으로 구현·비GUI 검증은 마무리하고 컴퓨터 유스 검증은 별도 대기한다. 아래 미체크 GUI 조건은 [G01~G05](../decisions/desktop-d1-runtime-completion.md#gui-대기-목록)로 유지한다. D1 전체 수용 완료와 구분한다.

- [x] 확정한 WinUI 3 + .NET 10의 SDK·통신·수명 정책과 개발 조합을 기록한다.
- [ ] 첫 조회 화면부터 디자인 시안·공통 리소스·상태별 화면과 테마/접근성 검증을 완료한다.
- [x] .NET 조회 화면과 Node bridge가 선택한 계약으로 실제 격리 Plugin에 연결된다.
- [ ] 빈 상태·목록·상세·오류·복원 상태가 GUI에서 구분되고 읽기 전용 capability가 강제된다.
- [x] V01~V12의 비GUI 검증 통과. 실제 연동·모의를 구분해 기록했다. GUI 부분은 사용자 지시로 G01~G05 대기이며 통과로 간주하지 않는다.
- [x] Agent/Workspace/메시지 생성 0, 기존 요청·실행 데이터와 sandbox 무변경을 확인한다.
- [x] bridge 3회 수명·재연결·격리 daemon 재시작에서 기록·소유권·프로세스 정리가 검증된다. 이전 실제 앱 종료·재열기 1회는 보존하며 전체 앱 3회와 트레이 명시 종료는 G05로 대기한다.
- [x] 결과 문서·환경 안내·계획/목록을 갱신하고 D2~D6가 미완료임을 표시한다.

### 전체 전환의 완료 조건

- [ ] D1~D6의 범위와 필수 검증을 충족한다.
- [ ] 프로젝트 선택부터 제작 PLAN·실행·검토, 새 수정 요청, 자유 질문과 실제 지침 편집을 사용할 수 있다.
- [ ] 사용자에게 완료 조건/Node/문자열 검사 작성을 요구하지 않으면서 자동 근거·사람 판단·미실행을 구분한다.
- [ ] 프로젝트 docs/가 지침·PLAN·결정/작업 이력의 원본이며 산출물은 분리 보관된다. B안의 선택 적용·충돌 처리·백업·복원을 검증한다. 결과물 폴더에는 요청하지 않은 지침서·README를 자동 생성하지 않는다.
- [ ] 중복 실행 방지·실패 복구·결과/판정 이력이 새 통신·프로세스·저장 구조에서도 유지된다.
- [ ] 새 PC exe 설치·인증·시작·종료·복원을 실제 확인하고 배포 형식과 도구 버전을 기록한다.
- [ ] 실패·미실행 항목을 해소하거나 근거 있는 범위 변경을 사용자와 기록한다. 문서 작성만으로 구현 완료 처리하지 않는다.

## 실행 및 검증 기록

| 날짜 | 변경 기준점 | 실행한 절차 | 실제 결과와 증거 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 2026-11-16 | `b08dc13`, main | Git 상태·remote·ff-only·도구·로컬 데이터 읽기 점검 | 원격 0/0, 후속 커밋 없음. [점검 기록](../decisions/desktop-readiness-20261116.md) | 실제 provider 인증·연동 준비는 별도 |
| 2026-11-16 | 같은 기준, 소스 변경 없음 | `npm ci --no-audit --no-fund`, `npm run typecheck`, `npm test`, lockfile diff | 설치·타입 통과, 89/89, lockfile 불변. 자세한 조건·경고는 점검 기록 | 신규 .NET/bridge 검증은 미실행 |
| 2026-11-16 | 문서 작성 단계 | 코드·M0~M6 대조, 공식 .NET/Windows 문서 확인, 사용자 선택 질문 | UI와 소스 반영 모두 보류 답변 반영. [설계](../design/desktop-transition.md) 작성 | 구현 전/단계별 결정 |
| 2026-11-16 | 문서 변경분 5개 | 상대 링크·템플릿·상태·예정 경로/명령·인코딩·diff 정적 검사 | 로컬 링크 95건·앵커 5건, 템플릿 필수 절 9개, 기존 npm script 11개 확인. UTF-8·코드 블록·proposed 상태·diff 검사 통과. 신규 desktop/bridge/global.json 없음 | 문서 작성 완료, D1~D6 구현 미착수 |
| 2026-11-16 | 후속 사용자 선택 | WinUI·디자인·B안·프로젝트 docs/ 정책 반영 | 초기 보류 기록 보존. 변경 문서 5개·로컬 링크 95건·앵커 5건·템플릿·proposed 상태·UTF-8·코드 블록·diff 검사 통과. 소스 테스트 재실행 비적용 | 구현은 계속 미착수 |
| 2026-11-16 | 문서 관리 규칙 변경 | 하위 AGENTS 이름 변경, decisions/evidence 규칙, 플랜별 검증 추적 | [문서 검증 근거](../evidence/desktop-transition/20261116-doc-policy-001/summary.json). 앱 구현·런타임 시험과 구분 | 이후 적용 대상 정정으로 개발 지침 변경 복원 |
| 2026-11-16 | 지침 지도 통합 | docs.md 제거, 공통 문서 규칙 통합, 관련 링크 정리 | [문서 검증 근거](../evidence/desktop-transition/20261116-doc-policy-002/summary.json). 당시 루트 AGENTS만 지도로 변경했으나 이후 대상 범위 오해를 확인 | 개발 지침 변경 복원, 제품 정책만 유지 |
| 2026-11-16 | 적용 범위 정정 | 앱 대상 프로젝트 초기화 계약 명시, 개발 저장소 지침·템플릿 원복 | [정정 검증](../evidence/desktop-transition/20261116-project-initialization-001/summary.json). 앞선 두 문서 검증은 당시 상태 기록이며 현재 개발 지침 정책이 아님 | 전체 계획 proposed 유지, D2 구현 예정 |
| 2026-11-16 | 계획 재검토 | 현재 buildPlan·M2 기록과 계획/설계 대조, 초기화 이후 경계·결정 시점 추가 | [재검토 검증](../evidence/desktop-transition/20261116-plan-review-001/summary.json). 추천과 사용자 확정 구분 | 제품 선택 4항목, 기술 조합은 착수 시 검증. proposed 유지 |
| 2026-11-16 | 사용자 후속 결정 | 제작 PLAN의 AI 템플릿 내용 작성, 닫기 설정 선택 확정. 일반 폴더 제작 보류, 상담 PLAN 자동 완성 제외 | [문서 검증](../evidence/desktop-transition/20261116-product-decisions-001/summary.json). 설계·인계·목록 정합성 갱신 | proposed 유지, 앱 구현 미착수 |
| 2026-11-16 | 사용자 와이어프레임 요청 | 14개 화면 시안과 화면 설계 문서 작성, 브라우저 배치/상호작용 확인 | [시안 검증 근거](../evidence/desktop-transition/20261116-wireframe-001/summary.json). 실제 WinUI·모델·프로젝트 파일 실행 없음 | 디자인 검토 전, D1 구현 미착수·proposed 유지 |
| 2026-11-16 | 와이어프레임 이미지 보관 요청 | 14개 페이지 기본 상태 PNG 저장, PLAN에 상대 경로 등록 | [캡처 기록](../evidence/desktop-transition/20261116-wireframe-capture-001/summary.json). 예시 화면 전체 영역 캡처·PNG 크기/해시 확인 | 디자인 참고 자료, 구현 미착수·proposed 유지 |
| 2026-11-16 | `b08dc13`, `codex/desktop-d1-foundation` 작업 변경 | 사용자 PLAN 승인 → D1 구현, 격리 run 001/002·SDK 조회·bridge 3회 종료/재연결·daemon 정상 재시작 | typecheck·Node 94/94, WinUI 및 C# 테스트 프로젝트 build 통과. [D1 결과](../decisions/desktop-d1-foundation.md), [증거](../evidence/desktop-transition/d1-20261116-002/summary.json) | .NET test/GUI는 Windows 앱 제어 차단. V03/V07/V08/V10/V11 일부 실행 검증 미완료. D1 active 유지, D2~D6 미착수 |
| 2026-11-16 | 같은 브랜치, D1 C# 오류 처리 수정 | 사용자 실행 차단 해소 → run 003 .NET/GUI 검증. Escape 중단 후 사용자 재개 지시로 마무리 | 초기 C# 4/7 → 연결 실패/취소 경합 수정 후 7/7, WinUI build 통과. 프로젝트·PLAN·테마·트레이 복원·오프라인 보존·재연결·종료/재실행, 원래 54건 보존과 정리 확인. [화면 검증](../decisions/desktop-d1-gui-verification.md), [증거](../evidence/desktop-transition/d1-20261116-003/summary.json) | Paseo 콘솔 창 노출, 정확한 DPI/크기·빈 저장소/복원 GUI·남은 V07/V08/V11. D1 active 유지 |
| 2026-11-16 | 같은 브랜치, runtime launcher·하네스·경계 테스트 | 사용자 지시: 콘솔 생성 경로 수정·비GUI 마무리, 컴퓨터 유스 대기. run 004 한글/공백·run 005 빈 저장소 | Node 97/97, C# 12/12, typecheck·WinUI build 통과. 숨김 지속 호스트, 시작 실패/취소, 반복 연결, 재시작·원본 54건 보존·정리 확인. [최신 결과](../decisions/desktop-d1-runtime-completion.md), [증거](../evidence/desktop-transition/d1-20261116-004/summary.json) | D1 구현·비GUI 완료, G01~G05 GUI 수용 대기. D2~D6 미착수 |

## 결정과 후속 작업

1. 기존 실행부의 상태·저장 소유권을 유지하는 stdio/SDK 연결을 구현했다. C#은 기존 JSON에 직접 쓰지 않는다.
2. WinUI 3 + .NET 10, 첫 단계부터 디자인, B안, 프로젝트별 docs/ 관리는 사용자 선택이다. D1 SDK/통신은 구현 결과에 고정했고 최종 배포는 D6 결정이다.
3. D1 구현·비GUI 검증을 완료했다. 콘솔 생성 경로는 숨김 지속 호스트 + 공개 daemon run으로 수정했다. 컴퓨터 유스는 사용자 지시로 대기하며 재개 시 G01~G05만 확인한다. 실제 화면의 콘솔 부재를 아직 검증했다고 주장하지 않는다. 모델 생성은 D3의 실행 검증으로 넘긴다.
4. D2에서는 v3·지침 적용·전역 슬롯, D3에서는 자동 검토 계약·산출물 내보내기·소스 반영 범위를 상세화한다. 기존 v2 판정을 형식적인 메모로 우회하지 않는다.
5. 이 검증 당시 변경은 소스·문서의 로컬 저장이며 commit·push 전이었다. 이후 2026-11-16 사용자가 지금까지 작업의 main 반영·push를 지시했다. 최종 반영은 Git 이력과 origin/main을 따른다. 계획은 사용자 구현 승인에 따라 `active`이며 남은 수용 항목을 완료로 표시하지 않는다.

## D2·D3 상세 실행 범위

- D2: 프로젝트의 실제 소스 경로 등록은 읽기만 수행한다. 초기화 미리보기의 파일 해시를 확인한 명시적 명령으로 루트 지도와 필수 docs를 만들고 기존 내용·하위 지침의 적용 범위를 보존한다. 로컬 registry에는 경로 연결만 보관한다.
- 저장: schemaVersion 3 요청은 제작 메타데이터·PLAN 문서 hash·명령 journal과 검증된 v2 실행 engine 상태를 한 envelope에 보관한다. 실행 engine의 결과·판정·명령 불변 규칙을 재사용한다. 소유권은 실경로별 단일 Node writer, 실행 슬롯은 모든 등록 프로젝트와 기존 v2의 활성/손상/unknown을 확인한다.
- D3: 기획·코딩의 정형 입력과 실제 provider 모델/수준 목록, 제한된 PLAN 작성 호출, 고정 지침·입력 snapshot과 외부 변경 감지, PLAN 확인 후 기존 Worktree/Agent 실행·복구를 연결한다. 일반 소스 미커밋 변경은 입력 snapshot으로 보존하고 지원 범위를 벗어나면 명시적으로 보류한다.
- 검토/적용: v3 전용 품질 선택과 실제 자동 근거로 검토하며 기존 v2의 10자 메모를 위조하지 않는다. 결과 묶음은 요청한 파일만 내보내고 B안 선택 적용은 before/after hash·백업·진행 journal·충돌/재호출/되돌리기를 제공한다.
- 구현 파일: `shared/contracts/desktop-project.ts`, `server/application/desktop/`, `server/adapters/storage/project-files.ts`, `server/adapters/paseo/desktop-runtime.ts`, `scripts/project-instructions.mjs`, `scripts/desktop-production.mjs`, WinUI 프로젝트·요청·PLAN·검토·적용 화면과 관련 tests. 기존 bridge/RPC는 capability를 명시적으로 확장한다.
- 검증: 재초기화/중단/외부 수정/경로 이탈/중복 projectId, 두 프로젝트 슬롯·손상/미지원·v2 사본 보존, PLAN 중복/외부 변경/미확정 전송, 결과·검토·선택 적용의 재시도/부분 실패/원본 충돌, 실제 새 sandbox 모델 작업의 PLAN→실행→복구→검토→선택 반영. 원본 v2와 기존 sandbox 파일은 보존하고 시험용 별도 소스/Worktree만 수정한다.
- GUI 검증은 D1 G01~G05에 D2/D3 주요 흐름을 추가해 대기한다. 구현·자동·실제 연동·GUI 완료를 구분한다.

## D2·D3 실행 결과 — 2026-11-16

| 단계 | 구현 | 자동·실제 연동 | GUI |
| --- | --- | --- | --- |
| D2a | 프로젝트 등록/초기화/지침·설정 편집 완료 | 초기화·외부 수정·경로·소유권 확인 | G06/G11 대기 |
| D2b | 프로젝트 v3·원본 보관 이관·단일 슬롯 완료 | 손상/미지원·명령 이력·복원 확인 | G06/G09 대기 |
| D3 | 기획/코딩·AI PLAN·실행/복구/중단·검토·선택 적용 완료 | run 007/008의 성공·실패·동일 세션 복구·새 수정 PLAN·중단·내보내기/적용/undo 확인 | G07~G11 대기 |

검증 표의 날짜·기준점·명령·기대/실제 결과·증거·미실행 사유는 [D2·D3 완료 기록](../decisions/desktop-d2-d3-completion.md#검증-결과)에 모았다. 계획 작성 모델은 읽기 전용 공개 Codex CLI, 제작은 명시적 `auto` 모드의 Paseo를 사용한다. 앱 종료/트레이 전환은 실행을 유지하고 명시적 중단은 종료 관측 후 판정한다. v2 검토 정책은 바꾸지 않고 v3에 실제 품질 확인 계약을 추가했다. D4 질문/상담 및 PLAN 자동 전환, D5 미디어 제작, D6 배포는 이번 구현에 포함하지 않았다.
