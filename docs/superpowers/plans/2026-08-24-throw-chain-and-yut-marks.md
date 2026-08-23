# 연속 던지기 · 잡기 보너스 · 빽도 판정 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 윷/모는 이동 없이 즉시 재던지기 + 결과를 모아뒀다가 원하는 순서로 소진, 잡기도 추가 던지기를 주고 윷/모 보너스와 합쳐 최대 2회 추가(턴당 총 3회)로 캡, 빽도는 게이지 타이밍에서 분리해 표식 가락 기준 25% 확률로 재판정, 윷가락 등면에 X 표시를 추가한다.

**Architecture:** 서버(`MatchRoom`)의 `gaugePhase` 상태 기계에 "부여됐지만 아직 실행 안 한 추가 던지기"(`throwsOwed`)와 "이번 턴 누적 추가 던지기 총량"(`extraThrowsGranted`, 최대 2)이라는 두 private 카운터를 더해, 윷/모·잡기 두 트리거를 하나의 예산으로 통합한다. 아직 쓰지 않은 던지기 결과들은 `MatchState.pendingResults`(안정적 id가 붙은 목록)에 쌓이고, 클라이언트는 그 목록에서 하나를 골라 `movePiece`에 `resultId`로 지정해 소진한다. 빽도 판정은 게이지 zone에서 분리해 `resolveThrow`에 주입 가능한 `Rng`로 재구현하고, "잡기가 의사에게 무효화됐는지"는 `abilities.ts`의 새 순수 함수로 분리해 유닛 테스트로 검증한다.

**Tech Stack:** Node + TypeScript + Colyseus(`@colyseus/schema`), Vitest(서버), React 19 + TypeScript(클라이언트, 테스트 프레임워크 없음), Matter.js(윷가락 물리 연출).

**Spec:** `docs/superpowers/specs/2026-08-24-throw-chain-and-yut-marks-design.md`

## Global Constraints

- **서버 순수 게임 로직은 TDD로**(기존 관례) — `server/src/game/*`의 함수는 테스트 먼저 작성.
- **client에는 자동화 테스트 프레임워크가 없다** — client 태스크의 검증은 `cd client && npm run build`(타입체크) + 마지막 통합 태스크의 실제 브라우저 확인으로 한다.
- **추가 던지기 예산은 턴당 최대 2회(첫 던지기 포함 총 3회)** — 출처(윷/모, 잡기, 교주 보너스 잡기)가 섞여도 하나의 카운터(`extraThrowsGranted`)로 합산.
- **의사가 잡기를 무효화하면 보너스 던지기를 주지 않는다. 성직이 리다이렉트하면 보너스 던지기는 그대로 준다.**
- **`movePiece` 메시지는 이제 `resultId`를 필수로 받는다** — `{ pieceId: string; resultId: string; useShortcut?: boolean }`.
- **게이지 타이밍 테스트는 항상 안전한 고정 경과시간을 써서 결과 zone을 확정한다** — 기본 `flush()`(약 50ms)는 "윷" zone(0.0625~0.125)에 걸려 매번 결과가 달라지므로, 아래 다섯 값을 재사용한다(`DEFAULT_GAUGE_CYCLE_MS=1500` 기준):
  - `MO_ELAPSED_MS = 22` (모)
  - `YUT_ELAPSED_MS = 75` (윷)
  - `GEOL_ELAPSED_MS = 188` (걸)
  - `GAE_ELAPSED_MS = 375` (개, 기본으로 쓸 "안전한 아무 결과")
  - `DO_ELAPSED_MS = 675` (도)
- 커밋 메시지는 한국어, `feat:`/`fix:` 같은 프리픽스 없이.

---

### Task 1: 빽도 판정 방식 변경 (게이지 zone 분리 + rng 기반 재판정)

**Files:**
- Modify: `server/src/game/gauge.ts`
- Modify: `server/src/game/gauge.test.ts`
- Modify: `client/src/game/gaugeWave.ts`
- Modify: `client/src/components/GaugeBar.tsx` (변경 불필요 확인만 — `GAUGE_ZONES` 순회 렌더링이라 자동으로 5구간이 됨)

**Interfaces:**
- Produces: `export type Rng = () => number`(`gauge.ts`, 신규), `resolveThrow(startAtMs: number, releaseAtMs: number, cycleMs?: number, rng?: Rng): YutResult`(rng 매개변수 추가, 기본값 `Math.random`).

- [ ] **Step 1: 기존 빽도 테스트를 결정적 rng 테스트로 교체 — 실패하는 테스트 작성**

`server/src/game/gauge.test.ts`의 "파형 0.78 지점(빽도 구간)이면 빽도가 나온다" 테스트(현재 44-47번째 줄)를 삭제하고 다음 두 테스트로 교체:

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

파일 맨 위 주석(19-20번째 줄 근처)의 zone 경계 설명도 갱신: `// 경계: [0,.0625)모 [.0625,.125)윷 [.125,.375)걸 [.375,.75)개 [.75,1.0)도(rng<0.25면 빽도로 재판정)`.

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/gauge.test.ts`
Expected: FAIL — `resolveThrow`가 아직 4번째 인자를 받지 않고, 0.78 지점은 여전히 zone 자체에서 backDo를 반환하지 않음(0.9 지점 테스트도 `rng` 인자를 무시하므로 아직 은 통과하지만, 0.78 관련 옛 테스트가 없어졌으니 새 두 테스트가 실패).

- [ ] **Step 3: `gauge.ts` 구현**

`server/src/game/gauge.ts` 전체를 다음으로 교체:

```ts
export type YutResult = "backDo" | "do" | "gae" | "geol" | "yut" | "mo";

export const YUT_STEPS: Record<YutResult, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};

export const GRANTS_EXTRA_THROW: ReadonlySet<YutResult> = new Set(["yut", "mo"]);

export const DEFAULT_GAUGE_CYCLE_MS = 1500;

/** [0, 1) 범위의 난수를 반환하는 함수. 테스트에서 결정적 값을 주입하기 위한 타입 — abilities.ts의 Rng와 동일한 모양. */
export type Rng = () => number;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. */
export function wavePosition(elapsedMs: number, cycleMs: number): number {
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// REQUIREMENTS.md §5: 모 6.25% / 윷 6.25% / 걸 25% / 개 37.5% / 빽도 6.25% / 도 18.75%
// 빽도는 게이지 zone이 아니라 "도" zone에 걸린 뒤 별도의 순수 확률(1/4)로 재판정한다
// (2026-08-24 변경 — 표식 가락이 결정, 타이밍으로 노릴 수 없음). "도" zone 자체는
// 0.75~1.0 전체(25%)를 차지하고, 그중 25%(=전체의 6.25%)가 빽도로 바뀐다.
const ZONES: Array<{ upperBound: number; result: YutResult }> = [
  { upperBound: 0.0625, result: "mo" },
  { upperBound: 0.125, result: "yut" },
  { upperBound: 0.375, result: "geol" },
  { upperBound: 0.75, result: "gae" },
  { upperBound: 1.0, result: "do" },
];

const BACK_DO_CHANCE = 0.25;

export function resolveThrow(
  startAtMs: number,
  releaseAtMs: number,
  cycleMs: number = DEFAULT_GAUGE_CYCLE_MS,
  rng: Rng = Math.random,
): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound) ?? ZONES[ZONES.length - 1];
  if (zone.result === "do" && rng() < BACK_DO_CHANCE) return "backDo";
  return zone.result;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/gauge.test.ts`
Expected: PASS (전체 — wavePosition 3개 + resolveThrow 6개, 기존 "0.9 지점이면 도" 테스트도 `rng` 기본값이 `Math.random`이라 통과하되, 이 테스트는 결정성이 없으니 `rng` 없이 호출해도 되는지 확인만 하는 용도로 그대로 둔다).

- [ ] **Step 5: 클라이언트 게이지 zone에서 빽도 제거**

`client/src/game/gaugeWave.ts`의 `GAUGE_ZONES` 배열(26-33번째 줄)을 다음으로 교체:

```ts
// server/src/game/gauge.ts의 ZONES와 순서/경계값 동일 (REQUIREMENTS.md §5).
// 빽도는 이제 게이지 zone이 아니라 "도" 판정 후 서버가 별도 확률로 재판정하므로(2026-08-24),
// 게이지 막대에는 표시하지 않는다 — 타이밍으로 노릴 수 없다는 걸 시각적으로도 드러낸다.
export const GAUGE_ZONES: GaugeZone[] = [
  { result: "mo", label: "모", upperBound: 0.0625, color: "#c0392b" },
  { result: "yut", label: "윷", upperBound: 0.125, color: "#8e44ad" },
  { result: "geol", label: "걸", upperBound: 0.375, color: "#2980b9" },
  { result: "gae", label: "개", upperBound: 0.75, color: "#27ae60" },
  { result: "do", label: "도", upperBound: 1.0, color: "#7f8c8d" },
];
```

`GaugeBar.tsx`는 `GAUGE_ZONES`를 그대로 순회해서 렌더링하므로 코드 변경이 필요 없다 — 배열이 5개로 줄면 자동으로 5구간만 그려진다.

- [ ] **Step 6: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 7: 커밋**

```bash
git add server/src/game/gauge.ts server/src/game/gauge.test.ts client/src/game/gaugeWave.ts
git commit -m "빽도 판정을 게이지 타이밍에서 분리해 표식 가락 기준 25% 확률로 재판정"
```

---

### Task 2: 잡기 응답(의사/성직)에 따른 보너스 지급 여부 판정

**Files:**
- Modify: `server/src/game/abilities.ts`
- Modify: `server/src/game/abilities.test.ts`

**Interfaces:**
- Consumes: 없음(기존 `Rng`, `CaptureRecord`, `Piece`, `PieceId` 재사용).
- Produces: `export interface CaptureResponseResult { pieces: Piece[]; negatedPieceIds: PieceId[] }`(반환 타입 변경), `resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): CaptureResponseResult`(반환 타입만 변경, 시그니처 동일), `export function hasEffectiveCapture(captureRecords: CaptureRecord[], negatedPieceIds: PieceId[]): boolean`(신규 순수 함수 — Task 5가 이걸로 보너스 지급 여부를 판정).

- [ ] **Step 1: `hasEffectiveCapture`의 실패하는 테스트 작성**

`server/src/game/abilities.test.ts` 맨 아래(`describe("resolveCaptureResponses", ...)` 블록 뒤)에 새 describe 블록 추가:

```ts
describe("hasEffectiveCapture", () => {
  function record(pieceId: string): CaptureRecord {
    return { pieceId, teamId: "B", originalPosition: { kind: "outer", index: 8 }, originalPreviousPosition: { kind: "start" } };
  }

  it("무효화되지 않은 캡처가 하나라도 있으면 true", () => {
    expect(hasEffectiveCapture([record("victim")], [])).toBe(true);
  });

  it("모든 캡처가 무효화됐으면 false", () => {
    expect(hasEffectiveCapture([record("victim")], ["victim"])).toBe(false);
  });

  it("여러 캡처 중 일부만 무효화됐으면 true(하나라도 살아남으면 인정)", () => {
    expect(hasEffectiveCapture([record("a"), record("b")], ["a"])).toBe(true);
  });

  it("캡처 자체가 없으면 false", () => {
    expect(hasEffectiveCapture([], [])).toBe(false);
  });
});
```

파일 맨 위 import(2번째 줄)에 `hasEffectiveCapture` 추가 필요 — Step 3에서 함께 처리.

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/abilities.test.ts`
Expected: FAIL — `hasEffectiveCapture`가 아직 없어 임포트 에러, 그리고 기존 `resolveCaptureResponses` 관련 테스트 12개도 반환 타입이 아직 안 바뀐 상태라 이 시점엔 여전히 통과(Step 3에서 타입을 바꾼 뒤 다시 깨짐 → Step 4에서 같이 고침).

- [ ] **Step 3: `resolveCaptureResponses` 반환 타입 변경 + `hasEffectiveCapture` 구현**

`server/src/game/abilities.ts` 맨 위 import에 `hasEffectiveCapture`는 이 파일 자체가 export하는 것이므로 import 불필요 — 대신 `abilities.test.ts` 2번째 줄의 import를 `import { applyGyojuBonus, hasEffectiveCapture, resolveCaptureResponses, type CaptureRecord, type Rng } from "./abilities";`로 바꾼다.

`abilities.ts`의 `resolveOneCapture`(현재 139-147번째 줄)와 `resolveCaptureResponses`(현재 153-159번째 줄)를 다음으로 교체:

```ts
function resolveOneCapture(pieces: Piece[], capture: CaptureRecord, rng: Rng): { pieces: Piece[]; negated: boolean } {
  const restored = tryUisa(pieces, capture, rng);
  if (restored) return { pieces: restored, negated: true };

  const redirected = trySeongjik(pieces, capture, rng);
  if (redirected) return { pieces: redirected, negated: false };

  return { pieces, negated: false };
}

export interface CaptureResponseResult {
  pieces: Piece[];
  /** 의사 능력으로 원위치 복원되어 "사실상 무효화"된 캡처의 pieceId 목록 — 잡기 보너스 던지기 지급 대상에서 뺀다. */
  negatedPieceIds: PieceId[];
}

/**
 * 잡힘 이벤트들을 스펙 §4 순서(의사 우선 -> 실패 시 성직)로 처리한다. captures 배열은
 * "발생 순서대로" 전달되어야 한다(원래 이동의 잡힘 -> 교주 보너스 전진의 잡힘 순).
 */
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

/** 캡처 목록 중 하나라도 의사에게 무효화되지 않고 살아남았으면 true — 잡기 보너스 던지기 지급 여부 판정에 쓴다. */
export function hasEffectiveCapture(captureRecords: CaptureRecord[], negatedPieceIds: PieceId[]): boolean {
  return captureRecords.some((c) => !negatedPieceIds.includes(c.pieceId));
}
```

- [ ] **Step 4: 기존 `resolveCaptureResponses` 호출부(테스트) 12곳 수정**

`abilities.test.ts`의 `describe("resolveCaptureResponses", ...)` 블록 안, `const result = resolveCaptureResponses(...)` 패턴이 등장하는 12곳(현재 122, 136, 144, 152, 164, 172, 185, 200, 209, 222, 232, 241번째 줄) 전부를 `const { pieces: result } = resolveCaptureResponses(...)`로 바꾼다(변수명 `result`는 그대로 유지 — 이후 `result.find(...)` 등 나머지 코드는 손대지 않는다). 예:

```ts
// 변경 전
const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
const victim = result.find((p) => p.id === "victim")!;
```
```ts
// 변경 후
const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
const victim = result.find((p) => p.id === "victim")!;
```

같은 패턴을 나머지 11곳에도 동일하게 적용한다.

- [ ] **Step 5: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/abilities.test.ts`
Expected: PASS (전체).

- [ ] **Step 6: 커밋**

```bash
git add server/src/game/abilities.ts server/src/game/abilities.test.ts
git commit -m "resolveCaptureResponses가 무효화된 캡처를 구분해 반환하도록 변경, hasEffectiveCapture 추가"
```

---

### Task 3: `nextTurnIndex` 단순화 (윷/모 분기 제거)

**Files:**
- Modify: `server/src/game/turns.ts`
- Modify: `server/src/game/turns.test.ts`

**Interfaces:**
- Produces: `nextTurnIndex(currentIndex: number, order: string[]): number`(시그니처 변경 — `result` 매개변수 제거).

- [ ] **Step 1: 깨지는 기존 테스트 삭제**

`server/src/game/turns.test.ts`의 `describe("nextTurnIndex", ...)` 블록(현재 17-35번째 줄) 안에서 "윷이 나오면 같은 사람 차례가 유지된다"(28-30번째 줄)와 "모가 나오면 같은 사람 차례가 유지된다"(32-34번째 줄) 두 `it(...)`를 통째로 삭제한다. 나머지 두 테스트("윷/모가 아니면 다음 사람으로 넘어간다", "순환 순서 끝에서는 처음으로 돌아온다")는 `nextTurnIndex(index, order, "gae")`/`nextTurnIndex(index, order, "do")` 호출에서 세 번째 인자를 뺀 `nextTurnIndex(index, order)`로 바꾼다:

```ts
describe("nextTurnIndex", () => {
  const order = ["a1", "b1", "a2", "b2"];

  it("다음 사람으로 넘어간다", () => {
    expect(nextTurnIndex(0, order)).toBe(1);
  });

  it("순환 순서 끝에서는 처음으로 돌아온다", () => {
    expect(nextTurnIndex(3, order)).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/turns.test.ts`
Expected: FAIL — `nextTurnIndex`가 아직 세 번째 인자를 필수로 받음(타입 에러 또는 인자 개수 불일치로 실패).

- [ ] **Step 3: `nextTurnIndex` 구현 변경**

`server/src/game/turns.ts`의 `nextTurnIndex`(현재 12-17번째 줄)를 다음으로 교체:

```ts
export function nextTurnIndex(currentIndex: number, order: string[]): number {
  return (currentIndex + 1) % order.length;
}
```

파일 맨 위 `import { GRANTS_EXTRA_THROW, type YutResult } from "./gauge";`(1번째 줄)는 이제 이 파일 안에서 안 쓰이므로 삭제한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/turns.test.ts`
Expected: PASS (전체).

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/turns.ts server/src/game/turns.test.ts
git commit -m "nextTurnIndex에서 윷/모 유지 분기 제거 — 턴 유지 여부는 MatchRoom 상태 기계가 전담"
```

---

### Task 4: `MatchState.ts`에 `pendingResults` 스키마 추가

**Files:**
- Modify: `server/src/rooms/MatchState.ts`

**Interfaces:**
- Produces: `export class PendingResultSchema extends Schema { id: string; result: string }`, `MatchState.pendingResults: ArraySchema<PendingResultSchema>`.

- [ ] **Step 1: 스키마 클래스 + 필드 추가**

`server/src/rooms/MatchState.ts`의 `PieceSchema` 클래스(현재 12-22번째 줄) 바로 다음에 새 클래스를 추가:

```ts
export class PendingResultSchema extends Schema {
  /** 서버 발급 안정 id — 같은 결과(예: "개")가 중복 쌓여도 클라이언트가 특정 항목을 지정할 수 있게 함. */
  @type("string") id: string = "";
  /** YutResult 코드("mo"|"yut"|"geol"|"gae"|"do"|"backDo"). */
  @type("string") result: string = "";
}
```

`MatchState` 클래스(현재 24-38번째 줄) 안, `lastThrowResult` 필드(현재 34번째 줄) 바로 다음에 필드 추가:

```ts
  /** 아직 소진하지 않은 던지기 결과들 — 윷/모 연속 던지기나 잡기 보너스로 여러 개 쌓일 수 있다. */
  @type([PendingResultSchema]) pendingResults = new ArraySchema<PendingResultSchema>();
```

- [ ] **Step 2: 서버 타입체크**

Run: `cd server && npm run build`
Expected: 에러 없이 통과(아직 `MatchRoom.ts`가 이 필드를 안 써도 스키마 정의 자체는 독립적으로 컴파일됨).

- [ ] **Step 3: 커밋**

```bash
git add server/src/rooms/MatchState.ts
git commit -m "MatchState에 pendingResults 스키마 필드 추가"
```

---

### Task 5: `MatchRoom.ts` 핵심 상태 기계 재작성 (연속 던지기 + 잡기 보너스 + resultId 프로토콜)

이 태스크가 이번 계획에서 가장 크다 — 서버 오케스트레이션 로직과 기존 통합 테스트 대부분을 함께 손댄다.

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `GRANTS_EXTRA_THROW`, `resolveThrow(..., rng)`(Task 1, `../game/gauge`), `hasEffectiveCapture`, `resolveCaptureResponses`의 새 반환 타입(Task 2, `../game/abilities`), `nextTurnIndex(currentIndex, order)`(Task 3, `../game/turns`), `PendingResultSchema`/`MatchState.pendingResults`(Task 4, `./MatchState`).
- Produces: `movePiece` 메시지 프로토콜이 `{ pieceId: string; resultId: string; useShortcut?: boolean }`로 바뀜(Task 6의 클라이언트가 이 형태로 보낸다).

- [ ] **Step 1: `MatchRoom.ts` 전체 교체**

`server/src/rooms/MatchRoom.ts` 전체를 다음으로 교체:

```ts
import { Room, Client } from "colyseus";
import { applyMove, type Piece } from "../game/pieces";
import { applyGyojuBonus, hasEffectiveCapture, resolveCaptureResponses, type CaptureRecord, type Rng } from "../game/abilities";
import { DEFAULT_GAUGE_CYCLE_MS, GRANTS_EXTRA_THROW, resolveThrow, YUT_STEPS, type YutResult } from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { sanitizeNickname } from "../game/nickname";
import { sanitizeRoomTitle } from "../game/roomTitle";
import { MatchState, PendingResultSchema, PieceSchema, PlayerState, fromSchemaPosition, toSchemaPosition } from "./MatchState";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);
const DEFAULT_THROW_TIMEOUT_MS = 5000;
const DEFAULT_MOVE_TIMEOUT_MS = 5000;
const MAX_CHAT_LENGTH = 200;
/** 턴당 부여 가능한 추가 던지기 총량(윷/모 + 잡기 보너스 합산) — 첫 던지기 포함 최대 3회. */
const MAX_EXTRA_THROWS = 2;

export class MatchRoom extends Room<MatchState> {
  /** 안정적 pendingResults id 발급용 단순 증가 카운터. */
  private pendingResultCounter = 0;
  /** 이번 턴에 지금까지 부여된 추가 던지기 총량(윷/모 + 잡기 보너스 합산) — 최대 MAX_EXTRA_THROWS. */
  private extraThrowsGranted = 0;
  /** 부여는 됐지만 아직 실행하지 않은 추가 던지기 개수 — 한 번의 이동에서 최대 2번(원래 이동 + 교주 보너스) 겹쳐 부여될 수 있어 큐가 필요하다. */
  private throwsOwed = 0;
  /**
   * 현재 활성 타이머(던지기 또는 말 선택)를 구분하는 토큰. 새 타이머를 걸 때마다 증가시키고,
   * 타이머 콜백이 실행될 때 자신이 걸릴 당시의 토큰과 현재 값을 비교한다 — 이미 실제 행동으로
   * 더 앞서 나간 상태라면(값이 달라짐) 오래된 타이머는 조용히 무시된다. 별도의 타이머 취소
   * 호출 없이도 오작동을 막을 수 있는 songpyeon과 동일한 패턴.
   */
  private turnToken = 0;
  private throwTimeoutMs = DEFAULT_THROW_TIMEOUT_MS;
  private moveTimeoutMs = DEFAULT_MOVE_TIMEOUT_MS;
  /** 능력/빽도 확률 판정에 쓰는 난수 함수. 기본은 Math.random, 테스트에서 결정적 값 주입 가능. */
  private rng: Rng = Math.random;

  async onCreate(options?: {
    title?: string;
    mode?: "2v2" | "1v1";
    throwTimeoutMs?: number;
    moveTimeoutMs?: number;
    rng?: Rng;
  }) {
    this.setState(new MatchState());

    const mode = options?.mode === "1v1" ? "1v1" : "2v2";
    this.state.mode = mode;
    this.maxClients = mode === "1v1" ? 2 : 4;

    const title = sanitizeRoomTitle(options?.title) || "이름 없는 방";
    // matchMaker가 onCreate의 반환(Promise)을 기다려주므로, 방 생성 직후 바로
    // getAvailableRooms()/테스트에서 메타데이터를 조회해도 항상 최신 값이 보이도록 await한다.
    await this.setMetadata({ title, mode });

    if (typeof options?.throwTimeoutMs === "number") this.throwTimeoutMs = options.throwTimeoutMs;
    if (typeof options?.moveTimeoutMs === "number") this.moveTimeoutMs = options.moveTimeoutMs;
    if (typeof options?.rng === "function") this.rng = options.rng;

    this.onMessage("pickTeam", (client, message: { team: "A" | "B" } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (message?.team !== "A" && message?.team !== "B") return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.team = message.team;
      this.maybeStartGame();
    });

    this.onMessage("pickCharacters", (client, message: { characters: string[] } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (!Array.isArray(message?.characters)) return;
      const requiredCount = this.state.mode === "1v1" ? 4 : 2;
      if (message.characters.length !== requiredCount) return;
      if (!message.characters.every((c) => VALID_CHARACTERS.has(c))) return;
      if (this.state.mode !== "1v1" && new Set(message.characters).size !== message.characters.length) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.characters.clear();
      for (const c of message.characters) player.characters.push(c);
      this.maybeStartGame();
    });

    this.onMessage("ready", (client) => {
      if (this.state.phase !== "waiting") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = !player.ready;
      this.maybeStartGame();
    });

    this.onMessage("throwStart", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "idle") return;
      this.state.gaugePhase = "charging";
      this.state.throwStartAt = Date.now();
    });

    this.onMessage("throwRelease", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "charging") return;
      const result = resolveThrow(this.state.throwStartAt, Date.now(), DEFAULT_GAUGE_CYCLE_MS, this.rng);
      this.resolveThrowFor(client.sessionId, result);
    });

    this.onMessage(
      "movePiece",
      (client, message: { pieceId: string; resultId: string; useShortcut?: boolean } | undefined) => {
        if (!message || typeof message.pieceId !== "string" || typeof message.resultId !== "string") return;
        this.performMove(client.sessionId, message.pieceId, message.resultId, message.useShortcut ?? false);
      },
    );

    // 채팅은 REQUIREMENTS.md §8: 말풍선으로 잠깐 표시했다가 사라지는 용도라 상태에 저장하지
    // 않는다 — 방 단계(대기실/플레이/종료)와 무관하게 전원에게(보낸 사람 포함) 브로드캐스트만 한다.
    this.onMessage("sendChat", (client, message: { text?: unknown } | undefined) => {
      if (typeof message?.text !== "string") return;
      const text = message.text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return;
      this.broadcast("chatMessage", { sessionId: client.sessionId, text });
    });
  }

  onJoin(client: Client, options?: { nickname?: string }) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = sanitizeNickname(options?.nickname) || "플레이어";
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  /**
   * 핸들러 안에서 발생한 예외가 프로세스를 죽이지 않도록 하는 최후의 방어선.
   * 이 메서드가 정의돼 있어야 Colyseus가 onMessage 핸들러를 try/catch로 감싼다.
   */
  onUncaughtException(err: unknown, methodName: string) {
    console.error(`[MatchRoom:${this.roomId}] ${methodName} 처리 중 예외 발생:`, err);
  }

  /** PieceSchema[] -> 순수 Piece[] 변환 (teamId는 players에서 조회해 채운다). */
  private toGamePieces(): Piece[] {
    return this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      teamId: this.state.players.get(p.ownerSessionId)?.team ?? "",
      character: p.character,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));
  }

  private isCurrentTurn(sessionId: string): boolean {
    return this.state.phase === "playing" && this.state.turnOrder[this.state.currentTurnIndex] === sessionId;
  }

  private maybeStartGame() {
    if (this.state.phase !== "waiting") return;
    const requiredPerTeam = this.state.mode === "1v1" ? 1 : 2;
    const requiredCharacters = this.state.mode === "1v1" ? 4 : 2;
    const piecesPerPlayer = this.state.mode === "1v1" ? 4 : 2;

    if (this.state.players.size !== requiredPerTeam * 2) return;
    const allPlayers = Array.from(this.state.players.values());
    if (!allPlayers.every((p) => p.ready && p.characters.length === requiredCharacters)) return;

    const teamA = allPlayers.filter((p) => p.team === "A").map((p) => p.sessionId);
    const teamB = allPlayers.filter((p) => p.team === "B").map((p) => p.sessionId);
    if (teamA.length !== requiredPerTeam || teamB.length !== requiredPerTeam) return;

    const order = buildTurnOrder(teamA, teamB);
    this.state.turnOrder.clear();
    for (const id of order) this.state.turnOrder.push(id);
    this.state.currentTurnIndex = 0;

    this.state.pieces.clear();
    for (const sessionId of [...teamA, ...teamB]) {
      const owner = this.state.players.get(sessionId)!;
      for (let i = 0; i < piecesPerPlayer; i++) {
        const piece = new PieceSchema();
        piece.id = `${sessionId}-${i}`;
        piece.ownerSessionId = sessionId;
        piece.character = owner.characters[i];
        piece.positionKind = "start";
        piece.positionIndex = -1;
        piece.previousPositionKind = "start";
        piece.previousPositionIndex = -1;
        this.state.pieces.push(piece);
      }
    }

    this.state.phase = "playing";
    this.lock(); // maxClients 자동 잠금은 플레이어 이탈 시 풀리므로 명시적으로 잠가야 한다
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
  }

  /**
   * 던지기 결과가 나올 때마다 실행 — 실제 throwRelease와 시간초과 자동 던지기가 공유한다.
   * 결과를 pendingResults에 쌓고, 윷/모이면서 예산이 남아있으면 즉시 재던지기(idle) 상태로
   * 되돌린다 — 이동 단계로 넘어가지 않는다.
   */
  private resolveThrowFor(sessionId: string, result: YutResult) {
    const pending = new PendingResultSchema();
    pending.id = `p${++this.pendingResultCounter}`;
    pending.result = result;
    this.state.pendingResults.push(pending);
    this.state.lastThrowResult = result;

    if (GRANTS_EXTRA_THROW.has(result) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }

    if (this.throwsOwed > 0) {
      this.throwsOwed--;
      this.state.gaugePhase = "idle";
      this.armThrowTimeout(sessionId);
      return;
    }

    this.state.gaugePhase = "resolved";
    this.armMoveTimeout(sessionId);
  }

  /** 던지기 제한시간(REQUIREMENTS.md §4.1) — 안 누르거나, 누르고 안 뗀 경우 둘 다 이 타이머로 처리된다. */
  private armThrowTimeout(sessionId: string) {
    const token = ++this.turnToken;
    this.state.turnDeadlineAt = Date.now() + this.throwTimeoutMs;
    this.clock.setTimeout(() => {
      if (token !== this.turnToken) return; // 이미 다른 행동으로 앞서 나간 오래된 타이머
      this.autoThrow(sessionId);
    }, this.throwTimeoutMs);
  }

  /** 말 선택 제한시간(REQUIREMENTS.md §4.1) — 던지기가 끝난 시점부터 새로 카운트. */
  private armMoveTimeout(sessionId: string) {
    const token = ++this.turnToken;
    this.state.turnDeadlineAt = Date.now() + this.moveTimeoutMs;
    this.clock.setTimeout(() => {
      if (token !== this.turnToken) return;
      this.autoMove(sessionId);
    }, this.moveTimeoutMs);
  }

  /** 던지기 제한시간 초과 — §5의 확률 분포를 그대로 따르는 무작위 결과로 대신 던진다. */
  private autoThrow(sessionId: string) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase === "resolved") return;
    const randomElapsed = this.rng() * DEFAULT_GAUGE_CYCLE_MS;
    const result = resolveThrow(0, randomElapsed, DEFAULT_GAUGE_CYCLE_MS, this.rng);
    this.resolveThrowFor(sessionId, result);
  }

  /** 말 선택 제한시간 초과 — 가장 오래 쌓인 패로, 완주하지 않은 말 중 첫 번째를 지름길 없이 이동시킨다. */
  private autoMove(sessionId: string) {
    if (!this.isCurrentTurn(sessionId)) return;
    const target = this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
    if (!target) return; // 이론상 도달 불가 — 자기 말이 모두 완주했다면 이미 승리 처리되어 턴이 없다.
    const oldestPending = this.state.pendingResults[0];
    if (!oldestPending) return; // 이론상 도달 불가 — resolved 상태는 항상 pendingResults가 있어야 진입한다.
    this.performMove(sessionId, target.id, oldestPending.id, false);
  }

  /** 실제 movePiece와 시간초과 자동 말 선택이 공유하는 "이동 실행" 로직. */
  private performMove(sessionId: string, pieceId: string, resultId: string, useShortcut: boolean) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase !== "resolved") return;
    const pendingIndex = this.state.pendingResults.findIndex((p) => p.id === resultId);
    if (pendingIndex === -1) return;
    const result = this.state.pendingResults[pendingIndex].result as YutResult;

    const targetPiece = this.state.pieces.find((p) => p.id === pieceId);
    if (!targetPiece || targetPiece.ownerSessionId !== sessionId) return;
    // 이미 완주한 말은 이동 대상이 될 수 없다 (applyMove가 예외를 던진다).
    if (targetPiece.positionKind === "finished") return;

    const pieces: Piece[] = this.toGamePieces();

    const { pieces: afterMove, capturedPieceIds, piggybackedIds } = applyMove(
      pieces,
      pieceId,
      YUT_STEPS[result],
      useShortcut,
    );

    // 교주 능력(REQUIREMENTS.md 능력 스펙 §3.1) — 이동한 말이 교주이고 업기가 발생했으면
    // 80% 확률로 업힌 말 전원이 1칸 더 전진한다. 이 보너스 전진이 새로 만든 잡힘도 아래
    // resolveCaptureResponses에 함께 넘긴다(원래 이동의 잡힘 다음 순서로).
    const bonus = applyGyojuBonus(afterMove, pieceId, piggybackedIds, this.rng);

    const mainCaptureRecords: CaptureRecord[] = capturedPieceIds.map((id) => {
      const original = pieces.find((p) => p.id === id)!;
      return {
        pieceId: id,
        teamId: original.teamId,
        originalPosition: original.position,
        originalPreviousPosition: original.previousPosition,
      };
    });
    const bonusCaptureRecords: CaptureRecord[] = bonus.capturedPieceIds.map((id) => {
      const original = afterMove.find((p) => p.id === id)!;
      return {
        pieceId: id,
        teamId: original.teamId,
        originalPosition: original.position,
        originalPreviousPosition: original.previousPosition,
      };
    });

    const { pieces: updated, negatedPieceIds } = resolveCaptureResponses(
      bonus.pieces,
      [...mainCaptureRecords, ...bonusCaptureRecords],
      this.rng,
    );

    for (const updatedPiece of updated) {
      const schemaPiece = this.state.pieces.find((p) => p.id === updatedPiece.id)!;
      const pos = toSchemaPosition(updatedPiece.position);
      const prevPos = toSchemaPosition(updatedPiece.previousPosition);
      schemaPiece.positionKind = pos.kind;
      schemaPiece.positionIndex = pos.index;
      schemaPiece.previousPositionKind = prevPos.kind;
      schemaPiece.previousPositionIndex = prevPos.index;
    }

    // 사용한 패 소진 — 서버 기록(pendingResults)과 동기화 상태(lastThrowResult)를 함께 비운다.
    this.state.pendingResults.splice(pendingIndex, 1);
    this.state.lastThrowResult = "";

    const finalPieces: Piece[] = this.toGamePieces();

    if (checkWinner(finalPieces, sessionId)) {
      this.state.phase = "finished";
      this.state.winnerSessionId = sessionId;
      this.state.turnDeadlineAt = 0;
      return;
    }

    if (hasEffectiveCapture(mainCaptureRecords, negatedPieceIds) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }
    if (hasEffectiveCapture(bonusCaptureRecords, negatedPieceIds) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }

    if (this.throwsOwed > 0) {
      this.throwsOwed--;
      this.state.gaugePhase = "idle";
      this.armThrowTimeout(sessionId);
      return;
    }

    if (this.state.pendingResults.length > 0) {
      this.state.gaugePhase = "resolved";
      this.armMoveTimeout(sessionId);
      return;
    }

    this.state.gaugePhase = "idle";
    this.extraThrowsGranted = 0;
    this.state.currentTurnIndex = nextTurnIndex(this.state.currentTurnIndex, Array.from(this.state.turnOrder));
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
  }
}
```

- [ ] **Step 2: 기존 테스트 중 `resultId`가 필요해진 곳 수정**

`server/src/rooms/MatchRoom.test.ts` 맨 위, `flush` 함수 정의(현재 32-34번째 줄) 바로 다음에 안전한 경과시간 상수 추가:

```ts
// Global Constraints에 정리된 다섯 값 — 기본 flush()(~50ms)는 "윷" zone에 걸려 결과가 매번
// 달라지므로, 특정 결과를 확정해야 하는 테스트는 이 값들로 elapsed를 고정한다.
const MO_ELAPSED_MS = 22;
const YUT_ELAPSED_MS = 75;
const GEOL_ELAPSED_MS = 188;
const GAE_ELAPSED_MS = 375;
const DO_ELAPSED_MS = 675;
```

다음 6개 테스트를 아래처럼 고친다(전부 "throwStart → 고정 경과시간 대기 → throwRelease"로 "개" 결과를 확정하고, `movePiece`에 `resultId`를 추가):

1. "현재 턴 플레이어가 throwStart -> throwRelease -> movePiece를 하면 말이 이동한다"(현재 138-159번째 줄):

```ts
  it("현재 턴 플레이어가 throwStart -> throwRelease -> movePiece를 하면 말이 이동한다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    expect(room.state.gaugePhase).toBe("charging");

    await flush(GAE_ELAPSED_MS); // "개"(2칸) 구간을 노려 결과를 고정
    turnClient.send("throwRelease", {});
    await flush();

    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
    await flush();

    const movedPiece = room.state.pieces.find((p) => p.id === myPiece.id)!;
    expect(movedPiece.positionKind).toBe("outer");
    expect(movedPiece.positionIndex).toBeGreaterThan(0);
  });
```

2. "자기 말이 아닌 말은 이동시킬 수 없다"(현재 161-176번째 줄):

```ts
  it("자기 말이 아닌 말은 이동시킬 수 없다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const otherPiece = room.state.pieces.find((p) => p.ownerSessionId !== currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: otherPiece.id, resultId });
    await flush();

    const untouchedPiece = room.state.pieces.find((p) => p.id === otherPiece.id)!;
    expect(untouchedPiece.positionKind).toBe("start"); // 이동 안 됨
  });
```

3. "throwRelease 후에는 gaugePhase가 resolved가 되고 결과가 상태에 실린다"(현재 178-189번째 줄) — `flush()` 기본값 대신 `GAE_ELAPSED_MS`로 경과시간 고정(그대로 두면 기본 ~50ms가 "윷" zone에 걸려 gaugePhase가 idle로 남아 이 테스트가 깨진다):

```ts
  it("throwRelease 후에는 gaugePhase가 resolved가 되고 결과가 상태에 실린다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });
```

4. "이동하기 전에 다시 throwStart를 해도 무시된다(결과 재굴림 방지)"(현재 191-208번째 줄) — 같은 이유로 `GAE_ELAPSED_MS` 고정:

```ts
  it("이동하기 전에 다시 throwStart를 해도 무시된다(결과 재굴림 방지)", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const firstResult = room.state.lastThrowResult;
    const firstThrowStartAt = room.state.throwStartAt;

    turnClient.send("throwStart", {}); // 두 번째 시도 — 거부되어야 한다
    await flush();

    expect(room.state.gaugePhase).toBe("resolved"); // charging으로 넘어가지 않음
    expect(room.state.throwStartAt).toBe(firstThrowStartAt);
    expect(room.state.lastThrowResult).toBe(firstResult);
  });
```

5. "이동에 성공하면 gaugePhase가 idle로, lastThrowResult가 비워진다"(현재 210-225번째 줄):

```ts
  it("이동에 성공하면 gaugePhase가 idle로, lastThrowResult가 비워진다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
    await flush();

    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.lastThrowResult).toBe("");
  });
```

6. "이미 완주한 말을 이동시키려 해도 방이 죽지 않고 말도 그대로다"(현재 227-253번째 줄):

```ts
  it("이미 완주한 말을 이동시키려 해도 방이 죽지 않고 말도 그대로다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;
    myPiece.positionKind = "finished";
    myPiece.positionIndex = -1;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
    await flush();

    expect(room.state.pieces.find((p) => p.id === myPiece.id)!.positionKind).toBe("finished");
    expect(room.state.phase).toBe("playing"); // 방이 살아 있음
    expect(room.state.gaugePhase).toBe("resolved"); // 이동이 성사되지 않았으므로 결과 유지

    // 방이 여전히 정상 동작하는지 확인 — 남은 말은 이동할 수 있다
    const otherPiece = room.state.pieces.find(
      (p) => p.ownerSessionId === currentTurnSessionId && p.id !== myPiece.id,
    )!;
    turnClient.send("movePiece", { pieceId: otherPiece.id, resultId });
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
  });
```

- [ ] **Step 3: 예외 테스트에 `resultId` 추가**

"핸들러 안에서 예외가 나도 onUncaughtException이 막아 방이 살아남는다"(현재 352-371번째 줄)에서 `client.send("movePiece", { pieceId: "x" });`를 `client.send("movePiece", { pieceId: "x", resultId: "x" });`로 바꾼다(그렇지 않으면 새 핸들러가 `resultId` 누락을 malformed로 보고 아예 `performMove`를 호출하지 않아, 몽키패치한 예외가 터지지 않는다).

- [ ] **Step 4: 타이머 테스트 3개에 결정적 rng 추가**

"던지기 제한시간을 넘기면 자동으로 무작위 결과가 던져진다"(현재 380-392번째 줄), "게이지를 누르기만 하고 떼지 않아도(charging 상태) 던지기 제한시간이 지나면 자동 처리된다"(현재 394-409번째 줄) 두 테스트의 `setupFourPlayers(colyseus, { throwTimeoutMs: SAFE_TIMEOUT_MS, moveTimeoutMs: 5000 })` 호출에 `rng: () => 0.5`를 추가한다(그렇지 않으면 `autoThrow`가 `Math.random()`이 아니라 이제 `this.rng`를 쓰므로, 기본 `Math.random`이 약 12.5% 확률로 윷/모를 뽑아 즉시 재던지기 상태(idle)가 되어 "resolved" 단정문이 가끔 실패하는 flaky 테스트가 된다 — `rng: () => 0.5`는 항상 "도"만 나오게 해 결정적으로 만든다):

```ts
  it("던지기 제한시간을 넘기면 자동으로 무작위 결과가 던져진다", async () => {
    const { room } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
      rng: () => 0.5,
    });

    expect(room.state.gaugePhase).toBe("idle"); // 아직 아무도 안 눌렀다

    await flush(SAFE_WAIT_MS);

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });

  it("게이지를 누르기만 하고 떼지 않아도(charging 상태) 던지기 제한시간이 지나면 자동 처리된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
      rng: () => 0.5,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(10);
    expect(room.state.gaugePhase).toBe("charging");

    await flush(SAFE_WAIT_MS); // 누른 채로 제한시간을 넘김 — throwRelease를 안 보냈다

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });
```

"정상적으로 제한시간 안에 던지면 시간초과 자동 던지기가 나중에 다시 발동하지 않는다"(현재 411-431번째 줄)는 명시적 `throwRelease`를 쓰므로 rng 추가는 불필요하지만, `await flush(5); turnClient.send("throwRelease", {});`(현재 419-420번째 줄)의 `flush(5)`는 "모" zone(0~46.875ms)에 걸려 첫 던지기가 곧바로 재던지기를 유발한다 — `GAE_ELAPSED_MS`로 바꾼다:

```ts
  it("정상적으로 제한시간 안에 던지면 시간초과 자동 던지기가 나중에 다시 발동하지 않는다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {}); // 제한시간 안에 직접 던짐
    await flush();

    const resultRightAfterRelease = room.state.lastThrowResult;
    expect(resultRightAfterRelease).not.toBe("");

    await flush(SAFE_WAIT_MS); // 원래 throwTimeout이 발동했을 시점을 넉넉히 지남

    // autoThrow가 뒤늦게 발동해 결과를 덮어쓰지 않았어야 한다 (토큰 가드)
    expect(room.state.lastThrowResult).toBe(resultRightAfterRelease);
    expect(room.state.gaugePhase).toBe("resolved");
  });
```

- [ ] **Step 5: 말 선택 제한시간 테스트의 경과시간 고정**

"말 선택 제한시간을 넘기면 완주하지 않은 말이 자동으로 이동하고 턴이 넘어간다"(현재 433-451번째 줄)의 `turnClient.send("throwStart", {}); await flush(); turnClient.send("throwRelease", {});`(현재 440-442번째 줄)를 `GAE_ELAPSED_MS`로 고정:

```ts
  it("말 선택 제한시간을 넘기면 완주하지 않은 말이 자동으로 이동하고 턴이 넘어간다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: 5000,
      moveTimeoutMs: SAFE_TIMEOUT_MS,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {}); // 직접 던지고, 말 선택은 일부러 안 보낸다
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");

    await flush(SAFE_WAIT_MS); // 말 선택 제한시간을 넉넉히 넘김

    expect(room.state.gaugePhase).toBe("idle"); // 자동 이동까지 완료되어 다시 idle
    expect(room.state.lastThrowResult).toBe("");
    expect(room.state.phase).toBe("playing"); // 방은 계속 진행 중
  });
```

- [ ] **Step 6: 연속 던지기 + 잡기 보너스에 대한 새 테스트 추가**

같은 파일, `describe("MatchRoom", ...)` 블록 안 아무 곳에나(타이머 테스트들 뒤 권장) 다음 3개 `it`을 추가:

```ts
  it("윷/모가 연속으로 나오면 이동 없이 즉시 재던지기하고, 최대 2회 추가(총 3회)로 막힌다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    // 1번째 던지기: 윷 — 즉시 재던지기 가능 상태(idle)가 되고, 이동은 아직 안 함
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.pendingResults[0].result).toBe("yut");

    // 2번째 던지기: 또 윷 — 여전히 예산이 남아있어(1/2 사용) 다시 즉시 재던지기
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(2);

    // 3번째 던지기: 또 윷이지만 예산(최대 2회 추가)을 이미 다 썼으므로 더 이상 재던지기가 없다
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved"); // 이제 이동할 차례
    expect(room.state.pendingResults.length).toBe(3);

    // throwStart를 보내도 무시된다 — 더 던질 기회가 없다
    turnClient.send("throwStart", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");
  });

  it("쌓인 패 중 원하는 것을 골라 순서와 무관하게 이동할 수 있다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS); // 윷 — 즉시 재던지기
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("throwStart", {});
    await flush(GEOL_ELAPSED_MS); // 걸 — 윷이 아니므로 여기서 이동 단계로
    turnClient.send("throwRelease", {});
    await flush();

    expect(room.state.pendingResults.length).toBe(2);
    const [firstPending, secondPending] = room.state.pendingResults;
    expect(firstPending.result).toBe("yut");
    expect(secondPending.result).toBe("geol");

    const myPieces = room.state.pieces.filter((p) => p.ownerSessionId === currentTurnSessionId);
    // 먼저 쌓인 "윷"이 아니라 나중에 쌓인 "걸"을 먼저 쓴다 — 순서 강제 없음을 확인.
    turnClient.send("movePiece", { pieceId: myPieces[0].id, resultId: secondPending.id });
    await flush();

    const movedPiece = room.state.pieces.find((p) => p.id === myPieces[0].id)!;
    expect(movedPiece.positionIndex).toBe(3); // start(0) + geol(3칸)
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.pendingResults[0].id).toBe(firstPending.id); // "윷"은 아직 안 씀
  });

  it("잡으면 추가 던지기를 즉시 얻는다 — 남은 패가 있어도 그 자리에서 바로 실행된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPieces = room.state.pieces.filter((p) => p.ownerSessionId === currentTurnSessionId);
    // 상대팀 말 하나를 3번 칸에 미리 놓아 캡처 대상으로 만든다 — 여전히 start에 있는 나머지
    // 말들은 교주/성직 발동 조건(업기 대상 없음, onBoard 아님)을 만족하지 않아 얽히지 않는다.
    const enemyPiece = room.state.pieces.find((p) => p.ownerSessionId !== currentTurnSessionId)!;
    enemyPiece.positionKind = "outer";
    enemyPiece.positionIndex = 3;

    // 1번째 던지기: 윷 — 보너스 1회 사용, 남은 패(윷)를 쌓아둔 채 즉시 재던지기
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(1);

    // 2번째 던지기: 걸(3칸) — 윷이 아니므로 정상적으로 이동 단계(resolved)로 전환
    turnClient.send("throwStart", {});
    await flush(GEOL_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.pendingResults.length).toBe(2);
    const geolPending = room.state.pendingResults.find((p) => p.result === "geol")!;

    // "걸"로 3번 칸까지 이동해 상대 말을 잡는다 — 잡기 보너스로 즉시 재던지기(idle)가 되고,
    // 아직 안 쓴 "윷" 패는 그대로 남아있어야 한다.
    turnClient.send("movePiece", { pieceId: myPieces[0].id, resultId: geolPending.id });
    await flush();

    expect(room.state.gaugePhase).toBe("idle"); // 잡기 보너스로 즉시 재던지기 상태
    expect(room.state.pendingResults.length).toBe(1); // "걸"만 소진, "윷"은 남음
    expect(room.state.pieces.find((p) => p.id === enemyPiece.id)!.positionKind).toBe("start"); // 상대는 시작점으로

    // 잡기 보너스로 얻은 던지기를 실제로 사용할 수 있는지 확인.
    turnClient.send("throwStart", {});
    await flush(DO_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.pendingResults.length).toBe(2); // "윷" + 방금 던진 "도"
  });
```

- [ ] **Step 7: 전체 서버 테스트 실행**

Run: `cd server && npm test`
Expected: 전체 통과. `grep -n "movePiece" server/src/rooms/MatchRoom.test.ts`로 `resultId` 없이 `movePiece`를 보내는 곳이 남아있지 않은지도 확인(단, "payload가 없거나 형식이 잘못된 메시지는..." 테스트의 `client.send("movePiece")`/`client.send("movePiece", { pieceId: 123 })`처럼 **의도적으로 잘못된 형식을 보내는 곳**은 그대로 둔다 — 그게 이 테스트의 목적이다).

- [ ] **Step 8: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "연속 던지기 + 잡기 보너스 던지기 상태 기계 구현, movePiece에 resultId 도입"
```

---

### Task 6: 클라이언트 — 모아놓은 패 표시 + 선택 UI

**Files:**
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/components/PlayerCorner.tsx`
- Modify: `client/src/components/TurnPanel.tsx`

**Interfaces:**
- Consumes: `MatchState.pendingResults`(Task 4/5가 서버에서 동기화).
- Produces: `TurnPanel`이 `movePiece`에 `{ pieceId, resultId, useShortcut }`을 보냄(Task 5의 새 프로토콜과 일치).

- [ ] **Step 1: `matchTypes.ts`에 `pendingResults` 필드 추가**

`client/src/game/matchTypes.ts`의 `MatchState` 인터페이스(현재 29-41번째 줄)에 필드 추가:

```ts
export interface PendingResultState {
  id: string;
  result: string;
}

export interface MatchState {
  phase: "waiting" | "playing" | "finished";
  mode: "2v2" | "1v1";
  players: Map<string, PlayerState>;
  pieces: PieceState[];
  turnOrder: string[];
  currentTurnIndex: number;
  gaugePhase: "idle" | "charging" | "resolved";
  throwStartAt: number;
  lastThrowResult: string;
  pendingResults: PendingResultState[];
  turnDeadlineAt: number;
  winnerSessionId: string;
}
```

- [ ] **Step 2: `PlayerCorner.tsx`에 모아놓은 패 배지 추가**

`client/src/components/PlayerCorner.tsx` 전체를 다음으로 교체:

```tsx
// client/src/components/PlayerCorner.tsx
import type { Room } from "colyseus.js";
import { YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { PieceToken } from "./PieceToken";
import styles from "./PlayerCorner.module.css";

/** 아이콘/점수 없이 닉네임 + 대기 중(positionKind==="start")인 말만 보여준다. 완주한 말은 그냥 사라진다. */
export function PlayerCorner({ room, sessionId }: { room: Room<MatchState>; sessionId: string }) {
  const player = room.state.players.get(sessionId);
  const waiting = Array.from(room.state.pieces).filter(
    (p) => p.ownerSessionId === sessionId && p.positionKind === "start"
  );

  const isCurrentTurn = room.state.turnOrder[room.state.currentTurnIndex] === sessionId;
  const pendingResults = isCurrentTurn ? room.state.pendingResults : [];

  return (
    <div className={styles.card}>
      <span className={styles.nickname}>{playerLabel(sessionId, room)}</span>
      {pendingResults.length > 0 && (
        <div className={styles.pendingRow}>
          {pendingResults.map((r) => (
            <span key={r.id} className={styles.pendingBadge}>
              {YUT_RESULT_LABELS[r.result] ?? r.result}
            </span>
          ))}
        </div>
      )}
      <div className={styles.pieceRow}>
        {waiting.map((p) => (
          <PieceToken key={p.id} character={p.character} team={player?.team ?? ""} size="corner" />
        ))}
      </div>
    </div>
  );
}
```

`client/src/components/PlayerCorner.module.css`에 배지 스타일 추가(파일 끝에):

```css
.pendingRow {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
  justify-content: center;
}

.pendingBadge {
  font-size: 0.7rem;
  padding: 1px 5px;
  border-radius: 4px;
  background: #8a7550;
  color: #fffdf7;
}
```

- [ ] **Step 3: `TurnPanel.tsx`에서 패 선택 후 이동**

`client/src/components/TurnPanel.tsx` 전체를 다음으로 교체:

```tsx
// client/src/components/TurnPanel.tsx
import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import {
  SHORTCUT_JUNCTION_INDICES,
  YUT_RESULT_LABELS,
  type MatchState,
  type PendingResultState,
  type PieceState,
} from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { GaugeBar } from "./GaugeBar";
import { YutSticks } from "./YutSticks";
import { YutStaticSticks } from "./YutStaticSticks";

/**
 * pieceId는 `${sessionId}-${i}` 형태 — 순번만 뽑아 1-based로 보여준다.
 * sessionId 자체에 "-"가 들어갈 수 있으므로(예: "8KN-xxxx") 반드시 "마지막" 조각을 쓴다.
 */
function pieceOrdinal(pieceId: string): number {
  return Number(pieceId.split("-").pop() ?? 0) + 1;
}

function positionDescription(piece: PieceState): string {
  switch (piece.positionKind) {
    case "start":
      return "대기중";
    case "outer":
      return `${piece.positionIndex}번 칸`;
    case "shortcutIn5":
      return `5번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn10":
      return `10번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn15":
      return `15번 지름길 ${piece.positionIndex}칸`;
    case "center":
      return "중앙";
    case "shortcutOut":
      return `중앙 통과 ${piece.positionIndex}칸`;
    case "finished":
      return "완주";
  }
}

/**
 * 던지기 트리거(포인터 캡처)는 더 이상 이 컴포넌트가 아니라 GameBoard의 루트 div가 소유한다
 * (docs/TROUBLESHOOTING.md #9 — 캡처를 쥔 노드가 gaugePhase 전환 중 사라지면 안 됨).
 * 이 컴포넌트는 GameBoard가 넘겨준 chargeStartedAt을 그대로 GaugeBar에 전달하는 순수 표시용이다.
 */
export function TurnPanel({
  room,
  chargeStartedAt,
}: {
  room: Room<MatchState>;
  chargeStartedAt: number;
}) {
  const [, setTick] = useState(0);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));
  const pendingResults = room.state.pendingResults;

  // 쌓인 패 목록이 바뀔 때마다(새로 쌓이거나 하나가 소진되면) 선택이 더 이상 유효하지 않을 수
  // 있다 — 유효하지 않으면 항상 가장 먼저 쌓인 패를 기본 선택으로 되돌린다.
  const selected: PendingResultState | undefined =
    pendingResults.find((r) => r.id === selectedResultId) ?? pendingResults[0];

  function moveMyPiece(pieceId: string, useShortcut: boolean) {
    if (!selected) return;
    room.send("movePiece", { pieceId, resultId: selected.id, useShortcut });
  }

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && (
        <>
          <YutStaticSticks />
          <p>보드를 꾹 누르고 있다가 떼세요</p>
        </>
      )}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {isMyTurn && room.state.gaugePhase === "resolved" && selected && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          {pendingResults.length > 1 && (
            <div>
              <p>사용할 패를 고르세요:</p>
              {pendingResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedResultId(r.id)}
                  disabled={r.id === selected.id}
                >
                  {YUT_RESULT_LABELS[r.result] ?? r.result}
                </button>
              ))}
            </div>
          )}
          <p>결과: {YUT_RESULT_LABELS[selected.result] ?? selected.result}</p>
          <p>이동할 말을 고르세요:</p>
          {Array.from(room.state.pieces)
            .filter((p) => p.ownerSessionId === room.sessionId && p.positionKind !== "finished")
            .map((p) => {
              const atJunction = p.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(p.positionIndex);
              return <PieceMoveButton key={p.id} piece={p} atJunction={atJunction} onMove={moveMyPiece} />;
            })}
        </div>
      )}
    </div>
  );
}

function PieceMoveButton({
  piece,
  atJunction,
  onMove,
}: {
  piece: PieceState;
  atJunction: boolean;
  onMove: (pieceId: string, useShortcut: boolean) => void;
}) {
  const [useShortcut, setUseShortcut] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => onMove(piece.id, useShortcut)}>
        말 {pieceOrdinal(piece.id)} — {positionDescription(piece)}
      </button>
      {atJunction && (
        <label>
          <input type="checkbox" checked={useShortcut} onChange={(e) => setUseShortcut(e.target.checked)} />
          지름길 사용
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 5: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/components/PlayerCorner.tsx client/src/components/PlayerCorner.module.css client/src/components/TurnPanel.tsx
git commit -m "모아놓은 패를 프로필 카드에 표시하고, 여러 패 중 골라 이동하는 UI 추가"
```

---

### Task 7: 윷가락 등면 X 표시

**Files:**
- Modify: `client/src/components/YutSticks.tsx`

**Interfaces:**
- 없음(내부 시각 연출 전용, 다른 파일이 이 컴포넌트의 내부 구현에 의존하지 않음).

- [ ] **Step 1: `afterRender` 훅으로 X 표시 추가**

`client/src/components/YutSticks.tsx` 전체를 다음으로 교체:

```tsx
import { useEffect, useRef } from "react";
import Matter from "matter-js";
import styles from "./YutSticks.module.css";

const STICK_COUNT = 4;
const CANVAS_WIDTH = 280;
const CANVAS_HEIGHT = 200;
/** 굴러떨어지는 연출 시간(ms) — 이 시간이 지나면 실제 결과에 맞는 자세로 강제 안착시킨다. */
const TUMBLE_MS = 1200;

const FACE_FLAT = "#f5e6c8"; // 배(평평한 면) 위 — 넘어가지 않은 쪽
const FACE_ROUND = "#8b5a2b"; // 등(둥근 면) 위 — 결과 판정에 반영되는 쪽
/** 넷 중 하나(index 0)에만 표시되는 테두리 — 전통 윷놀이의 "표식 있는 가락"과 동일한 역할로,
 * 등이 1개만 나왔을 때 이게 도인지 빽도인지 가른다. */
const MARKED_STROKE = "#c0392b";
/** 등면(FACE_ROUND)에 그리는 X 표시 색 — 갈색 바탕 위에서 잘 보이는 밝은 선. */
const MARK_COLOR = "#f5e6c8";

/**
 * 전통 윷놀이 물리 규칙: 등(둥근 면)이 위로 온 가락 개수로 결과가 정해진다
 * (0개=모, 1개=도/빽도, 2개=개, 3개=걸, 4개=윷). 빽도는 "표식 있는 가락(index 0)"이
 * 등을 보일 때만 성립 — 나머지 3개 중 하나가 등이면 그냥 도.
 * 반환값의 각 원소는 그 인덱스 가락이 "등이 위"인지 여부.
 */
function targetFaces(result: string): boolean[] {
  switch (result) {
    case "mo":
      return [false, false, false, false];
    case "do":
      return [false, true, false, false];
    case "backDo":
      return [true, false, false, false];
    case "gae":
      return [true, true, false, false];
    case "geol":
      return [true, true, true, false];
    case "yut":
      return [true, true, true, true];
    default:
      return [false, false, false, false];
  }
}

/** (cx, cy) 중심에 한 변 길이 2r짜리 X 하나를 그린다. */
function drawX(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy + r);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx - r, cy + r);
  ctx.stroke();
}

/** 결과가 확정되는 순간(gaugePhase === "resolved") 윷가락 4개가 굴러떨어지는 연출. */
export function YutSticks({ result }: { result: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = Matter.Engine.create();
    const render = Matter.Render.create({
      element: container,
      engine,
      options: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        wireframes: false,
        background: "#e8ddc7",
      },
    });

    const ground = Matter.Bodies.rectangle(CANVAS_WIDTH / 2, CANVAS_HEIGHT + 10, CANVAS_WIDTH, 20, {
      isStatic: true,
    });
    const leftWall = Matter.Bodies.rectangle(-10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT, { isStatic: true });
    const rightWall = Matter.Bodies.rectangle(CANVAS_WIDTH + 10, CANVAS_HEIGHT / 2, 20, CANVAS_HEIGHT, {
      isStatic: true,
    });

    const sticks = Array.from({ length: STICK_COUNT }, (_, i) =>
      Matter.Bodies.rectangle(40 + i * 55, 20, 18, 90, {
        friction: 0.6,
        restitution: 0.3,
        render: {
          fillStyle: FACE_FLAT,
          strokeStyle: i === 0 ? MARKED_STROKE : "#3a2a1a",
          lineWidth: i === 0 ? 3 : 1,
        },
      }),
    );

    Matter.Composite.add(engine.world, [ground, leftWall, rightWall, ...sticks]);

    for (const stick of sticks) {
      Matter.Body.setVelocity(stick, { x: (Math.random() - 0.5) * 4, y: 0 });
      Matter.Body.setAngularVelocity(stick, (Math.random() - 0.5) * 0.5);
    }

    const runner = Matter.Runner.create();
    Matter.Runner.run(runner, engine);
    Matter.Render.run(render);

    // settle 이후(등/배가 확정된 뒤)에만 등면인 가락에 X 3개를 그린다 — 굴러떨어지는 동안은
    // 아직 결과가 안 정해졌으므로 표시하지 않는다.
    const settledRef = { current: false };
    const faces = result ? targetFaces(result) : [false, false, false, false];

    function drawMarks() {
      if (!settledRef.current || !result) return;
      const ctx = render.context;
      sticks.forEach((stick, i) => {
        if (!faces[i]) return; // 배(FACE_FLAT)면 안 그림 — 등면일 때만
        ctx.save();
        ctx.translate(stick.position.x, stick.position.y);
        ctx.rotate(stick.angle);
        ctx.strokeStyle = MARK_COLOR;
        ctx.lineWidth = 2;
        for (const dy of [-25, 0, 25]) drawX(ctx, 0, dy, 5);
        ctx.restore();
      });
    }

    Matter.Events.on(render, "afterRender", drawMarks);

    let settleTimeout: ReturnType<typeof setTimeout> | undefined;
    if (result) {
      settleTimeout = setTimeout(() => {
        sticks.forEach((stick, i) => {
          Matter.Body.setVelocity(stick, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(stick, 0);
          Matter.Body.setPosition(stick, { x: 40 + i * 55, y: CANVAS_HEIGHT - 50 });
          Matter.Body.setAngle(stick, (Math.random() - 0.5) * 0.3);
          stick.render.fillStyle = faces[i] ? FACE_ROUND : FACE_FLAT;
        });
        settledRef.current = true;
      }, TUMBLE_MS);
    }

    return () => {
      if (settleTimeout) clearTimeout(settleTimeout);
      Matter.Events.off(render, "afterRender", drawMarks);
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.World.clear(engine.world, false);
      Matter.Engine.clear(engine);
      render.canvas.remove();
    };
  }, [result]);

  return <div ref={containerRef} className={styles.canvasWrap} />;
}
```

- [ ] **Step 2: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/YutSticks.tsx
git commit -m "윷가락 등면에 X 표시 3개 추가"
```

---

### Task 8: 전체 검증 (서버 테스트 + 클라이언트 빌드 + 브라우저 확인)

**Files:** 없음(검증 전용 태스크).

- [ ] **Step 1: 서버 전체 테스트**

Run: `cd server && npm test`
Expected: 전체 통과(기존 148여 개 + 이번에 추가/수정한 것 포함).

- [ ] **Step 2: 클라이언트 타입체크 + 빌드**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 3: 서버+클라이언트 동시 실행**

Run(루트에서): `npm run dev`
Expected: 서버(2567)와 클라이언트(5173)가 둘 다 뜬다.

- [ ] **Step 4: 브라우저로 전체 흐름 확인**

브라우저 탭 여러 개(시크릿 창 포함)로 접속해 2v2 또는 1v1 방을 만들어 게임을 시작한 뒤:

1. 아무나 던져서 윷/모가 나오면, 말 선택 화면 없이 바로 다시 던질 수 있는지(보드를 다시 꾹 눌러 던질 수 있는지) 확인.
2. 윷/모를 연속으로 굴려(운이 나쁘면 여러 판 시도) 프로필 카드(모서리 카드)에 쌓인 패 배지가 늘어나는지 확인.
3. 던지기를 세 번(연속 윷/모로) 채운 뒤에는 더 이상 던지기가 안 되고 말 선택 화면으로 넘어가는지 확인.
4. 쌓인 패가 2개 이상일 때 TurnPanel에 패 선택 버튼이 뜨고, 원하는 패를 골라 원하는 말을 이동시킬 수 있는지 확인.
5. 상대 말을 잡으면 즉시 다시 던질 기회가 생기는지(다른 쌓인 패가 남아있어도) 확인.
6. 게이지 막대(누르고 있는 동안)에 구간이 5개(모/윷/걸/개/도)만 보이고 빽도 구간이 안 보이는지 확인.
7. 던지기 애니메이션(윷가락 굴러떨어지는 연출)이 끝난 뒤, 등면(갈색)으로 뒤집힌 가락에 X 표시 3개가 보이는지 확인.
8. 게임을 끝까지 진행해 정상적으로 승리 화면까지 도달하는지 확인(연속 던지기/잡기 보너스가 게임 종료 흐름을 깨지 않는지).

- [ ] **Step 5: 완료 보고**

모든 항목이 확인되면 이 계획은 완료. 이상 발견 시 해당 태스크로 돌아가 수정 후 이 태스크를 다시 수행한다.
