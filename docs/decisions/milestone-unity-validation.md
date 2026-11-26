# MA5 Unity 검사·Windows Player 수용 기록

2026-11-26 · Windows x64 · Unity Editor 6000.3.27f1 · Test Framework 1.6.0 · Unity CLI 1.1.0

MA4 전용 브랜치의 최종 커밋 `0b99c53d45e763a0809f589493a34a1b7094ee34`에서 점수와 라벨을 읽었다. 실제 Editor 검사를 거쳐 Windows Player를 빌드하고, 그 실행 파일이 첫 장면에서 점수를 얻어 HUD를 **SCORE 0 → SCORE 10**으로 변경하는 것을 확인했다. [검사·프로세스·입력과 빌드 해시](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/validation.json)

## 실제로 빌드한 대상

MA4의 `Shared.unity`는 점수·라벨 두 줄을 담은 텍스트이고 `label.txt`는 기대 라벨이다. 저장소에 직렬화된 Unity Scene이나 Player 코드는 없었다. 고정 프로필 `hud-win64-v1`은 대상 SHA를 독립 checkout에 가져와 두 blob을 TextAsset으로 옮긴다. 별도로 고정한 Unity Scene, TextMesh HUD, 점수 획득 동작, 테스트와 빌드 코드를 결합했다. 프로필 해시와 입력 SHA를 함께 기록하며 MA4 브랜치의 소스는 보존한다. 같은 계약의 네이티브 Unity 프로젝트에서는 커밋에 포함된 실제 Scene을 사용한다.

| 확인 대상 | B 통합 직후 `9984a9b7` | 최종 C 통합 직후 `0b99c53d` |
| --- | --- | --- |
| Editor 검사 | EditMode 2/2, PlayMode 1/1 통과 | EditMode 2/2, PlayMode 1/1 통과 |
| Windows 빌드 | Scene의 `unset`과 기대 라벨 `SCORE` 불일치. BuildPipeline이 실패를 보고하고 프로세스가 코드 2로 종료 | BuildReport 결과 `Succeeded`, 오류 0, 보고 크기 89,442,005바이트 |
| Player 실행 | 빌드 실패에서 정지 | 실제 D3D11 Player에서 첫 장면 `Hud`, 점수 10, HUD 갱신을 확인하고 종료 코드 0 |
| 다음 Feature | 실행 중과 실패 후에 `waiting` | 검사가 끝난 뒤 C의 SHA에서 `reserved` |

후속 배정은 기존 승인·통합 레코드의 격리 사본에 대기 Feature 하나를 둔 시험이다. B와 C의 통합 경계에서 실제 배정기를 각각 구동했다. 시험용 후속 Feature의 모델 호출은 0회였다. [자동 Editor 실행과 후속 배정 기록](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/automatic-handoff.json) · [저장된 판정 재생](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/handoff.json)

최종 C 시험에서 새 Library로 시작한 EditMode는 20.98초, 같은 Library를 사용한 PlayMode는 7.78초였다. 서로 다른 검사이므로 이 차이로 캐시 속도 향상률을 계산하지 않는다. 빌드 후 Library는 52,336,863바이트였다. Editor 로그, NUnit XML, BuildReport, 실행 파일과 배포 파일 전체의 해시 목록은 시도별 검증 디렉터리에 있다. WinUI에서 커밋별 실패·통과, HUD 결과, 바이너리 해시와 근거 경로를 조회했다. [800px 화면](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/unity-800.png) · [1280px 화면](../evidence/milestone-automation/MA5/ma5-hud-20261126-004/unity-1280.png)

## 사용과 검증 경계

- 작업실에서 Git 통합 방식을 선택하고 **Milestone 인계 전 Unity HUD 검사와 Windows Player 빌드**를 켠다. 로드맵 Feature에 `unityTests`를 지정하면 해당 Feature의 통합 커밋에서 선택한 EditMode 검사를 실행한다. Milestone의 마지막 통합 커밋에서 전체 EditMode·PlayMode·빌드·Player 검사가 통과해야 인계한다. 기존 실행의 승인된 커밋도 Feature를 선택해 검사할 수 있다.
- 입력 manifest에는 커밋·트리·경로·blob·크기를 기록한다. 로컬 LFS 실체와 해시, 에셋과 .meta의 대응, GUID 중복과 이동을 확인한다. 제작 화면의 단건 overlay는 이전 방식으로 작동한다. 네이티브 Unity 시험에서는 MA4 최종 커밋을 부모로 둔 별도 커밋에 17 MiB 에셋을 포함했고 고정 PLAN 검사 1/1을 통과했다.
- Editor 경로·버전·Windows 빌드 모듈·패키지 잠금과 검증 원본을 확인한다. 새 시도 디렉터리, 테스트 이름·수·상태·시각, 프로세스 종료, 완전한 로그, BuildReport, 빌드 배포 해시, Player의 일회성 실행 신호를 서로 대조한다. 동일 런타임의 Editor 예약은 하나다. 실패 원인과 이전 시도는 재검사 후에도 남는다.
- 첫 Player 시험은 비활성 창에서 시간 한도를 넘겨 해당 프로세스를 종료했다. 동일 바이너리를 그래픽이 활성화된 배치 모드와 D3D11로 실행해 동작을 확인하고 이 옵션을 자동 검사에 고정했다. smoke는 게임의 점수 획득 메서드와 실제 TextMesh 상태를 확인한다. 마우스 조작, 화면 픽셀 비교, 다른 게임과 다른 플랫폼 수용은 이번 시험 범위 밖이다.

## 재현

동일 PC에서 보존한 MA4 실행과 MA5 결과를 점검하는 명령이다. 저장된 XML의 시각·테스트 목록과 로그, 빌드 전체 파일의 해시를 다시 대조한다.

```powershell
node --import tsx scripts/milestone-unity-poc.mjs d1-ma-parallel-20261126-001 ma5-hud-20261126-004 audit
```

새 PC에서는 [MA4 절차](milestone-parallel-execution.md)로 격리 실행과 통합 브랜치를 먼저 만든다. Editor 6000.3.27f1, 유효한 로컬 라이선스와 Windows Standalone 모듈이 필요하다. 아래에서 `$ma4`는 그 MA4 fixture ID다.

```powershell
$trial='ma5-hud-'+(Get-Date -Format 'yyyyMMdd-HHmmss')
npm.cmd run desktop:verify -- start $ma4
node --import tsx scripts/milestone-unity-poc.mjs $ma4 $trial
npm.cmd run desktop:verify -- stop $ma4
node --import tsx scripts/milestone-unity-replay.mjs $ma4 $trial --execute
node --import tsx scripts/milestone-unity-native-poc.mjs $ma4 ($trial+'-native')
```

`--execute`는 빈 검증 원장에서 배정기가 Editor를 구동하는 시도다. 옵션을 생략하면 이미 검증한 로컬 RPC 결과를 로컬 배정기에 재생한다. 빌드 결과 판정에는 Unity의 BuildReport를 사용한다. [Unity 6000.3 BuildPipeline.BuildPlayer](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/BuildPipeline.BuildPlayer.html)
