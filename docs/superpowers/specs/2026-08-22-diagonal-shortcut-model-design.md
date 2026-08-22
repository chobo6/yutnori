# 지름길(대각선) 위치 모델 재설계

> 실제 윷판의 대각선 지름길을 정확히 모델링하도록 `server/src/game/position.ts`를 재설계한다. 이 스펙은 실제 윷판 시각화(정사각형 트랙 + 캐릭터 표시된 말)의 선행 작업이며, 시각화 자체는 이 스펙의 범위 밖이다.

## 0. 배경 — 왜 지금 다시 여는가

`CLAUDE.md`에 이미 다음과 같이 기록되어 있었다:

> `server/src/game/position.ts`의 지름길 모델은 실제 윷놀이판을 그대로 구현한 게 아니라 의도적으로 단순화한 것이다: 5/10/15번 코너 어디서든 지름길을 타면 "1칸=중앙, 2칸 이상=바로 완주"로 동일하게 처리한다... 재검토가 필요해지면 `position.ts` 파일 하나만 고치면 되도록 격리되어 있다.

사용자가 실제 윷판 모양대로 클라이언트를 그려달라고 요청하면서, 그 그림의 전제가 되는 서버 규칙 자체를 실제 윷판과 맞게 고쳐달라고 확인했다(이 문서 작성 직전 대화에서 "1번부터 정식 브레인스토밍으로 진행" 확정).

## 1. 조사한 실제 윷판 구조

웹 검색(한국어 위키백과 등)으로 확인한 실제 전통 윷판 구조:

- 정사각형 판, 가로/세로 각 변에 눈금이 있고 두 대각선이 중앙("방", 흔히 "북극성")에서 교차.
- 전체 자리 수: 바깥 둘레 20자리(모서리 4개 포함) + 대각선 중간자리 8개 + 중앙 1개 = **29자리**.
- 대각선은 4개의 "팔"로 나뉜다(모서리마다 하나씩 — 5번/10번/15번/출발점 쪽 모서리). 각 팔은 **모서리→중간칸→중간칸→중앙**으로 대칭적으로 **3칸**이다(8개 중간자리 ÷ 4팔 = 팔당 2개의 중간자리).
- 즉 모서리 아무 곳에서 지름길을 타도 중앙까지는 동일하게 3칸, 중앙에서 도착(출발점 모서리)까지도 동일하게 3칸 — **모서리별 지름길 길이는 대칭**이다(어느 모서리가 "더 강하다"는 속설은 지름길 길이 차이가 아니라, 바깥길로 돌아가는 거리와 지름길 거리의 차이에서 오는 상대적 이득 차이로 보인다 — 이 스펙에서 별도로 구현할 필요 없는, 대칭적인 규칙의 자연스러운 결과).
- **출발점 모서리(바깥 20번째/0번째 자리)에는 별도의 지름길 진입점이 필요 없다** — 말이 게임 중 그 자리에 "멈춰 서는" 일이 없기 때문(대기 상태에서 보드에 진입할 때는 1~5칸 사이 어딘가로 바로 등장하고, 완주할 때는 19번을 넘어가는 순간 바로 `finished`로 처리되어 그 모서리 자체를 밟고 지나가지 않는다). 따라서 기존 코드의 `SHORTCUT_JUNCTIONS = {5, 10, 15}`(3개)는 그대로 유지한다 — 4개로 늘릴 필요 없음.

## 2. 확정된 설계 결정

- **중앙을 지난 뒤에는 선택지 없이 항상 도착 방향으로만 자동 진행한다** (사용자 확인). 중앙에서 "어느 팔로 나갈지" 고르는 실제 규칙의 세부사항은 구현하지 않는다 — 지름길에 올라탄 이상 경로는 결정론적이다.
- **접근법 A 채택**: `Position`에 `shortcutIn`(모서리→중앙 구간)과 `shortcutOut`(중앙→도착 구간) 두 종류를 추가한다. 기존 `center`는 그대로 유지(다른 파일들이 이미 `kind === "center"`로 참조 중이므로 건드리지 않음). 평탄화(B안)나 그래프 일반화(C안)는 각각 기존 코드 침습성/과설계 이유로 기각.

## 3. 데이터 모델

`server/src/game/position.ts`:

```ts
export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "shortcutIn"; junction: 5 | 10 | 15; step: 1 | 2 }
  | { kind: "center" }
  | { kind: "shortcutOut"; step: 1 | 2 }
  | { kind: "finished" };
```

- `shortcutIn`의 `step`은 모서리에서 몇 칸 들어왔는지(1 또는 2) — `step`이 3이 되면 곧 `center`로 취급(별도 `step:3` 값은 존재하지 않고 바로 `center` kind로 전환).
- `shortcutOut`의 `step`도 마찬가지로 1 또는 2 — 3이 되면 `finished`로 전환.
- `shortcutIn`에 `junction`이 있는 이유: 서로 다른 모서리에서 탄 두 말은(둘 다 "1칸째"여도) 같은 칸이 아니다 — 업기/잡기 판정(§4)에 필요.
- `shortcutOut`에는 `junction`이 없다 — 중앙을 지나면 모든 경로가 동일한 도착 팔로 합쳐지므로, 어느 모서리에서 지름길을 탔든 `shortcutOut` 상태부터는 완전히 같은 칸을 공유한다.

## 4. 이동 로직

`moveForward(from, steps, useShortcut)` — 시그니처는 변경하지 않는다(기존 호출부인 `pieces.ts`가 그대로 사용 가능).

전체 지름길 경로를 **모서리를 절대값 0으로 하는 6칸짜리 트랙**으로 놓고 계산한다 — 이 절대값을 아래 모든 경우에서 동일하게 사용한다(기준점을 바꾸지 않는다):

| 절대값 | 의미 |
|---|---|
| 0 | 모서리(`outer`, index 5/10/15) |
| 1, 2 | `shortcutIn` step 1, 2 |
| 3 | `center` |
| 4, 5 | `shortcutOut` step 1, 2 |
| 6 이상 | `finished` |

각 케이스에서 "지금 위치의 절대값"을 구하고, `steps`를 더한 새 절대값을 위 표로 다시 변환하면 된다:

- **모서리(`outer`, index가 5/10/15)에서 `useShortcut=true`로 이동**: 현재 절대값 0. 새 절대값 = `0 + steps` = `steps`(1~5 범위이므로 6 이상이 될 수 없음). 표에서 변환: 1~2면 `shortcutIn`(해당 junction, step=새 절대값), 3이면 `center`, 4~5면 `shortcutOut`(step = 새 절대값 − 3).
- **`shortcutIn`(junction, step)에서 이동** — 이 상태는 항상 선택 없이 자동 진행 중이므로 `useShortcut` 인자는 무시(시그니처는 유지하되 내부에서 사용하지 않는다): 현재 절대값 = `step`. 새 절대값 = `step + steps`. 표에서 변환(junction은 `shortcutIn`으로 남는 경우에만 그대로 유지, `shortcutOut`/`finished`가 되면 junction 정보는 버림).
- **`center`에서 이동**: 현재 절대값 3(고정). 새 절대값 = `3 + steps`. `useShortcut` 인자는 의미 없음(중앙에서는 선택지가 없으므로 도착 방향 경로만 사용) — 표에서 변환하면 항상 4 이상이므로 `shortcutOut` 또는 `finished`만 나온다(3+1=4, 3+2=5, 3+3=6 이상 → `finished`).
- **`shortcutOut`(step)에서 이동**: 현재 절대값 = `3 + step`(4 또는 5). 새 절대값 = `3 + step + steps`. 표에서 변환.
- **`outer`(지름길 아닌 일반 이동, `useShortcut=false`이거나 junction이 아닌 칸)**: 기존 로직 그대로(변경 없음) — `startIndex + steps`가 19 초과면 `finished`, 아니면 `outer`.
- **`start`에서 이동**: 기존과 동일 — `outer` index = steps(1~5 범위이므로 지름길 모서리에 직접 등장할 일은 없음 — 5는 정확히 도달 가능하지만, 그건 "출발 직후 5번 칸에 도착"이지 "지름길을 타는 중"이 아니므로 그냥 `outer` index=5).

**검증 예시** (모서리에서 지름길로 5칸(모) 이동): 절대값 0+5=5 → 표에서 4~5 구간 → `shortcutOut` step = 5−3 = 2. (중앙에서 3칸(걸) 이동): 절대값 3+3=6 → `finished`.

## 5. 업기/잡기 (`pieces.ts`의 `samePosition`)

```ts
export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  return false;
}
```

`start`/`finished`는 기존과 동일하게 절대 "같은 칸"으로 취급하지 않는다(이미 그런 동작이며 변경 없음). 업기/잡기 판정 로직 자체(`applyMove`)는 이 `samePosition`을 그대로 재사용하므로 별도 수정이 필요 없다 — 지름길 칸 위에서도 바깥 칸과 동일한 규칙(업기는 주인 기준, 잡기는 팀 기준)이 자동으로 적용된다.

## 6. 서버 상태 인코딩 (`MatchState.ts`)

기존 `PieceSchema`는 `positionKind: string`, `positionIndex: number` 두 필드로 `Position`을 표현해왔다(`toSchemaPosition`/`fromSchemaPosition` 왕복 변환). 새 필드를 추가하지 않고 이 2필드 방식을 재사용한다:

- `shortcutIn`: `positionKind`를 `"shortcutIn5"` / `"shortcutIn10"` / `"shortcutIn15"` 중 하나로(junction을 kind 문자열에 인코딩), `positionIndex`에 `step`(1 또는 2) 저장.
- `shortcutOut`: `positionKind = "shortcutOut"`, `positionIndex`에 `step`(1 또는 2).
- `center`/`outer`/`start`/`finished`는 기존 인코딩 그대로.

`toSchemaPosition`/`fromSchemaPosition`(둘 다 `MatchState.ts`에 위치)을 이 규칙에 맞게 확장한다.

## 7. 영향받지 않는 부분 (변경 불필요, 명시적으로 확인)

- **`abilities.ts`**: `sideOf`가 `outer` 이외의 모든 kind에 대해 `null`을 반환하는 기존 동작 그대로 — `shortcutIn`/`shortcutOut`도 "어느 줄에도 속하지 않음"으로 자연히 처리된다(이미 `center`/`start`/`finished`가 그렇게 처리되던 것과 동일한 분기).
- **`moveBackward`(빽도)**: `previousPosition`을 그대로 반환하는 범용 로직이라 새 kind들에도 자동으로 대응.
- **`client/src/components/TurnPanel.tsx`**: "지름길 사용" 체크박스를 보여주는 조건(모서리에 있을 때만)은 변경 없음 — 지름길에 이미 올라탄 말은 선택지가 없으므로(§2) 체크박스 자체가 뜰 일이 없다.
- **`MatchRoom.ts`의 `performMove`/능력 파이프라인**: `Piece.position`이 어떤 kind든 캡처/업기/능력 로직이 `samePosition`과 `sideOf`를 통해서만 위치를 비교하므로, 이 두 함수가 새 kind를 올바르게 처리하는 한 상위 로직은 수정 불필요.
- **클라이언트 보드 시각화(`GameBoard.tsx`)**: 새 kind를 실제 좌표에 그리는 작업은 이번 스펙의 범위 밖(후속 스펙에서 다룸) — 다만 `client/src/game/matchTypes.ts`의 `PositionKind`/`PieceState` 타입은 서버 스키마를 손으로 미러링하는 기존 관례상 새 kind 문자열들을 인식하도록 갱신이 필요하다(타입 정합성만 맞추는 최소 변경, 실제 렌더링 로직은 후속 스펙).

## 8. 테스트 전략

`server/src/game/position.test.ts`(TDD): 각 모서리(5/10/15)에서 도/개/걸/윷/모(1~5칸)로 지름길을 탈 때의 결과, `shortcutIn`에서 계속 진행할 때의 결과, `center`에서 진행할 때의 결과, `shortcutOut`에서 완주까지의 결과, 서로 다른 모서리에서 탄 두 말이 "다른 칸"으로 판정되는 경우를 모두 커버.

`server/src/game/pieces.test.ts`: 지름길 칸 위에서의 업기(같은 모서리+같은 step) / 잡기(팀 기준) 시나리오 추가.

`server/src/rooms/MatchState.test.ts`: `toSchemaPosition`/`fromSchemaPosition` 왕복 변환에 새 kind들 추가.

기존 테스트 중 "지름길 타면 1칸=center, 2칸 이상=finished"를 가정하던 것들은 새 규칙(3칸=center, 6칸=finished)에 맞게 고친다 — 이는 의도된 동작 변경이므로 기존 테스트 값을 그대로 유지하는 게 아니라 새 정답으로 갱신하는 것이 맞다.

## 9. 이번 범위에서 제외하는 것

- 중앙에서 나가는 방향 선택(§2에서 확정 — 항상 자동으로 도착 방향).
- 출발점 모서리 자체의 지름길 진입점(§1에서 불필요함을 확인).
- 실제 보드 시각화(정사각형 트랙 그리기, 말에 캐릭터 표시) — 이 스펙이 끝난 뒤 별도 스펙으로 진행.
