# Orchiva 지침 지도

모든 작업 전에 [작업 흐름](docs/agents/workflow.md)을 읽는다. 이 파일은 지침의 진입점이며 상세 규칙은 아래 문서에서 관리한다.

| 적용 범위 | 필수 지침 |
| --- | --- |
| 모든 작업 | [프로젝트 규칙](docs/agents/repository-guidelines.md) |
| `client/`, `server/`, `shared/`, `index.*`, `scripts/`, 패키지·실행 설정 | [소스 규칙](docs/agents/source-conventions.md) |
| 변경 검증 및 완료 보고 | [검증 기준](docs/agents/validation.md) |
| `docs/` | [문서 규칙](docs/AGENTS.md) |
| `docs/plans/` 및 계획 기반 구현 | [계획 규칙](docs/plans/AGENTS.md), [계획 목록](docs/plans/README.md) |

제품 범위는 [MVP 설계](docs/mvp-design.md), 검증된 출발점은 [PoC 결과](docs/poc-results.md)를 따른다. 계획된 기능과 현재 구현을 구분한다. 하위 `AGENTS.md`가 있으면 해당 경로의 지침도 함께 적용한다.

후속 개발의 사용자 합의와 다른 PC에서 이어갈 절차는 [데스크톱 전환 방향과 개발 인계](docs/desktop-handoff.md)를 먼저 확인한다. .NET 앱과 기존 Orchiva·Paseo 실행부를 연결하는 방향이며, 기존 MVP의 구현 완료와 후속 기능의 구현 완료를 혼동하지 않는다. 상세 구현 범위와 착수 여부는 현재 사용자 요청에 따른다.
