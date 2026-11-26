# D1~D6 데스크톱 전환 계획

- 상태: `active`
- 2026-11-26 사용자가 MA1·MA2 구현을 위해 on hold를 요청했다. UI-A 완료, 미검증 GUI와 D4~D6를 재개 대상으로 보존한다.
- 작성일: 2026-11-16 · Asia/Seoul
- 관련 설계: [전환 설계안](../design/desktop-transition.md), [사용자 합의와 인계](../design/desktop-handoff.md), [기존 MVP](../design/mvp-design.md)
- 선행 조건: M0~M6 `completed`, 현재 소스·개발 환경의 [점검 기록](../decisions/desktop-readiness-20261116.md)
- 최초 작성 근거: 환경 점검·기존 테스트·설계/계획 작성 요청에서는 앱 구현이 제외됐다. 이후의 현재 실행 승인은 아래에 기록한다.

## 현재 실행 승인

2026-11-26 G01·G04 후속: 사용자가 재부팅·VM을 계속 후속으로 두고 순간 콘솔과 전체 키보드 이동 검증을 지시했다. `f9473f8` 기준 `d6-gui-20261126-002`에서 사용자 직접 관측으로 시작 순간 콘솔 부재를 확인했다. 실제 배포본의 화면별 키보드 경로와 조건부 실행/복구·반영 복원·Phase의 모의 GUI를 확인했다. Phase 관측용 모의 하네스만 보완했으며 제품 소스/배포본 변경·추가 모델 호출은 없다. [D6 상세 PLAN](desktop-fresh-pc-validation.md)의 실제/모의 구분과 조합 한계를 따른다. G04 화면별 이동은 확인했고 대비 수치·모든 상태/배율/테마 조합 전수는 주장하지 않는다. 검증 후 사용자가 이번 증거·문서·테스트 변경의 커밋 및 main push를 지시했다. 로컬 저장 표현은 검증 당시 이력이며 최종 반영은 Git 이력을 따른다. 재부팅·VM·MA3 독립 리뷰는 계속 후속이다.

2026-11-26 기록 공유 지시: 사용자가 현재 PC 검증 결과와 문서·공유용 증거의 커밋 및 main push를 승인했다. 아래 미커밋 상태는 검증 당시 이력이며 최종 반영 상태는 Git 이력을 따른다. PC 재부팅과 VM/깨끗한 설치 검증은 후속으로 유지한다.

2026-11-26 현재 PC 후속 시험 완료: 개인 사용 우선 지시로 `4f45127`의 원격 결과와 로컬 조사 기록을 통합했다. 새 격리 실행 `d6b-20261126-current-001`에서 N04 실제 3턴·검사/내보내기·동일 명령 중복 방지, N06 로컬 TCP 단절/복원, N07 정리를 통과했다. N05 활성 창 종료·idle daemon 재시작 복원은 통과했고 PC 재부팅은 사용자가 후속으로 미뤘다. 실제 100/150/200% 화면 조작과 G04 키보드 일부를 확인했으나 G01 순간 콘솔·전체 화면/키보드 조합 잔여는 유지한다. 사용자는 실제 모니터 글자는 정상이며 현재 PC를 마무리하고 깨끗한 설치/VM은 후속으로 하도록 결정했다. 세부 승인·예산·근거는 [D6 상세 PLAN](desktop-fresh-pc-validation.md)에 기록했다. 전체 D6/정식 배포 완료는 아니며 MA3 독립 리뷰도 후속이다. 추가 문서·증거는 로컬 저장, commit/push 전이다.

2026-11-26 후속 지시로 `19741ab` 기준 [새 PC 검증](desktop-fresh-pc-validation.md)을 이 active PLAN의 D6 상세 단계로 통합해 재개했다. 초기 조사 ID `d6-freshpc-20261126-201818-001`에서 개발 도구와 Codex 인증 파일이 이미 있어 N01~N07은 환경 차단이다. 전달 배포본 검사와 기존 PC의 통합 GUI 관측은 별도로 기록한다. 아래 이전 보류·실행 범위는 당시 이력이다.

2026-11-26 두 게임의 Polish 승인 후 사용자 지시로 재개했다. 이번 범위는 D1~D3의 G01~G11이며 Computer Use가 필요한 관측은 보류한다. [재개 후 검증 결과](../decisions/desktop-gui-resumption.md)를 따른다.

2026-11-16 사용자가 “PLAN을 승인할게 작업 시작해줘”라고 지시했다. D1부터 순서대로 구현한다. 이전의 구현 제외 기록은 당시 범위의 이력이며 이번 승인으로 착수 근거가 갱신됐다. 최초 착수 범위는 D1 조회 UI·stdio 연결·격리 수명 검증이었다. D2~D6는 상세화 후 순차 진행하며 D1 완료를 전체 완료로 표시하지 않는다. 실행 결정: .NET 10 + WinUI 3, 공개 SDK를 사용하는 stdio bridge 채택. 창 닫기 설정 기본값은 앱 종료로 두고 D1은 조회 전용이라 작업 중단 동작을 추가하지 않는다. daemon 수명은 UI/bridge와 분리하고 D3 활성 작업 정책은 별도 상세화한다.

2026-11-16 후속 지시: Paseo 콘솔 생성 경로를 수정하고 남은 비GUI 검증을 수행한다. 컴퓨터 유스는 사용하지 않고 GUI 수용 조건을 대기 목록으로 분리한다. 해당 범위의 구현·비GUI 검증을 완료해도 GUI 조건을 통과 처리하지 않는다.

2026-11-16 후속 실행 승인: 사용자가 D3까지 컴퓨터 유스 없이 연속 진행하도록 지시했다. D2a/D2b → D3 구현·자동/격리 실제 연동까지 수행하고 GUI는 대기한다. D2/D3 상세 계약과 파일·검증은 아래 추가 절을 따른다. 착수 전 소스 백업: `C:/Users/USER/AppData/Local/Temp/orchiva-d2-d3-baseline-1794797440557`.

## 현재 단계 상태

2026-11-26 통합 인계. MA1~MA6와 두 게임의 Polish 승인을 완료했다. 데스크톱 D1~D5 및 D6의 기존 PC 검증 기록을 합쳤다. UI-A와 Milestone 화면이 합쳐진 버전의 G01·G02·G04·G11은 새 데스크톱에서 다시 관측한다. Computer Use를 사용할 수 있다. [새 PC 설치·로그인 검증](desktop-fresh-pc-validation.md)은 아직 실측 전이다.

이번 병합에서 1인 개발용 Milestone 작업실, D4 상담, D5 미디어 화면과 D6 실행부를 연결했다. 통합 후 TypeScript 검사, Node 146개, 패키지 경계 검사, 제품과 WinUI 시험 앱 빌드, WinUI 모의 검사 21개가 통과했다. 격리 실행부에서 C# 17개가 통과했고 전용 상담·미디어·배포·도구 환경을 요구하는 4개는 건너뛰었다. 새 PC 실측 결과는 [별도 PLAN](desktop-fresh-pc-validation.md)에 기록한다.

### 병합 전 각 작업 환경의 기록

2026-11-26 재개 후 G03과 G05~G10의 기능 흐름을 격리 실행부에 연결한 WinUI 창에서 확인했다. G01의 콘솔 노출, G02·G04·G11의 배율·키보드·시각 수용은 부분 검증 상태였다. [항목별 판정과 근거](../decisions/desktop-gui-resumption.md)

2026-11-26 [UI-A](desktop-ui-alignment.md) 상세 단계 완료: 포함 화면 13개·전후 비교·800×600/1280×900/넓은 창·테마·입력 유지·빈 목록/오류/로딩/권한/반영 이력 표시를 확인했다. 배율 변경 검증은 사용자 지시로 보류했고 실제 관측은 125%다. [최종 결과와 G01~G11 교차표](../decisions/desktop-ui-alignment.md)를 따른다. 합성 화면 수용을 실제 모델·파일 반영·콘솔·트레이 시험으로 확대하지 않는다. 상위 PLAN은 active, D4~D6는 미착수다.

2026-11-17 후속 승인: [UI-A](desktop-ui-alignment.md)를 이 active PLAN의 상세 실행 단계로 진행하며 기능 변경 없이 UI를 정합한다. 사용자가 이번 작업의 컴퓨터 유스를 허용했다. GUI 항목은 실제 관측한 범위만 갱신하고 D4~D6는 시작하지 않는다.

2026-11-17 UI-A 실행: 화면 분리·공통 탐색·카드/반응형 배치 코드를 적용하고 모의 19개·기존 C# 13개(skip 0)·빌드·타입 검사를 통과했다. 변경 후 화면 탐색 중 물리 Escape로 컴퓨터 유스가 중지되어 시각 수용은 대기한다. [중간 결과](../decisions/desktop-ui-alignment.md)를 따르며 G01~G11과 D4~D6를 일괄 완료 처리하지 않는다.

2026-11-17 기능 변경 없는 디자인 보정을 위한 [UI-A 세부 PLAN](desktop-ui-alignment.md)을 `proposed`로 작성했다. 기존 시안 14개와 현재 XAML/C#의 차이를 정리한 문서 작업이며 UI 구현은 아직 시작하지 않았다. 기존 기능 계약과 GUI 대기는 유지한다.

2026-11-17 사용자가 D6까지의 코드·검증 문서를 커밋하고 main에 반영·push하도록 지시했다. 검증 당시의 미커밋 기록은 보존하며 최종 반영 상태는 Git 이력을 따른다. 새 PC 검증 PLAN은 나중에 실행한다는 지시에 따라 `proposed`·보류 상태로 유지하고 실제 시험을 시작하지 않는다.

2026-11-17 D6 실행 승인: 사용자가 “다음으로 D6를 구현 시작해줘”라고 지시했다. D5의 미커밋 변경을 보존하고 기준 `e0248d9` 및 소스 백업 `C:/Users/nellu/AppData/Local/Temp/orchiva-d6-baseline-20261117-002651`에서 이어간다. D6는 진행 중이며 전체 계획은 `active`다.

### D6 상세 실행 범위

2026-11-17 후속 실행 지시: 새 PC 검증을 보류한 채 남은 D6 구현과 현재 PC 검증을 계속한다. D6b 도구/인증 진단·오프라인 교체/복구·현재 PC 실제 제작/상담/미디어·GUI·소유 worker 복원 검증을 마쳤다. [D6b 결과](../decisions/desktop-d6-integration.md)에 실제/모의 경계와 실패 보존·생성 수·정리를 기록했다. Node 125/125, C# 13 통과/8 과거 fixture 건너뜀, package 경계 및 최신 배포 검증 통과. 새 PC 실측·서명된 정식 배포는 완료로 표시하지 않으며 전체 PLAN은 active다. 아래 D6a 및 예정 파일 문장은 착수 당시의 이력이다.

2026-11-17 범위 조정: 사용자가 새 PC 검증을 제외한 작업 진행을 지시했고, 새 PC 검증은 나중을 위한 PLAN만 작성하도록 명시했다. [새 PC 검증 PLAN](desktop-fresh-pc-validation.md)을 `proposed`로 분리하고 실행하지 않는다. 설치·인증 상태 안내, 현재 PC의 버전 교체/복구·배포본 실제 수용은 계속한다. 새 PC 검증 보류는 전체 계획의 일시 정지나 검증 통과를 뜻하지 않는다.

D6b 기준 백업: `C:/Users/nellu/AppData/Local/Temp/orchiva-d6b-baseline-20261117-005211`. 구현 순서는 도구/인증 읽기 전용 진단 → 명시적 오프라인 버전 교체·중단 복구 → 새 배포본의 소유 sandbox 통합 시험이다. 예정 파일은 `ToolReadiness.cs`, 배포 관리 코드/시험, 연결 화면과 D6 전용 하네스다. 기존 인증을 복사·로그아웃하지 않고 전역 설정을 변경하지 않는다. 실제 모델 시험은 새 격리 소스·home에서 기획/코딩·상담·미디어의 최소 사례로 제한하고 생성 ID/개수·기록 hash를 보존한다. 다른 작업의 daemon 종료와 원본 D1~D5 결과 재사용은 금지한다.

- D6a: Windows x64 폴더형 사전 검증 배포본. .NET/Windows App SDK self-contained, 고정 Node와 Paseo·Plugin 의존성을 동봉한다. 개발 PC의 인증·요청·설정·캐시는 복사하지 않는다. 파일 allowlist, lockfile 기반 설치, 버전·SHA-256 manifest와 누락/변경 검사를 제공한다. 서명 없는 내부 검증본이며 공개 배포·자동 업데이트는 하지 않는다.
- 첫 실행: 환경 변수 없는 exe 진입, 사용자 LocalAppData의 전용 profile, loopback 포트와 별도 data/Paseo home 생성, 재실행 시 같은 profile 재사용. 기존 v2 프로젝트가 없는 빈 환경도 작업실 연결을 막지 않는다. 부분 생성·미래 profile·다른 설치 경로는 자동 덮어쓰기하지 않는다.
- 외부 전제: Git과 Codex는 사용자 설치 및 정상 로그인을 사용한다. 자동 인증·사용자 정책 변경 없음. 미설치/미로그인 안내와 실제 새 PC 수용은 D6 후속 항목이다. 사전 검증 대상은 Windows 11 x64이며 다른 Windows/ARM64 지원을 검증한 것으로 표시하지 않는다.
- D6b: 배포본의 프로젝트 등록→PLAN→제작/상담→검토/적용, 진행 중 창 종료/재접속, 소유 worker 장애와 중복·보존 대조, 버전 교체·복구 계약 및 사용자 수용. 데이터 버전 역변환과 이전 앱으로 자동 rollback은 하지 않는다.
- 파일: 예정 `scripts/package-desktop.mjs`, `desktop/deployment/`, `desktop/Orchiva.Bridge/PackagedProfile.cs`, 앱 시작 연결 및 빈 legacy store 복원 보완, 관련 tests와 guides/decisions/evidence.
- 검증: package 누락/변경·경로/비밀값 제외, profile 중복/부분 생성/미래 버전·설치 경로 변경 거부, 한글/공백 경로의 실제 packaged bridge 연결·재실행·종료 및 GUI. 새 PC 미설치/로그인과 업데이트·전체 통합은 각각 실제 실행 전까지 미완료로 유지한다. 신규 소유 `d6-20261117-*`만 시험하고 기존 D1~D5·운영 daemon은 재시작하지 않는다.

진행 결과: D6a 배포·첫 실행 기반 구현과 현재 PC의 실제 연결·GUI 1266×893/540×893·재열기 확인 완료. publish의 PRI/XBF 누락으로 생긴 실제 종료 문제를 고쳤다. Node 121/121, C# 전체 10 통과/8 환경 미지정 건너뜀과 D6 실제 fixture 3/3, package 경계 검사 통과. [D6a 기록](../decisions/desktop-d6-package.md)의 새 PC 로그인·업데이트/복구·전체 통합·정식 배포 조건은 미완료이며 D6/전체 PLAN은 `active`다.

2026-11-16 D5 실행 승인: 사용자가 D5 진행을 지시했다. 기준 `e0248d9`이며 D4까지 main push 완료다. 생성 도구 선택 질문에 “생성도구는 따로 없어. 일단 임시로 아무거나 적용해줘”라고 답해 외부 계정 없이 동작하는 임시 절차적 생성기를 채택한다. 2026-11-17 임시 생성기 범위의 D5 구현·검증 완료, D6 미착수다. 아래 D4의 commit/push 전 문장은 검증 당시 이력이다.

## D5 상세 실행 범위 — 2026-11-16

- 임시 어댑터: `orchiva-procedural-v1`. 아트는 명시적 크기·색·도형·투명도의 PNG, 사운드는 길이·주파수·채널·파형의 PCM16 WAV, 효과는 확산 링 PNG 프레임 시트와 재생 JSON이다. 자유 프롬프트를 이해하는 이미지/음악 모델이나 Unity 파티클 생성기로 표시하지 않는다. 프로젝트 규격 입력을 받아 시험용 자산을 생성하며 실제 생성기로 교체할 경계를 둔다.
- 구현 순서: 분야별 규격 계약 → 생성/독립 형식 검사·명시적 파일 목록 수집 → PLAN·실행 intent·단일 슬롯·실패/재호출 보존 → RPC·WinUI 정형 입력/미리보기 → 실제 파일·재시작·GUI 검증.
- 산출물 예산: 파일당 32 MiB, 묶음 128 MiB, 100개, 이미지 16 Mi 픽셀. 기존 제작의 2 MiB 한도를 전역 완화하지 않는다. Git ignored 파일도 명시한 출력 manifest에 있으면 수집하되 경로 이탈·중복·내부 메타데이터·파일 변경을 거부한다. 해시는 스트리밍으로 계산한다. 내보내기/journal은 직렬화 JSON 24 MiB, 원본 입력 snapshot은 기존 2 MiB/합계 16 MiB를 유지한다.
- 구현 파일: `shared/contracts/desktop-media.ts`, `server/adapters/media/`, `server/adapters/storage/media-artifacts.ts`, 관련 테스트. application·RPC·WinUI 입력/미리보기·선택 반영과 연결했다.
- 검증: 생성 PNG의 CRC·압축 해제·치수/알파, WAV 헤더·길이/채널, 효과 시트/JSON 규격. 잘린/손상/미지원 파일, 큰 파일·예산 초과·경로 이탈, 실제 preview와 재생, 중복 명령·실패/복원·소스 보존을 구분한다. PNG v1 검사는 RGBA8·비인터레이스·필터 0만 지원하고 나머지는 미지원으로 표시한다.
- 실행 예산: 새 `d1-d5-20261116-001`/`d1-d5-20261117-002` 소유 폴더에서만 실제 생성·장애 시험. 현재 열린 Aseprite/Unity 프로젝트와 기존 D1~D4 데이터는 시험에 쓰지 않는다. 외부 인증·유료 생성 호출·전역 설정 변경 없음.
- 현재 판정: 제작 화면과 미리보기·선택 반영 통합, 세 분야 실제 생성과 손상/복구·내보내기/반영/undo·재시작·GUI 검사 완료. Node 120/120·최신 관련 검사 11/11, C# 9 통과/6 환경 미지정 건너뜀, 최종 WinUI build 경고/오류 0. [D5 기록](../decisions/desktop-d5-media.md)을 따른다.

형식 근거: [W3C PNG 규격](https://www.w3.org/TR/png/), [Microsoft WAVEFORMATEX](https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatex).

2026-11-16 D4 실행 승인: 사용자가 “이제 D4 작업을 진행해줘”라고 지시하고, 이후 접근/승인 정책 방향과 설계·계획 수정 및 남은 구현·검증을 승인했다. 기준 `f080480`에서 D4 질문/상담 구현·자동·실제 연동·GUI 검증을 완료했다. [D4 결과](../decisions/desktop-d4-conversation.md)의 미지원 정책·복원 제약을 따른다. D1~D3 완료 기록은 보존하며 D5~D6는 이번 범위에 포함하지 않는다.

2026-11-16 이전 지시 “D3까지 필요한 GUI검증을 이제 진행해줘”와 “남은 검증 계속 진행해줘”에 따라 D1~D3 GUI G01~G11을 완료하고 발견한 UI·PLAN 생성 문제를 보완했다. 실제·합성 시험을 구분했고 마지막 트레이 복원/메뉴 종료와 125%·150% 선명도에는 사용자 조작·확인을 포함했다. [GUI 결과와 수정](../decisions/desktop-d1-d3-gui-20261116.md), [GUI 증거 요약](../evidence/desktop-transition/d1-d3-gui-20261116/summary.json)을 따른다. 이 GUI 수용 당시 D4~D6는 미착수였다. 현재 전체 PLAN은 `active`다.

D2a/D2b와 D3의 구현·비GUI 검증은 앞서 완료했다. 프로젝트 실제 docs/지침, v3 기록·전역 슬롯, AI PLAN, 제작·복구·중단·검토, B안 내보내기/선택 반영/부분 복원/undo의 [이전 검증 기록](../decisions/desktop-d2-d3-completion.md)과 [증거 요약](../evidence/desktop-transition/d2-d3-20261116/summary.json)을 보존한다.

## 목표

Windows exe에서 프로젝트와 분야를 고른 뒤 제작의 새 요청/수정 요청 또는 자유 질문을 진행하고, PLAN·실행·산출물·검토 이력을 보존하는 제품으로 전환한다. 기존 Node/Paseo 실행부를 유지하면서 중복 생성·재전송·실패 근거 유실을 방지한다.

**첫 구현 단계 D1의 목표는 조회 가능한 .NET 화면과 연결·종료·재연결 기반**이다. D1만으로 제작 실행이나 다중 프로젝트가 완성됐다고 표시하지 않는다. D1 구현·비GUI·GUI 수용은 완료했다. 숨김 runtime host와 공개 daemon run 연결, 경로·실패·재시작·정리의 [이전 비GUI 결과](../decisions/desktop-d1-runtime-completion.md)와 [이전 화면 검증](../decisions/desktop-d1-gui-verification.md)을 보존한다. 최신 결과는 위 GUI 기록을 따른다. [구현 결과](../decisions/desktop-d1-foundation.md)와 [실행 안내](../guides/desktop-development.md)를 따른다.

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

후속 승인에 따라 D3까지 구현·격리 실제 연동·GUI 검증을 수행했다. D4의 구현·검증과 승인된 정책 변경은 아래 상세 절에서 관리한다. D5는 위 임시 생성 계약으로 완료했으며 D6는 위 상세 범위로 진행 중이다.

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
| D4 질문/상담 | conversation 계약·application·runtime·WinUI 화면 | 자유 입력, 대화/턴 명령·이력, 동일 Agent 후속 메시지, 접근 권한·승인 정책 선택 및 승인/중단. 대화에서 PLAN 자동 작성·완성·제작 전환 기능은 제외 | 경로/검사 입력 없는 대화, 중복·응답 유실·재시작·실제 권한 경계·GUI 검증 |
| D5 제작 분야 확장 | 예정 분야별 profile·생성/검증/미리보기 어댑터 | 아트·사운드·특수효과 도구 연결, 큰 파일/ignored 산출물, 모델 capability·형식 규격 검사 | 각 분야 실제 산출물과 미지원/도구 부재/예산 초과 구분. 텍스트 대체물을 완료로 오인하지 않음 |
| D6 배포·통합 수용 | 예정 publish/설치 설정·진단 도구, guides·decisions/evidence | 배포 형식·동봉·인증·업데이트 결정, 새 PC 설치, 종료·복원, 전 단계 회귀 | exe 진입 전체 흐름, 파일/세션/명령 수·보존 해시, 새 PC 실측과 사용자 확인 |

단계는 위 순서로 진행한다. D2 이후에는 변경 파일·스키마·검증 예산을 확정한 상세 절을 추가하고 착수한다. D5는 사용자 선택에 따라 위 임시 생성 계약을 적용했다. D6a는 Windows x64 폴더형 로컬 검증본이며 정식 설치·서명·업데이트 수용은 남아 있다.

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
| D4 | 자유 입력만으로 여러 턴, 같은 Agent·턴별 명령, 미확정 전송 재송신 차단, 선택한 sandbox/승인 정책·승인 허용/거부·정책 고정, 기본 읽기 전용의 쓰기 차단·명시적 수정 권한의 작업 폴더 쓰기, 대화·턴·승인 근거 복원, PLAN 자동 작성/완성·제작 전환 기능 없음 |
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

구현·비GUI 검증 후 사용자가 컴퓨터 유스 검증과 남은 사용자 확인에 참여했다. 최신 [G01~G05 판정](../decisions/desktop-d1-d3-gui-20261116.md#gui-수용-결과)에 따라 D1 수용을 완료했다. 전체 D1~D6 완료와 구분한다.

- [x] 확정한 WinUI 3 + .NET 10의 SDK·통신·수명 정책과 개발 조합을 기록한다.
- [x] 첫 조회 화면부터 디자인 시안·공통 리소스·상태별 화면과 테마/접근성 검증을 완료한다. 키보드·포커스·배율 수용이며 스크린리더 전체 인증을 의미하지 않는다.
- [x] .NET 조회 화면과 Node bridge가 선택한 계약으로 실제 격리 Plugin에 연결된다.
- [x] 빈 상태·목록·상세·오류·복원 상태가 GUI에서 구분되고 읽기 전용 capability가 강제된다. 실제 빈 저장소와 합성 복원 상태를 구분해 검증했다.
- [x] V01~V12의 비GUI 검증 통과. 실제 연동·모의를 구분해 기록했다. GUI 부분도 위 최신 G01~G05 판정에 따라 완료했다.
- [x] Agent/Workspace/메시지 생성 0, 기존 요청·실행 데이터와 sandbox 무변경을 확인한다.
- [x] bridge 3회 수명·재연결·격리 daemon 재시작에서 기록·소유권·프로세스 정리가 검증된다. 실제 앱 정상 종료·재열기 3회와 사용자 조작을 포함한 트레이 복원·명시 종료도 확인했다.
- [x] 결과 문서·환경 안내·계획/목록을 갱신하고 단계별 완료를 구분한다. 이 수용 당시 D1~D3 완료, D4~D6 미착수였다. 현재 상태는 상단과 D4 상세 절을 따른다.

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
| 2026-11-17 | `e0248d9` 이후 로컬 D5/D6, `d6b-20261117-live-001` | 도구/인증 진단·배포본 실제 제작/상담/미디어·GUI·소유 Plugin 종료/명시적 복원·오프라인 정상 교체/프로세스 중단 복구 | Node 125/125, C# 13 통과/8 과거 fixture 미지정, package 1/1 및 Release publish 통과. 실제 4 제작·상담 2턴, Agent 5/제작 Worktree 4/상담 checkout 1 보존. 60파일 hash 대조. [D6b 검증·정리](../decisions/desktop-d6-integration.md) | 새 PC 실측 PLAN 실행 보류, 정식 공개 배포 조건. 전체 active 유지, commit/push 전 |
| 2026-11-16 | 같은 GUI 수정본, 기본 출력 재빌드 | 사용자 트레이 복원/메뉴 종료 + PID·기록 대조, 125%/150% 실제 모니터 사용자 확인, 100% 복원·최종 시험 앱 종료 | G02/G05/G11도 통과해 G01~G11 완료. [후속 확인](../evidence/desktop-transition/d1-d3-gui-20261116/followup.json), [정리](../evidence/desktop-transition/d1-d3-gui-20261116/cleanup.json). 요청 2건·결과 5개·v2 3개 보존, 소유 프로세스/포트 없음. build 경고/오류 0 | D1~D3 GUI 잔여 없음. D4~D6 미착수, 전체 계획 active, commit/push 전 |
| 2026-11-16 | `main`의 `3aad026` 이후 로컬 GUI 수정 | GUI: 격리 run `d1-20261116-gui-001` 및 `gui-empty`, 실제 제작/실패/복구/중단/수정/반영, 합성 복원·권한. 자동: typecheck·Node tests·.NET tests·WinUI build | 주요 흐름과 입력/근거 보존 확인. Node 108/108·C# 13/13, build 경고/오류 0. [GUI 결과](../decisions/desktop-d1-d3-gui-20261116.md), [증거](../evidence/desktop-transition/d1-d3-gui-20261116/summary.json). 기대했던 전체 GUI 수용에는 미달 | 트레이 복원/메뉴 종료 및 125%·150% 선명도 확인. G02/G05/G11 부분 완료, D4~D6 미착수, commit/push 전 |
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
3. D1 구현·비GUI 검증에 이어 GUI의 콘솔 부재·빈 상태·재연결·종료/재열기·트레이·DPI 수용을 완료했다. D3의 실제 모델 제작·복구·수정 요청도 GUI에서 검증했다. 사용자 확인과 합성 시험 범위를 결과 문서에 명시했다.
4. D2에서는 v3·지침 적용·전역 슬롯, D3에서는 자동 검토 계약·산출물 내보내기·소스 반영 범위를 상세화한다. 기존 v2 판정을 형식적인 메모로 우회하지 않는다.
5. 이 검증 당시 변경은 소스·문서의 로컬 저장이며 commit·push 전이었다. 이후 2026-11-16 사용자가 지금까지 작업의 main 반영·push를 지시했다. 최종 반영은 Git 이력과 origin/main을 따른다. 계획은 사용자 구현 승인에 따라 `active`이며 남은 수용 항목을 완료로 표시하지 않는다.

## D4 착수 상세 — 2026-11-16

- 후속 실행 승인: 사용자가 접근 권한과 승인 방식 선택 제안을 승인하고 설계·계획 갱신 및 D4 구현·검증을 지시했다. 기존 도구 전체 차단 요구를 [상담 정책](../design/desktop-transition.md#질문상담)의 런타임 sandbox·승인 정책으로 대체한다. 별도 유료 모델 API를 추가하지 않고 기존 Paseo/Codex 공개 API를 사용한다.
- 상세 범위: 대화 원자적 저장 → 전역 슬롯 → 고정 모델/지침/정책으로 동일 Agent 생성·후속 메시지 → 승인 요청/중단의 intent 및 대조 → RPC·WinUI의 프로젝트/모델/접근/승인 선택·대화/턴 이력 → 모의 장애·실제 다중 턴·권한·GUI 검증. 정책 변경은 새 대화로만 적용한다. 원본 프로젝트 직접 수정과 D3의 선택 반영을 구분한다.
- 검증 예산: 새 `d4-20261116-*` 소유 시험 폴더·daemon home·포트 사용. 운영 프로젝트 및 기존 D1~D3 결과는 수정하지 않는다. 기본 읽기 전용, 작업 폴더 수정, 전체 접근 설정 전달과 승인 허용/거부를 구분해 검증한다. 외부 호출 불확실성·재시작은 모의와 실제 증거를 구분한다. 사용자 전역 설정 변경은 없다.

- 기준: `f080480`, 사용자의 D4 진행 지시. 새 대화는 제작 PLAN과 별도 식별자를 사용한다. 사용자에게 제작 경로·검사·완료 조건을 요구하지 않고 PLAN 자동 작성/제작 전환을 제공하지 않는다.
- 구현 순서: 대화/턴 계약과 도메인 → 원자적 저장·기존 전역 슬롯 통합 → 선택 정책을 적용하는 상담 실행 포트와 실제 정책 검증 → RPC/WinUI → 실제 다중 턴·복원·GUI 수용. 대화별 모델과 지침 원문/hash를 고정하고 후속 턴은 같은 세션을 사용한다.
- 초기 구현 이력: `shared/contracts/desktop-conversation.ts`, `server/domain/conversation.ts`에 명령키/원문 hash 대조, 턴별 messageId, 선행 턴 대기 차단, dispatch intent 이후 unknown, 완료 이력 불변을 정의했다. 당시에는 RPC·UI 연결 전이었다.
- 초기 자동 검증 이력: typecheck, 신규 도메인 테스트 3개 및 전체 회귀 111/111 통과. 이후 서비스·어댑터·UI와 검증을 추가했다. 최신 결과는 아래 완료 기록을 따른다.
- 실행 정책 조사: 설치된 Paseo 0.15.4의 공개 `ToolPolicy`는 `preapproved: McpToolRef[]`만 제공한다. Codex provider options의 strict schema는 read-only sandbox·approval·web search·일부 features를 받지만 전체 도구 비활성화 옵션을 제공하지 않는다. read-only만으로 명령 실행/외부 읽기까지 금지했다고 간주하지 않는다. 공개 before-open hook의 tools는 provider 내장 도구 전체를 제어하는 근거가 아니다.
- 대안 조사 이력: [Codex hooks 공식 문서](https://learn.chatgpt.com/docs/hooks)의 PreToolUse 경로를 조사했으나 채택하지 않았다. 후속 사용자 승인으로 전체 도구 차단 요구를 접근/승인 정책 선택으로 대체했으며 별도 API 키·전역 설정·hook trust 변경 없이 공개 Paseo API로 구현했다.
- 구현: `ConversationStore`의 원자적 저장·프로젝트 writer 소유권, 제작과 공유하는 전체 활성 슬롯, 동일 Agent 메시지·승인·중단, 공개 turn 종료 hook의 영속 결과 대조, 버전 있는 RPC와 WinUI 질문·상담 화면을 연결했다. 응답 본문은 턴 상세 RPC로 분리한다.
- 실제 정책 제약: Codex 0.166.0이 `untrusted`를 거부한다. UI에서 비활성화하고 새 생성/전송은 Agent 호출 전에 거부한다. `on-request`·`never`와 접근 권한 3종을 지원하며 자동 정책 대체는 없다.
- 검증 근거와 현재 판정: [D4 결과](../decisions/desktop-d4-conversation.md), [증거 요약](../evidence/desktop-transition/d4-20261116/summary.json). D5/D6 미착수이며 전체 계획은 `active`다. 이번 D4 변경은 commit/push 전이다.

### D4 완료 조건과 검증

- [x] 자유 입력·모델/수준·접근/승인 선택과 동일 Agent 후속 대화, 원본 경로·현재 정책 표시.
- [x] 대화·턴·지침 snapshot 불변 이력, 전역 슬롯, 중복 명령·미확정 전송 재송신 차단, 원자적 저장.
- [x] 승인 상세·명시적 선택·hash 대조와 intent, 실제 허용/거부, 중단 결과·부분 응답 보존.
- [x] 실제 daemon 재시작 후 동일 Agent 후속 응답, stdio bridge 재연결, 과거/실패 이력 보존.
- [x] 실제 읽기 전용 실패·작업 폴더 쓰기·경계 밖 쓰기 차단·전체 접근, 미지원 untrusted 사전 거부.
- [x] GUI 첫/후속 메시지·중단·빈 상태·오류·1266×893/880×700 레이아웃, 자동 갱신 입력 방해 수정.
- [x] typecheck·Node 116/116·WinUI build 경고/오류 0, C# 9 통과/5 fixture 미지정 건너뜀. 실제·모의 범위와 실패 보존을 결과 문서에 기록.

D4는 완료다. D4 수용 당시 D5·D6는 미착수였으며 현재 D5 판정은 상단 상세 절을 따른다.

## D2·D3 상세 실행 범위

- D2: 프로젝트의 실제 소스 경로 등록은 읽기만 수행한다. 초기화 미리보기의 파일 해시를 확인한 명시적 명령으로 루트 지도와 필수 docs를 만들고 기존 내용·하위 지침의 적용 범위를 보존한다. 로컬 registry에는 경로 연결만 보관한다.
- 저장: schemaVersion 3 요청은 제작 메타데이터·PLAN 문서 hash·명령 journal과 검증된 v2 실행 engine 상태를 한 envelope에 보관한다. 실행 engine의 결과·판정·명령 불변 규칙을 재사용한다. 소유권은 실경로별 단일 Node writer, 실행 슬롯은 모든 등록 프로젝트와 기존 v2의 활성/손상/unknown을 확인한다.
- D3: 기획·코딩의 정형 입력과 실제 provider 모델/수준 목록, 제한된 PLAN 작성 호출, 고정 지침·입력 snapshot과 외부 변경 감지, PLAN 확인 후 기존 Worktree/Agent 실행·복구를 연결한다. 일반 소스 미커밋 변경은 입력 snapshot으로 보존하고 지원 범위를 벗어나면 명시적으로 보류한다.
- 검토/적용: v3 전용 품질 선택과 실제 자동 근거로 검토하며 기존 v2의 10자 메모를 위조하지 않는다. 결과 묶음은 요청한 파일만 내보내고 B안 선택 적용은 before/after hash·백업·진행 journal·충돌/재호출/되돌리기를 제공한다.
- 구현 파일: `shared/contracts/desktop-project.ts`, `server/application/desktop/`, `server/adapters/storage/project-files.ts`, `server/adapters/paseo/desktop-runtime.ts`, `scripts/project-instructions.mjs`, `scripts/desktop-production.mjs`, WinUI 프로젝트·요청·PLAN·검토·적용 화면과 관련 tests. 기존 bridge/RPC는 capability를 명시적으로 확장한다.
- 검증: 재초기화/중단/외부 수정/경로 이탈/중복 projectId, 두 프로젝트 슬롯·손상/미지원·v2 사본 보존, PLAN 중복/외부 변경/미확정 전송, 결과·검토·선택 적용의 재시도/부분 실패/원본 충돌, 실제 새 sandbox 모델 작업의 PLAN→실행→복구→검토→선택 반영. 원본 v2와 기존 sandbox 파일은 보존하고 시험용 별도 소스/Worktree만 수정한다.
- GUI 검증은 D1 G01~G05에 D2/D3 주요 흐름을 추가한 G06~G11로 수행했다. 최신 판정은 GUI 결과 기록을 따르며 구현·자동·실제 연동·GUI 완료를 구분한다.

## D2·D3 실행 결과 — 2026-11-16

| 단계 | 구현 | 자동·실제 연동 | GUI |
| --- | --- | --- | --- |
| D2a | 프로젝트 등록/초기화/지침·설정 편집 완료 | 초기화·외부 수정·경로·소유권 확인 | G06/G11 통과, 일부 DPI는 사용자 시각 확인 |
| D2b | 프로젝트 v3·원본 보관 이관·단일 슬롯 완료 | 손상/미지원·명령 이력·복원 확인 | G06/G09 통과, 권한 UI는 합성 시험 |
| D3 | 기획/코딩·AI PLAN·실행/복구/중단·검토·선택 적용 완료 | run 007/008의 성공·실패·동일 세션 복구·새 수정 PLAN·중단·내보내기/적용/undo 확인 | G07~G11 통과. 실제·합성·사용자 확인 구분은 GUI 기록 참조 |

검증 표의 날짜·기준점·명령·기대/실제 결과·증거·미실행 사유는 [D2·D3 완료 기록](../decisions/desktop-d2-d3-completion.md#검증-결과)에 모았다. 계획 작성 모델은 읽기 전용 공개 Codex CLI, 제작은 명시적 `auto` 모드의 Paseo를 사용한다. 앱 종료/트레이 전환은 실행을 유지하고 명시적 중단은 종료 관측 후 판정한다. v2 검토 정책은 바꾸지 않고 v3에 실제 품질 확인 계약을 추가했다. D4 질문/상담 및 PLAN 자동 전환, D5 미디어 제작, D6 배포는 이번 구현에 포함하지 않았다.
