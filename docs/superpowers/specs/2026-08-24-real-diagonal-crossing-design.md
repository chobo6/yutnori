# 지름길 대각선 재설계 — 5↔15번 실제 교차 모델

> 기존 `docs/superpowers/specs/2026-08-22-diagonal-shortcut-model-design.md`가 확정한 "지름길은 어느 모서리에서 타든 중앙을 지나면 항상 출발점 방향으로만 진행한다"는 단순화 모델을, 실제 윷판처럼 **5번↔15번이 진짜로 교차하는 대각선**으로 재설계한다. 10번과 15번은 기존과 동일하게 완주(출발점) 방향을 유지한다(§0에서 그 이유 설명).

## 0. 배경 — 왜 지금 다시 여는가

이동 애니메이션(칸을 하나씩 거쳐가는 hop 연출)이 추가되면서, 사용자가 5번 모서리에서 지름길을 타는 말이 "3칸으로 중앙 도착 → 남은 칸은 그대로 출발점 방향으로 꺾여서" 이동하는 걸 직접 보고, 실제 윷판과 다르다는 걸 알아챘다. 실제 윷판은 정사각형의 두 대각선(5번↔15번, 10번↔출발점)이 중앙에서 교차하는 구조라서, 5번에서 탄 지름길은 15번 쪽으로 나가야 자연스럽다.

**중요한 확인 사항(사용자와 합의 완료)**: 5번↔15번을 진짜 교차로 만들면, 반대 방향(15번에서 타서 5번으로 가는 경우)은 완주에서 오히려 훨씬 멀어지는 나쁜 수가 된다 — 15번은 바깥길로 완주까지 5칸밖에 안 남은 자리라, 거기서 5번으로 떨어지면 다시 14칸을 더 가야 한다. 이건 실제 윷놀이의 정상적인 전략적 긴장(불리하면 지름길 체크박스를 안 누르면 됨)이지만, 사용자는 **15번만 예외 처리해서 항상 완주 방향으로 유지**하기로 결정했다. 즉:

- **5번**에서 지름길을 타면 → 15번 쪽으로 진짜 교차(신규 동작).
- **10번**에서 지름길을 타면 → 기존과 동일하게 완주 방향(변경 없음, 애초에 10번의 대각선 파트너가 출발점이므로 실제 모델과 결과가 같다).
- **15번**에서 지름길을 타면 → **예외적으로** 기존과 동일하게 완주 방향(진짜 모델이라면 5번으로 가야 하지만, 사용자가 명시적으로 이 경우만 옛 동작 유지를 선택).

## 1. 데이터 모델

`server/src/game/position.ts`:

```ts
export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "shortcutIn"; junction: 5 | 10 | 15; step: 1 | 2 }   // 변경 없음
  | { kind: "center"; exitVia: "finish" | "cross" }               // exitVia 필드 신규 추가
  | { kind: "shortcutOut"; step: 1 | 2 }                          // 변경 없음 — 완주 방향
  | { kind: "shortcutCross"; step: 1 | 2 }                        // 신규 — 5→15 교차 구간 전용
  | { kind: "finished" };
```

- `center.exitVia`: 이 말이 중앙에 "멈춰 서 있는" 상태에서 다음에 어느 트랙으로 이어갈지 기억해야 한다 — 물리적으로는 항상 같은 한 칸이지만(업기/잡기 판정에는 영향 없음, §5 참고), 다음 이동의 경로 계산에는 반드시 필요하다. `"finish"` = 10번 또는 15번(예외)에서 진입해 완주 방향으로 이어감, `"cross"` = 5번에서 진입해 15번 쪽으로 이어감.
- `shortcutCross`: 물리적으로는 `shortcutIn(junction:15, ·)`와 **같은 2칸**(15번 모서리와 중앙 사이)이지만, 진행 방향이 반대(중앙→15번 바깥쪽 vs 15번→중앙 안쪽)라서 별도 kind가 필요하다. `step`은 `shortcutIn`과 동일한 컨벤션(1=모서리에 가까움, 2=중앙에 가까움)을 따른다.
- `shortcutCross`에서 한 칸 더(절대값 6) 이동하면 `outer(index: 15)`로 착지한다 — 그 이후는 평범한 바깥길 이동이며 5번에서 탔었다는 정보는 더 이상 필요 없다(그냥 15번을 밟고 지나가는 보통 말과 동일하게 취급).

## 2. 이동 로직 (`moveForward`)

기존과 같은 "모서리를 절대값 0으로 하는 트랙" 계산 방식을 유지하되, **시작 모서리에 따라 절대값 4 이상 구간의 해석이 갈린다**:

| 절대값 | 5번에서 진입("cross" 트랙) | 10번/15번에서 진입("finish" 트랙, 기존과 동일) |
|---|---|---|
| 0 | `outer(5)` | `outer(10)` 또는 `outer(15)` |
| 1, 2 | `shortcutIn(junction:5, step)` | `shortcutIn(junction:10\|15, step)` |
| 3 | `center(exitVia:"cross")` | `center(exitVia:"finish")` |
| 4, 5 | `shortcutCross(step = 절대값−3)` | `shortcutOut(step = 절대값−3)` |
| 6 | `outer(index: 15)` | `finished` |
| 6 초과 | `outer(15 + (절대값−6))`, 19 초과 시 `finished` | 6과 동일하게 `finished`(기존 `shortcutPositionFromAbsolute`가 절대값 6 이상을 모두 `finished`로 묶어 처리하는 동작 그대로 — 별도 오버플로 계산 불필요) |

각 위치에서 "계속 이동"할 때는 자신이 이미 올라탄 트랙("cross" vs "finish")을 그대로 따라간다:

- **`shortcutIn(junction, step)`에서 이동**: `junction === 5`면 위 표의 "cross" 열을 따라 계산(현재 절대값 = `step`), 아니면(`junction === 10 | 15`) "finish" 열을 따라 계산. `useShortcut` 인자는 기존과 동일하게 무시(이미 지름길에 올라탄 이상 선택지가 없음).
- **`center(exitVia)`에서 이동**: `exitVia === "cross"`면 "cross" 열(현재 절대값 3 고정), 아니면 "finish" 열.
- **`shortcutCross(step)`에서 이동**: 항상 "cross" 열(현재 절대값 = `3 + step`).
- **`shortcutOut(step)`에서 이동**: 항상 "finish" 열(현재 절대값 = `3 + step`) — 변경 없음.
- **`outer`(지름길 진입 조건 미충족 또는 `useShortcut=false`)**: 기존 로직 그대로 — 변경 없음.
- **`start`에서 이동**: 기존과 동일 — 변경 없음.

**검증 예시**:
- 5번에서 윷(4칸): 절대값 0+4=4 → `shortcutCross(step=1)`.
- 5번에서 모(5칸) 두 번 연속(턴에 쌓인 패 2장을 같은 말에 순서대로 적용, 5+5=10칸 상당): 첫 모로 절대값 5(`shortcutCross(step=2)`) → 둘째 모(5칸)로 절대값 5+5=10 → "cross" 열 6 초과 구간: `outer(15 + (10−6))` = `outer(19)`.
- 15번에서 모(5칸): 절대값 0+5=5 → `shortcutOut(step=2)` (기존과 동일, 예외 처리 확인).

## 3. 업기/잡기 (`pieces.ts`의 `samePosition`)

```ts
export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true; // exitVia는 물리적 위치와 무관 — 비교하지 않는다
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  if (a.kind === "shortcutCross" && b.kind === "shortcutCross") return a.step === b.step; // 신규
  return false;
}
```

`center` 비교에서 `exitVia`를 무시하는 이유: 서로 다른 모서리에서 진입한 두 말이 우연히 둘 다 정확히 중앙에 멈춰 서면(예: 한 말은 5번에서 걸(3칸)로, 다른 말은 10번에서 걸(3칸)로) `exitVia`는 각각 `"cross"`/`"finish"`로 다르지만 물리적으로는 같은 칸이므로 업기(같은 주인) 또는 잡기(다른 팀) 판정이 정상 발동해야 한다. 업기가 발동하면 두 말은 하나의 그룹으로 함께 이동하게 되는데, 이때 그룹 전체의 다음 경로는 **실제로 이동을 트리거한 말(mover)의 `exitVia`**를 따른다 — 업혀서 딸려온 말의 원래 `exitVia`는 이동 결과 어차피 같은 새 위치로 덮어써지므로 별도 처리가 필요 없다(`applyMove`가 이미 이런 방식으로 동작 중).

`shortcutIn`끼리는 `junction`까지 비교하므로, `shortcutIn(junction:15,·)`(15번 직접 진입, "finish" 트랙)와 `shortcutCross(·)`(5번에서 건너온, 물리적으로 같은 칸)는 **kind 자체가 다르므로 자동으로 "다른 칸" 취급**된다 — 이게 맞는 동작인지 §6에서 다시 짚는다.

## 4. 서버 상태 인코딩 (`MatchState.ts`)

기존 `positionKind: string` + `positionIndex: number` 2필드 방식을 그대로 재사용(스키마 필드 추가 없음):

- `center(exitVia:"finish")` → `positionKind = "center"`(기존과 동일, 하위 호환)
- `center(exitVia:"cross")` → `positionKind = "centerCross"`(신규)
- `shortcutCross(step)` → `positionKind = "shortcutCross"`, `positionIndex = step`

`toSchemaPosition`/`fromSchemaPosition`을 이 규칙에 맞게 확장한다.

## 5. 클라이언트 미러링

- **`client/src/game/matchTypes.ts`**: `PositionKind`에 `"centerCross"`, `"shortcutCross"` 추가.
- **`client/src/game/boardCoords.ts`**: `shortcutCrossCoords(step)` 함수 추가 — `lerp(CENTER, CORNERS[JUNCTION_CORNER[15]], step / 3)`(기존 `shortcutInCoords(15, step)`와 정확히 대칭되는 보간, 실제로 물리적으로 같은 두 칸을 가리키므로 좌표 계산도 대칭이어야 함). `positionToCoords`의 `switch`에 `"centerCross"`(→`CENTER`, `"center"`와 동일 좌표) / `"shortcutCross"`(→ 위 함수) 케이스 추가.
- **`client/src/game/movePath.ts`**: `stepForwardOnce`에 동일한 "cross" vs "finish" 트랙 분기 추가 — 서버 §2의 표를 그대로 미러링. 이동 애니메이션(`usePieceAnimations.ts`)은 이 함수를 그대로 재사용하므로 별도 수정 불필요.
- **`client/src/components/TurnPanel.tsx`**: `positionDescription`의 `switch`가 `PositionKind`를 exhaustive하게 처리하고 있어(현재 `PositionKind`가 바뀌면 TS 컴파일 에러로 드러남), `"centerCross"` → `"중앙"`(기존 `"center"`와 같은 문구), `"shortcutCross"` → `` `15번 지름길(교차) ${index}칸` `` 같은 라벨 케이스 추가 필요.

## 6. 영향받지 않는 부분 / 확인이 필요한 기존 코드

- **`sideOf`(같은 줄 판정)**: `outer` 이외 모든 kind에 `null`을 반환하는 기존 동작 그대로 — `centerCross`/`shortcutCross`도 자연히 "어느 줄에도 속하지 않음"으로 처리됨. 수정 불필요.
- **`moveBackward`(빽도)**: `previousPosition`을 그대로 반환하는 범용 로직이라 새 kind에도 자동 대응. 수정 불필요.
- **`abilities.ts`의 `onBoard()`**: 현재 `"outer" | "center" | "shortcutIn" | "shortcutOut"`만 "보드 위"로 인정하고 있다 — **`"shortcutCross"`를 여기에 추가해야 한다**, 안 그러면 5번 교차 구간에 있는 말이 교주 보너스 전진(§3.1) 판정에서 "보드 밖" 취급되어 보너스가 발동하지 않는 버그가 생긴다. `"center"`는 이미 있으므로 `exitVia`와 무관하게(문자열 kind가 `"center"`로 동일) 자동으로 커버된다.
- **`TurnPanel.tsx`의 "지름길 사용" 체크박스 조건**: `positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(positionIndex)` — 변경 없음(모서리에 있을 때만 뜨는 조건 자체는 그대로).
- **§3에서 짚은 "shortcutIn(15) vs shortcutCross가 물리적으로 같은 칸인데 kind가 달라 다른 칸 취급되는 문제"**: 실제로는 이 둘이 "같은 칸"으로 취급돼야 업기/잡기가 자연스럽다(예: 5번에서 건너온 말과 15번에서 막 진입한 말이 물리적으로 같은 칸에서 마주치면 상호작용해야 함). 하지만 이번 스펙에서는 **의도적으로 범위 밖으로 뺀다** — 이 상호작용이 발생하려면 두 말이 정확히 같은 칸(같은 step)에서 만나야 하는 드문 경우이고, 잘못 다뤄도 "업기/잡기가 안 되는" 정도의 영향(크래시나 잘못된 이동 없음)이라 안전하다. 실제 플레이테스트에서 문제가 되면 별도 스펙으로 재검토한다(기존 15번 밸런스 이슈와 같은 패턴).

## 7. 테스트 전략

`server/src/game/position.test.ts`:
- 5번에서 도/개/걸/윷/모(1~5칸) 지름길 — §2 표의 "cross" 열대로 결과 확인.
- 이미 `shortcutCross`/`center(exitVia:"cross")`에 있는 말이 이어서 이동하는 경우(체인/여러 패 적용) — 6칸째에 정확히 `outer(15)` 도착, 6칸 초과 시 15번 이후로 정상 전진하는 경우까지.
- 10번/15번 지름길은 **기존 테스트 값 그대로 유지**(회귀 확인 — 이번 재설계로 값이 안 바뀌어야 함).
- `samePosition`에 `shortcutCross`끼리 비교하는 케이스 추가.

`server/src/rooms/MatchState.test.ts`: `toSchemaPosition`/`fromSchemaPosition` 왕복 변환에 `centerCross`/`shortcutCross` 추가.

`server/src/game/abilities.test.ts`: `onBoard()`가 `shortcutCross` 위치를 "보드 위"로 인정하는지 확인하는 케이스 추가(교주 보너스가 이 위치에서도 정상 판정되는지).

클라이언트: `npm run build`로 타입체크(특히 `TurnPanel.tsx`의 exhaustive switch가 새 kind를 다 처리하는지는 컴파일러가 강제해줌). 브라우저로 5번 모서리에서 지름길을 태워 15번으로 건너가는 이동 애니메이션이 올바른 좌표로 그려지는지 실제 확인.

## 8. 이번 범위에서 제외하는 것

- 15번에서 5번으로의 진짜 교차(§0에서 사용자가 명시적으로 예외 처리를 선택 — 재검토가 필요해지면 별도 브레인스토밍).
- `shortcutIn(15,·)`와 `shortcutCross(·)`가 물리적으로 같은 칸인데 다른 칸으로 취급되는 문제(§6에서 안전하다고 판단, 실제 문제 되면 재검토).
- 10번 지름길의 실제 모델 재검토 — 10번의 대각선 파트너가 원래부터 출발점(완주 방향)이라 기존 동작과 결과가 이미 동일하므로 변경 자체가 필요 없음.
