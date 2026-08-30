# 연속 던지기 · 잡기 보너스 · 빽도 판정 개선

> `docs/REQUIREMENTS.md` §4("윷/모가 나오면 같은 플레이어가 한 번 더 던진다")와 §5(게이지 확률), §6(잡기)를 확장한다. 지금은 윷/모가 나오면 **말을 이동해야만** 다시 던질 수 있고, 잡기는 추가 던지기를 주지 않으며, 빽도는 게이지 타이밍으로 직접 노릴 수 있는 하나의 구간이다. 이 스펙은 세 가지를 바꾼다: (1) 윷/모는 이동 없이 즉시 재던지기 + 결과를 모아뒀다가 한꺼번에 소진, (2) 잡기도 추가 던지기를 주고 윷/모 보너스와 합쳐 최대 2회 추가(총 3회)로 캡, (3) 빽도는 게이지에서 분리해 표식 가락 기준 25% 확률로 재판정. 곁들여 윷가락 등면에 X 표시를 추가한다.

## 1. 연속 던지기 + "모아놓은 패"

**현재**: 던지기 → 결과 1개(`pendingThrows: Map<sessionId, YutResult>`, 세션당 1개만 저장) → 반드시 그 결과로 말을 이동 → 이동 후 결과가 윷/모였으면 같은 플레이어가 다시 던짐(`nextTurnIndex`가 인덱스를 그대로 유지). 즉 "던지기 → 이동 → (윷/모면) 다시 던지기"가 강제로 번갈아 일어난다.

**변경**: 윷/모가 나오면 **이동하지 않고 바로 다시 던진다.** 결과들은 서버 상태의 `pendingResults` 목록에 순서대로 쌓이고, 더 이상 던질 기회가 없을 때(§2의 예산 소진, 또는 방금 나온 결과가 윷/모가 아닐 때) 플레이어는 쌓인 패 중 원하는 것을 골라 원하는 순서로 말을 이동시킨다.

### 1.1 서버 상태 기계

`gaugePhase`는 지금과 같은 3값(`idle`/`charging`/`resolved`)을 그대로 쓰되 의미가 넓어진다 — `idle`은 "턴의 첫 던지기"뿐 아니라 "윷/모·잡기로 얻은 추가 던지기 차례"에도 재사용된다. `resolved`는 "지금 쓸 수 있는 패가 있어 이동할 차례"를 뜻한다.

`MatchRoom`에 private 필드 2개 추가(클라이언트에 동기화되지 않음, `pendingThrows`/`turnToken`과 같은 성격):

- `extraThrowsGranted: number` — 이번 턴에 지금까지 부여된 추가 던지기 총량. **최대 2**에서 막힌다(더 못 줌). 턴이 다음 사람에게 넘어갈 때 0으로 리셋.
- `throwsOwed: number` — 부여는 됐지만 아직 실행하지 않은 추가 던지기 개수(한 번의 이동에서 잡기 보너스가 최대 2번—§2 참고—겹쳐 나올 수 있어서 큐가 필요하다).

**던지기 결과가 나올 때(`resolveThrowFor`, `throwRelease`와 `autoThrow` 공용):**

1. 결과를 `pendingResults` 끝에 추가(§1.2의 스키마로), `lastThrowResult`도 갱신(윷가락 애니메이션용, 항상 "방금 던진 결과"를 반영).
2. 결과가 `yut` 또는 `mo`이고 `extraThrowsGranted < 2`면: `extraThrowsGranted++`, `throwsOwed++`.
3. `throwsOwed > 0`이면: `throwsOwed--`, `gaugePhase = "idle"`로 되돌려 즉시 다시 던지게 하고 던지기 제한시간을 재무장한다. **이동 단계로 넘어가지 않는다.**
4. 아니면: `gaugePhase = "resolved"`, 말 선택 제한시간 재무장.

**이동이 끝날 때(`performMove`):**

1. `movePiece` 메시지가 지정한 `resultId`에 해당하는 항목을 `pendingResults`에서 제거(§1.2), 말 위치들을 갱신.
2. **승리 판정(`checkWinner`)을 지금처럼 여기서 먼저 확인** — 완주했다면 `phase = "finished"`로 바꾸고 즉시 반환. 남은 패나 부여될 예정이던 보너스 던지기와 무관하게 게임이 끝난다(아래 3~6은 승리하지 않았을 때만 진행).
3. 원래 이동으로 "유효하게"(의사에게 무효화되지 않고, §2.1 참고) 잡힌 말이 있고 `extraThrowsGranted < 2`면: `extraThrowsGranted++`, `throwsOwed++`.
4. 교주 능력 보너스 전진으로 **추가로** "유효하게" 잡힌 말이 있고(§2.1) `extraThrowsGranted < 2`면: 별도로 한 번 더 `extraThrowsGranted++`, `throwsOwed++`(한 번의 `movePiece`에서 최대 2회 부여 가능).
5. `throwsOwed > 0`이면: `throwsOwed--`, `gaugePhase = "idle"`, 던지기 제한시간 재무장, 반환(남은 `pendingResults`는 그대로 대기).
6. 아니고 `pendingResults`가 아직 남아있으면: `gaugePhase`는 `"resolved"` 유지, 말 선택 제한시간 재무장(다음 패 사용을 기다림).
7. 아니면(빈 `pendingResults`, `throwsOwed`도 0): 지금처럼 `nextTurnIndex`로 턴을 넘기고 `extraThrowsGranted`/`throwsOwed`를 0으로 리셋, 다음 사람의 던지기 제한시간 재무장. (`nextTurnIndex`의 윷/모 분기는 이제 항상 거짓이 되므로 — 턴 유지 여부는 이 상태 기계가 전부 처리 — 해당 분기는 삭제하고 인자에서 `result`도 뺀다.)

**`nextTurnIndex`(`turns.ts`) 단순화**: "턴을 유지할지"는 이제 §1.1의 상태 기계(`throwsOwed`/`pendingResults`)가 전부 처리하므로, `nextTurnIndex`가 호출되는 시점(스텝 7)은 항상 "진짜로 다음 사람에게 넘어가는" 경우뿐이다. 기존의 "결과가 윷/모면 같은 인덱스 유지" 분기는 이제 도달 불가능한 죽은 코드가 되므로 삭제하고, 시그니처에서 `result` 인자를 뺀다: `nextTurnIndex(currentIndex: number, order: string[]): number`(항상 `(currentIndex + 1) % order.length`). `turns.test.ts`의 "윷이 나오면 같은 사람 차례가 유지된다"/"모가 나오면 같은 사람 차례가 유지된다" 두 테스트는 이 분기와 함께 삭제한다(대체 불필요 — 턴 유지 여부는 이제 `MatchRoom.test.ts`의 통합 테스트가 검증할 몫).

### 1.2 스키마 (`MatchState.ts`)

```ts
export class PendingResultSchema extends Schema {
  @type("string") id: string = "";       // 서버 발급 안정 id — 같은 결과가 중복 쌓여도 구분 가능
  @type("string") result: string = "";   // YutResult 코드
}

// MatchState 안에 필드 추가
@type([PendingResultSchema]) pendingResults = new ArraySchema<PendingResultSchema>();
```

배열 인덱스가 아니라 `id`를 쓰는 이유: "개"가 두 번 쌓이는 등 같은 결과가 중복될 수 있어서, 클라이언트가 "몇 번째 패를 쓸지" 지정하려면 값이 아니라 안정적인 식별자가 필요하다. `id`는 `MatchRoom` 안의 단순 증가 카운터(`` `p${++this.pendingResultCounter}` `` 형태)로 발급한다.

기존 `lastThrowResult: string` 필드는 그대로 유지(윷가락 애니메이션이 "가장 최근에 던진 결과"를 보여주는 용도) — `pendingResults`와 별개로 계속 갱신된다.

### 1.3 메시지 프로토콜

`movePiece`가 `resultId`를 필수로 받도록 확장:

```ts
{ pieceId: string; resultId: string; useShortcut?: boolean }
```

서버는 `pendingResults`에서 `resultId`와 일치하는 항목을 찾아 그 `result`의 `YUT_STEPS` 값으로 이동을 계산한다. 일치하는 항목이 없으면(클라이언트-서버 상태 불일치, 방어적) 아무 것도 하지 않는다.

**말 선택 제한시간 자동 이동(`autoMove`)**도 같은 규칙: `pendingResults`의 **가장 오래된**(배열의 첫 번째) 항목과 완주하지 않은 첫 번째 말을 골라 자동 이동시킨다.

### 1.4 클라이언트 표시

- `PlayerCorner.tsx` — **현재 턴인 플레이어의 카드에 한해** `pendingResults`를 작은 라벨 배지로 보여준다(예: "개 · 윷 · 모", `YUT_RESULT_LABELS` 재사용). 자기 턴이 아닌 사람도 상대 카드에서 그대로 보인다 — 누가 몇 장을 쌓아놨는지는 공개 정보.
- `TurnPanel.tsx` — `gaugePhase === "resolved"`일 때: `pendingResults`를 나열해 하나를 선택(로컬 state, 기본값은 배열의 첫 항목)하고, 선택된 패에 대해서만 말 선택 버튼을 보여준다. 버튼 클릭 시 `movePiece`에 `{ pieceId, resultId: selected.id, useShortcut }`을 보낸다. 패를 다 쓸 때까지 반복.
- `matchTypes.ts`의 `MatchState` 인터페이스에 `pendingResults: { id: string; result: string }[]` 추가.

## 2. 잡기 보너스 던지기

§1.1에 이미 규칙이 녹아있다 — 별도 상태 기계가 아니라 같은 `extraThrowsGranted`/`throwsOwed` 예산을 공유한다:

- 한 번의 `movePiece`로 상대 말을 잡으면(업혀있던 여러 마리를 한꺼번에 잡아도) **그 이동 자체로 1회** 추가 던지기 부여. **단, 그 이동에 쓰인 결과가 윷/모라면 이 잡기 보너스는 주지 않는다**(2026-08-30 확정) — 윷/모는 이미 그 자체로 추가 던지기를 받으므로(§1.1), 같은 이동으로 잡기까지 성공했다고 겹쳐 주지 않는다. 도/개/걸로 잡을 때만 이 잡기 보너스가 적용된다.
- 그 이동에서 교주 능력 보너스 전진(`applyGyojuBonus`)이 **추가로** 상대 말을 잡으면, 원래 이동의 결과와 무관한 별도의 사건으로 보고 **또 1회** 부여 — 원래 이동이 윷/모였어도 이 교주 보너스 잡기는 예외 없이 지급된다. 한 번의 `movePiece`에서 최대 2회까지 가능.
- 윷/모 보너스와 잡기 보너스는 **하나의 공유 예산**(`extraThrowsGranted`, 최대 2)을 쓴다 — 출처가 섞여도(윷 1번 + 잡기 1번, 잡기 2번, 윷 2번 등) 합쳐서 최대 2회 추가, 즉 **턴당 최대 3회**(첫 던지기 + 추가 2회) 던질 수 있다.
- 추가 던지기는 **그 자리에서 즉시** 실행된다 — 아직 쓰지 않은 `pendingResults`가 남아있어도 먼저 끼어든다(§1.1 "이동이 끝날 때" 스텝 5). 실행 후 남은 패는 그대로 대기열에 남는다.

### 2.1 의사/성직 응답에 따른 보너스 지급 여부 (확정)

`abilities.ts`의 `resolveCaptureResponses`는 잡힘 이후 상대팀 의사/성직 능력으로 결과가 다시 바뀔 수 있다 — 이 결과에 따라 보너스 지급 여부가 갈린다:

- **의사가 성공해서 잡힌 말이 원래 자리로 복원되면(사실상 잡기 무효화)** → 그 캡처는 보너스 지급 대상에서 **제외**한다.
- **성직이 성공해서 잡힌 말이 성직 위치로 순간이동하면** → 잡은 사람에게는 그래도 잡은 것으로 쳐서 **보너스 지급**.
- 둘 다 실패하거나 후보가 없어 잡힌 말이 그대로 `start`로 돌아가면 → 당연히 **보너스 지급**.
- 한 번의 이동으로 여러 마리를 동시에 잡았다면(업기 스택), 그중 **하나라도** 의사에게 무효화되지 않고 살아남으면 그 이동은 보너스 지급 대상.

**`resolveCaptureResponses`의 반환 타입 변경**이 필요하다 — 지금은 `Piece[]`만 반환하지만, 어떤 `pieceId`가 의사에 의해 무효화됐는지(성직 리다이렉트나 무응답은 포함 안 됨) 호출부(`MatchRoom`)가 알아야 한다:

```ts
// abilities.ts
export interface CaptureResponseResult {
  pieces: Piece[];
  /** 의사 능력으로 원위치 복원되어 "사실상 무효화"된 캡처의 pieceId 목록 — 잡기 보너스 던지기 지급 대상에서 뺀다. */
  negatedPieceIds: PieceId[];
}

function resolveOneCapture(pieces: Piece[], capture: CaptureRecord, rng: Rng): { pieces: Piece[]; negated: boolean } {
  const restored = tryUisa(pieces, capture, rng);
  if (restored) return { pieces: restored, negated: true };
  const redirected = trySeongjik(pieces, capture, rng);
  if (redirected) return { pieces: redirected, negated: false };
  return { pieces, negated: false };
}

export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): CaptureResponseResult {
  let result = pieces;
  const negatedPieceIds: PieceId[] = [];
  for (const capture of captures) {
    const outcome = resolveOneCapture(result, capture, rng);
    result = outcome.pieces;
    if (outcome.negated) negatedPieceIds.push(capture.pieceId);
  }
  return { pieces: result, negatedPieceIds };
}
```

`MatchRoom.performMove`의 호출부는 `const { pieces: updated, negatedPieceIds } = resolveCaptureResponses(...)`로 구조분해하고, §1.1 스텝 3/4의 보너스 판정을 다음으로 바꾼다:

- 스텝 3: `mainCaptureRecords.some((c) => !negatedPieceIds.includes(c.pieceId))`이면 부여.
- 스텝 4: `bonusCaptureRecords.some((c) => !negatedPieceIds.includes(c.pieceId))`이면 부여.

**`abilities.test.ts` 영향**: `resolveCaptureResponses`를 직접 호출하는 기존 테스트 12곳 전부 `const result = resolveCaptureResponses(...)` 뒤에 `result.find(...)`를 쓰고 있다 — 반환 타입이 바뀌므로 전부 `const { pieces: result } = resolveCaptureResponses(...)`로 구조분해를 추가해야 한다(변수명 `result`는 유지해 나머지 코드는 그대로 두는 최소 diff). 의사 무효화가 `negatedPieceIds`에 정확히 반영되는지 검증하는 새 테스트도 추가한다.

## 3. 빽도 판정 방식 변경

**현재**: 게이지 파형의 특정 구간(0.75~0.8125, "도" 25% 구간의 앞쪽 1/4)에 타이밍을 맞추면 빽도가 나온다 — 스킬로 노릴 수 있는 구간.

**변경**: 게이지에는 "도" 구간만 남기고(0.75~1.0 전체, 25%), 그 구간에 걸리면 **별도의 순수 확률**로 1/4 확률만큼 빽도로 바뀐다. 확률의 총합은 그대로다(25% × 25% = 6.25%, 기존과 동일) — 다만 타이밍이 아니라 표식 가락이 결정한다.

### 3.1 `server/src/game/gauge.ts`

- `ZONES`에서 `backDo` 항목 삭제, `do`가 `gae`의 `upperBound`(0.75) 바로 다음부터 1.0까지 전체를 차지.
- `resolveThrow`에 `abilities.ts`와 동일한 패턴으로 `rng: Rng = Math.random` 매개변수 추가:

```ts
export function resolveThrow(
  startAtMs: number,
  releaseAtMs: number,
  cycleMs: number = DEFAULT_GAUGE_CYCLE_MS,
  rng: Rng = Math.random,
): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound) ?? ZONES[ZONES.length - 1];
  if (zone.result === "do" && rng() < 0.25) return "backDo";
  return zone.result;
}
```

(`Rng` 타입은 `abilities.ts`에서 가져오거나 `gauge.ts`에 동일하게 재선언 — 순환 참조 피하려면 `type Rng = () => number`를 `gauge.ts`에 독립적으로 선언하는 쪽을 추천.)

- `MatchRoom.ts`의 `throwRelease`/`autoThrow` 두 호출부 모두 `resolveThrow(start, release, cycleMs, this.rng)`로 바꿔 능력 판정과 같은 인스턴스 RNG(테스트에서 결정적 값 주입 가능)를 쓴다.

### 3.2 기존 테스트 수정 (`gauge.test.ts`)

"파형 0.78 지점(빽도 구간)이면 빽도가 나온다" 테스트는 전제가 깨진다 — 그 지점은 이제 "도" zone 안이라 rng 값에 따라 do/backDo 둘 다 나올 수 있다. 결정적 rng를 주입하는 두 테스트로 교체:

```ts
it("도 구간이고 rng<0.25면 빽도가 나온다", () => {
  const elapsed = 0.9 * (cycleMs / 2);
  expect(resolveThrow(0, elapsed, cycleMs, () => 0.1)).toBe("backDo");
});

it("도 구간이고 rng>=0.25면 도가 나온다", () => {
  const elapsed = 0.9 * (cycleMs / 2);
  expect(resolveThrow(0, elapsed, cycleMs, () => 0.5)).toBe("do");
});
```

기존 "파형 0.9 지점(도 구간)이면 도가 나온다" 테스트는 `rng` 인자 없이 호출하면 기본값(`Math.random`)이 쓰여 확률적으로 실패할 수 있으므로, 위 두 테스트로 대체하고 원래 테스트는 삭제한다.

### 3.3 클라이언트 (`gaugeWave.ts`, `GaugeBar.tsx`)

`GAUGE_ZONES`에서 `backDo` 항목 삭제 — `gae`(0.75) 다음 바로 `do`(1.0)로 이어져 게이지 막대에는 5구간만 보인다. 플레이어가 타이밍으로 빽도를 노릴 수 없다는 게 시각적으로도 드러난다.

### 3.4 윷가락 비주얼은 이미 규칙과 일치

`YutSticks.tsx`의 `targetFaces`는 이미 "표식 가락(index 0)만 위로 오면 빽도, 그 외 하나만 위로 오면 도"로 구현돼 있어 **변경이 필요 없다** — 새 판정 방식(표식 가락이 빽도를 결정)과 이미 정확히 일치한다.

## 4. 윷가락 등면 X 표시

착지 후 **등면(둥근 면, `FACE_ROUND`)이 위인 가락에만** X 표시 3개를 세로로 나란히 그린다. Matter.js의 기본 바디 렌더링(단색 채우기)은 텍스트/도형을 얹을 수 없으므로, `Matter.Events.on(render, "afterRender", ...)`로 매 프레임 렌더링 직후 캔버스에 직접 그리는 훅을 추가한다.

```ts
// YutSticks.tsx — settle 이후에만 동작
const settledRef = useRef(false);

Matter.Events.on(render, "afterRender", () => {
  if (!settledRef.current || !result) return;
  const ctx = render.context;
  const faces = targetFaces(result);
  sticks.forEach((stick, i) => {
    if (!faces[i]) return; // 배(FACE_FLAT)면 안 그림 — 등면일 때만
    ctx.save();
    ctx.translate(stick.position.x, stick.position.y);
    ctx.rotate(stick.angle);
    ctx.strokeStyle = "#f5e6c8"; // 갈색(FACE_ROUND) 바탕 위에서 잘 보이는 밝은 선
    ctx.lineWidth = 2;
    for (const dy of [-25, 0, 25]) drawX(ctx, 0, dy, 5);
    ctx.restore();
  });
});

function drawX(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy + r);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx - r, cy + r);
  ctx.stroke();
}
```

`settledRef.current`는 기존 `settleTimeout` 콜백(안착 애니메이션이 끝나는 시점) 안에서 `true`로 세팅한다. `Matter.Events.off`로 언마운트 시 정리(다른 리스너들과 같은 cleanup 블록에 추가).

`YutStaticSticks.tsx`(내 턴이지만 아직 안 던졌을 때 보여주는 정지 일러스트)는 결과가 없어 등/배 자체가 없으므로 변경하지 않는다.

## 5. 기존 테스트에 대한 파급 효과

- `gauge.test.ts`: §3.2에 정리된 대로 빽도 관련 1개 테스트를 결정적 rng 2개 테스트로 교체.
- `turns.test.ts`: §1.1에 정리된 대로 윷/모 관련 2개 테스트를 삭제(대체 불필요).
- `abilities.test.ts`: §2.1에 정리된 대로 `resolveCaptureResponses` 반환 타입 변경으로 기존 호출부 12곳에 구조분해(`const { pieces: result } = ...`) 추가, 의사 무효화가 `negatedPieceIds`에 반영되는지 검증하는 테스트 추가.
- **`MatchRoom.test.ts`(148개 중 상당수가 던지기/이동 흐름을 다룸)**: `movePiece`가 이제 `resultId`를 요구하므로, 기존에 `client.send("movePiece", { pieceId })`처럼 보내던 테스트는 전부 `resultId`를 함께 보내도록 고쳐야 한다. 또한 "윷이 나오면 이동 후 같은 사람이 다시 던진다" 같은 기존 통합 테스트는 이제 "윷이 나오면 이동 없이 바로 재던지기 가능 상태가 된다"로 전제 자체가 바뀌므로 새로 작성해야 한다. 이 파급 범위가 커서, 다음 단계(구현 계획)에서 "기존 테스트 전수 점검 및 재작성"을 별도 태스크로 분리하는 걸 권장한다.

## 6. 범위 밖

- 빽도(-1칸) 자체의 이동/업기/잡기 규칙은 이번 스펙에서 바뀌지 않는다 — 판정 방식(어떻게 빽도가 결정되는가)만 바뀐다.
- 게이지 확률표(REQUIREMENTS.md §5)의 각 결과별 최종 확률은 그대로 유지된다(빽도 6.25%, 도 18.75% 등) — 재분배 없음.
- 잡기 보너스 예산과 윷/모 보너스 예산을 분리해서 표시하는 UI(예: "잡기로 1회, 윷으로 1회"처럼 출처 구분)는 만들지 않는다 — 플레이어에게는 "추가 던지기 가능 여부"만 `gaugePhase`로 드러난다.
