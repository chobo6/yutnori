# 실제 윷판 시각화 + 캐릭터 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GameBoard.tsx`를 실제 정사각형 윷판(외곽 20칸 + 대각선 지름길 + 중앙)으로 다시 그리고, 말에 캐릭터 그림(팀별 파랑/빨강)을 표시하고, 화면 네 모서리에 플레이어 카드(닉네임 + 대기 중인 말)를 배치하고, 윷 던지기를 전용 버튼 대신 보드 영역 누르기로 바꾼다.

**Architecture:** 좌표 계산은 순수 함수(`boardCoords.ts`)로 분리해 컴포넌트에서 재사용한다. 캐릭터 토큰은 `PieceToken` 하나로 통일해 보드 위 말과 모서리 카드의 대기 말 양쪽에서 재사용한다. 포인터 캡처(윷 던지기 트리거)는 항상 마운트돼 있는 `GameBoard`의 루트 div가 소유하고, `TurnPanel`은 `chargeStartedAt`을 props로 받는 순수 표시 컴포넌트로 축소된다.

**Tech Stack:** React 19 + TypeScript + Vite, CSS Modules(기존 관례), Colyseus 클라이언트 상태(`room.state`), 정적 PNG 임포트(Vite 기본 지원, 별도 설정 불필요).

**Spec:** `docs/superpowers/specs/2026-08-23-board-visualization-design.md`

## Global Constraints

- **client에는 자동화 테스트 프레임워크가 없다**(기존 관례) — 각 태스크의 검증은 `npm run build`(타입체크) + 필요한 경우 `npx tsx`로 순수 함수 값을 직접 찍어보는 방식 + 마지막 통합 태스크에서의 실제 브라우저 확인으로 한다. Jest/Vitest 파일을 새로 만들지 않는다.
- **포인터 캡처 제약**(`docs/TROUBLESHOOTING.md` #9): `gaugePhase`가 바뀌어도 캡처를 소유하는 DOM 노드(이 플랜에서는 `GameBoard`의 루트 `div`)가 조건부로 언마운트되면 안 된다. 자식 콘텐츠만 바뀌어야 한다.
- **팀 색**: A팀 = 원본 PNG(파랑) 그대로, B팀 = 이미 생성해둔 `_red.png`(옷/두건만 빨강으로 hue 이동, 피부·머리·모자는 그대로). 점/테두리로 팀을 구분하지 않는다.
- **모서리 배치**: 2v2는 A팀=좌상단·우하단, B팀=우상단·좌하단(대각선 페어). 1v1은 좌상단=`turnOrder[0]`, 우하단=`turnOrder[1]`, 나머지 두 모서리는 비움.
- **업기(피기백)**: 서버 규칙상 이미 소유자 기준으로만 발생하므로, 클라이언트는 "정확히 같은 좌표(같은 positionKind+positionIndex)"로만 묶으면 자동으로 올바르게 그려진다 — 팀/소유자 조건을 클라이언트에서 별도로 검사할 필요 없음.
- **대기 중(`start`)/완주(`finished`) 말은 보드 위에 그리지 않는다** — `start`는 모서리 카드에, `finished`는 어디에도 그리지 않고 그냥 사라진다.
- 커밋 메시지는 한국어, `feat:`/`fix:` 같은 프리픽스 없이(기존 관례).

---

### Task 1: 캐릭터 이미지 자산 정리 + 팀별 매핑 함수

**Files:**
- Create: `client/src/game/characterAssets.ts`
- Modify(정리): `client/src/assets/characters/` 안의 `*_b64.txt` 12개 파일 삭제(더 이상 필요 없는 브레인스토밍 산출물)
- 커밋에 포함: `client/src/assets/character.webp`, `client/src/assets/characters/{gyoju,gyoju_red,priest,priest_red,madam,madam_red,uisa,uisa_red}.png` (이미 파일시스템에 존재, 아직 git에 커밋 안 됨)

**Interfaces:**
- Produces: `characterImage(character: string, team: "A" | "B" | ""): string` — `character`는 서버 값(`"교주"`/`"성직"`/`"마담"`/`"의사"`) 그대로, `team`이 `"B"`면 빨강 변형, 그 외(`"A"` 또는 빈 문자열)는 파랑 원본을 반환. 반환값은 Vite가 처리한 이미지 URL 문자열.

- [ ] **Step 1: 필요 없는 사이드카 파일 정리**

```bash
rm client/src/assets/characters/*_b64.txt
```

- [ ] **Step 2: `characterAssets.ts` 작성**

```ts
// client/src/game/characterAssets.ts
import gyoju from "../assets/characters/gyoju.png";
import gyojuRed from "../assets/characters/gyoju_red.png";
import priest from "../assets/characters/priest.png";
import priestRed from "../assets/characters/priest_red.png";
import madam from "../assets/characters/madam.png";
import madamRed from "../assets/characters/madam_red.png";
import uisa from "../assets/characters/uisa.png";
import uisaRed from "../assets/characters/uisa_red.png";

const BLUE: Record<string, string> = {
  교주: gyoju,
  성직: priest,
  마담: madam,
  의사: uisa,
};

const RED: Record<string, string> = {
  교주: gyojuRed,
  성직: priestRed,
  마담: madamRed,
  의사: uisaRed,
};

/** team이 "B"면 빨강, 그 외(팀 미배정 포함)는 파랑. */
export function characterImage(character: string, team: "A" | "B" | ""): string {
  const table = team === "B" ? RED : BLUE;
  return table[character] ?? BLUE[character] ?? "";
}
```

- [ ] **Step 3: 타입체크로 임포트 경로 검증**

Run: `cd client && npm run build`
Expected: 에러 없이 통과(8개 PNG 임포트가 전부 실제 파일과 매칭됨을 확인하는 것이 이 스텝의 목적).

- [ ] **Step 4: 커밋**

```bash
git add client/src/game/characterAssets.ts client/src/assets/character.webp client/src/assets/characters/
git commit -m "캐릭터 이미지 자산 정리 및 팀별 매핑 함수 추가"
```

---

### Task 2: 보드 좌표 매핑 순수 함수

**Files:**
- Create: `client/src/game/boardCoords.ts`

**Interfaces:**
- Consumes: `PositionKind`(`client/src/game/matchTypes.ts`, 이미 존재).
- Produces:
  - `export interface Coords { x: number; y: number }`
  - `export const CORNERS: Coords[]` — 인덱스 0=시작/도착(오른쪽 아래), 1=5번 지름길(오른쪽 위), 2=10번(왼쪽 위), 3=15번(왼쪽 아래).
  - `export const CENTER: Coords`
  - `export const OUTER_INDICES: number[]` — `[1..19]`.
  - `export function positionToCoords(kind: PositionKind, index: number): Coords | null` — `"start"`/`"finished"`는 `null`.

- [ ] **Step 1: `boardCoords.ts` 작성**

```ts
// client/src/game/boardCoords.ts
import type { PositionKind } from "./matchTypes";

export interface Coords {
  x: number;
  y: number;
}

/** 0=시작/도착(오른쪽 아래), 1=5번(오른쪽 위), 2=10번(왼쪽 위), 3=15번(왼쪽 아래). 반시계 순서. */
export const CORNERS: Coords[] = [
  { x: 90, y: 90 },
  { x: 90, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 90 },
];

export const CENTER: Coords = { x: 50, y: 50 };

export const OUTER_INDICES: number[] = Array.from({ length: 19 }, (_, i) => i + 1);

const JUNCTION_CORNER: Record<5 | 10 | 15, number> = { 5: 1, 10: 2, 15: 3 };

function lerp(a: Coords, b: Coords, t: number): Coords {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 1~19: 모서리 사이를 5등분(모서리+중간칸4개)한 위치. index 5/10/15는 정확히 모서리 좌표와 같다. */
function outerCoords(index: number): Coords {
  const side = Math.floor((index - 1) / 5);
  const posInSide = ((index - 1) % 5) + 1;
  const from = CORNERS[side];
  const to = CORNERS[(side + 1) % 4];
  return lerp(from, to, posInSide / 5);
}

function shortcutInCoords(junction: 5 | 10 | 15, step: 1 | 2): Coords {
  const corner = CORNERS[JUNCTION_CORNER[junction]];
  return lerp(corner, CENTER, step / 3);
}

function shortcutOutCoords(step: 1 | 2): Coords {
  return lerp(CENTER, CORNERS[0], step / 3);
}

export function positionToCoords(kind: PositionKind, index: number): Coords | null {
  switch (kind) {
    case "outer":
      return outerCoords(index);
    case "center":
      return CENTER;
    case "shortcutIn5":
      return shortcutInCoords(5, index as 1 | 2);
    case "shortcutIn10":
      return shortcutInCoords(10, index as 1 | 2);
    case "shortcutIn15":
      return shortcutInCoords(15, index as 1 | 2);
    case "shortcutOut":
      return shortcutOutCoords(index as 1 | 2);
    case "start":
    case "finished":
      return null;
  }
}
```

- [ ] **Step 2: 좌표 값을 직접 찍어서 스펙 표(§4)와 대조**

Run:
```bash
cd client && npx tsx -e "
import { positionToCoords, CORNERS, CENTER } from './src/game/boardCoords';
console.log('outer1', positionToCoords('outer', 1));
console.log('outer5(=corner1)', positionToCoords('outer', 5), CORNERS[1]);
console.log('outer10(=corner2)', positionToCoords('outer', 10), CORNERS[2]);
console.log('outer15(=corner3)', positionToCoords('outer', 15), CORNERS[3]);
console.log('outer19', positionToCoords('outer', 19));
console.log('shortcutIn5 step1', positionToCoords('shortcutIn5', 1));
console.log('shortcutIn5 step2', positionToCoords('shortcutIn5', 2));
console.log('center', positionToCoords('center', 0), CENTER);
console.log('shortcutOut step2', positionToCoords('shortcutOut', 2));
console.log('start', positionToCoords('start', 0));
"
```

Expected(직접 계산 검증, 소수점 허용 오차 무시):
- `outer1` → `{x:90, y:74}`
- `outer5` → `{x:90, y:10}`, `CORNERS[1]`과 정확히 일치
- `outer10` → `{x:10, y:10}`, `CORNERS[2]`와 일치
- `outer15` → `{x:10, y:90}`, `CORNERS[3]`와 일치
- `outer19` → `{x:74, y:90}`
- `shortcutIn5 step1` → `{x:90, y:36.67}` 근처(90 + (50-90)/3)
- `shortcutIn5 step2` → `{x:76.67, y:23.33}` 근처
- `center` → `{x:50, y:50}`
- `shortcutOut step2` → `{x:76.67, y:76.67}` 근처
- `start` → `null`

값이 어긋나면 §4 표(모서리 순서·반시계 방향)를 다시 확인하고 `CORNERS` 배열 순서를 고친다.

- [ ] **Step 3: 커밋**

```bash
git add client/src/game/boardCoords.ts
git commit -m "보드 정사각형 좌표 매핑 순수 함수 추가"
```

---

### Task 3: `PieceToken` 재사용 컴포넌트

**Files:**
- Create: `client/src/components/PieceToken.tsx`
- Create: `client/src/components/PieceToken.module.css`

**Interfaces:**
- Consumes: `characterImage`(Task 1의 `client/src/game/characterAssets.ts`).
- Produces: `export function PieceToken({ character, team, size }: { character: string; team: "A" | "B" | ""; size: "board" | "corner" }): JSX.Element` — Task 5(보드)와 Task 6(모서리 카드) 양쪽에서 그대로 임포트해 쓴다.

- [ ] **Step 1: `PieceToken.module.css` 작성**

```css
/* client/src/components/PieceToken.module.css */
.token {
  display: block;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
  object-fit: contain;
  pointer-events: none;
}

.board {
  width: 42px;
  height: 56px;
}

.corner {
  width: 30px;
  height: 40px;
}
```

- [ ] **Step 2: `PieceToken.tsx` 작성**

```tsx
// client/src/components/PieceToken.tsx
import { characterImage } from "../game/characterAssets";
import styles from "./PieceToken.module.css";

export function PieceToken({
  character,
  team,
  size,
}: {
  character: string;
  team: "A" | "B" | "";
  size: "board" | "corner";
}) {
  const sizeClass = size === "board" ? styles.board : styles.corner;
  return (
    <img
      src={characterImage(character, team)}
      alt={character}
      className={`${styles.token} ${sizeClass}`}
    />
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/PieceToken.tsx client/src/components/PieceToken.module.css
git commit -m "캐릭터 토큰 재사용 컴포넌트 추가"
```

---

### Task 4: `YutStaticSticks` — 대기 중 윷가락 정적 표시

**Files:**
- Create: `client/src/components/YutStaticSticks.tsx`
- Create: `client/src/components/YutStaticSticks.module.css`

**Interfaces:**
- Produces: `export function YutStaticSticks(): JSX.Element` — 인자 없음, Task 5에서 `gaugePhase==="idle"`일 때 렌더링.

- [ ] **Step 1: `YutStaticSticks.module.css` 작성**

기존 `YutSticks.tsx`의 색 팔레트(`#8b5a2b` 등/`#f5e6c8` 배, 표식 있는 가락은 빨간 테두리)를 그대로 재사용해 일관성을 맞춘다.

```css
/* client/src/components/YutStaticSticks.module.css */
.wrap {
  display: flex;
  gap: 6px;
  justify-content: center;
  align-items: flex-end;
  height: 60px;
}

.stick {
  width: 14px;
  height: 50px;
  background: #f5e6c8;
  border: 2px solid #8b5a2b;
  border-radius: 4px;
}

.marked {
  box-shadow: inset 0 0 0 2px #c0392b;
}
```

- [ ] **Step 2: `YutStaticSticks.tsx` 작성**

```tsx
// client/src/components/YutStaticSticks.tsx
import styles from "./YutStaticSticks.module.css";

/** 내 턴이고 아직 던지기 전(gaugePhase==="idle")일 때 보드 중앙에 보여줄 정지 상태 윷가락 4개. */
export function YutStaticSticks() {
  return (
    <div className={styles.wrap}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`${styles.stick} ${i === 0 ? styles.marked : ""}`} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/YutStaticSticks.tsx client/src/components/YutStaticSticks.module.css
git commit -m "대기 중 윷가락 정적 표시 컴포넌트 추가"
```

---

### Task 5: `GameBoard` 재작성(보드 배경 + 말 배치 + 누르기 인터랙션) + `TurnPanel` 축소

**Files:**
- Modify: `client/src/components/GameBoard.tsx` (전체 재작성)
- Modify: `client/src/components/GameBoard.module.css` (전체 재작성)
- Modify: `client/src/components/TurnPanel.tsx` (버튼/포인터 핸들러 제거, `chargeStartedAt` prop으로 전환, 대기 중 윷가락 추가)

**Interfaces:**
- Consumes: `positionToCoords`/`CORNERS`/`CENTER`/`OUTER_INDICES`(Task 2), `PieceToken`(Task 3), `YutStaticSticks`(Task 4).
- Produces: `export function GameBoard({ room }: { room: Room<MatchState> }): JSX.Element` — 보드 전체(배경+말+던지기 인터랙션+`TurnPanel` 오버레이)를 그리는 최상위 컴포넌트. 이 태스크 이후 `TurnPanel`은 더 이상 `App.tsx`에서 직접 렌더링하지 않는다(Task 7에서 `App.tsx`를 고칠 때 제거).
- `TurnPanel`의 새 시그니처: `export function TurnPanel({ room, chargeStartedAt }: { room: Room<MatchState>; chargeStartedAt: number }): JSX.Element`.

- [ ] **Step 1: `TurnPanel.tsx`에서 포인터 캡처/버튼 제거, `chargeStartedAt`을 prop으로 받도록 변경**

`client/src/components/TurnPanel.tsx` 전체를 다음으로 교체한다(파일 상단 `positionDescription`/`pieceOrdinal`/`PieceMoveButton`은 그대로 유지, 아래는 바뀌는 부분 전체):

```tsx
// client/src/components/TurnPanel.tsx
import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import {
  SHORTCUT_JUNCTION_INDICES,
  YUT_RESULT_LABELS,
  type MatchState,
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

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));

  function moveMyPiece(pieceId: string, useShortcut: boolean) {
    room.send("movePiece", { pieceId, useShortcut });
  }

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && <YutStaticSticks />}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {isMyTurn && room.state.gaugePhase === "resolved" && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          <p>결과: {YUT_RESULT_LABELS[room.state.lastThrowResult] ?? room.state.lastThrowResult}</p>
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

- [ ] **Step 2: `GameBoard.module.css` 전체 재작성**

```css
/* client/src/components/GameBoard.module.css */
.board {
  position: relative;
  width: min(90vw, 480px);
  aspect-ratio: 1 / 1;
  margin: 0 auto;
  touch-action: none;
  user-select: none;
  cursor: pointer;
}

.backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.track {
  fill: #efe6d3;
  stroke: #9e2a2b;
  stroke-width: 0.6;
}

.diagonal {
  stroke: #c9a24a;
  stroke-width: 0.4;
}

.cellDot {
  fill: #fffdf7;
  stroke: #8a7550;
  stroke-width: 0.4;
}

.cornerDot {
  fill: #e8d9a8;
  stroke: #8a7550;
  stroke-width: 0.5;
}

.centerDot {
  fill: #9e2a2b;
}

.pieceLayer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.stack {
  position: absolute;
  transform: translate(-50%, -50%);
}

.stackItem {
  position: absolute;
  top: calc(var(--i) * -6px);
  left: calc(var(--i) * -6px);
}

.centerOverlay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 55%;
  text-align: center;
  pointer-events: none;
}

.centerOverlay button {
  pointer-events: auto;
}
```

- [ ] **Step 3: `GameBoard.tsx` 전체 재작성**

```tsx
// client/src/components/GameBoard.tsx
import { useState, type PointerEvent, type CSSProperties } from "react";
import type { Room } from "colyseus.js";
import { positionToCoords, CORNERS, CENTER, OUTER_INDICES } from "../game/boardCoords";
import type { MatchState, PieceState } from "../game/matchTypes";
import { PieceToken } from "./PieceToken";
import { TurnPanel } from "./TurnPanel";
import styles from "./GameBoard.module.css";

const JUNCTION_CORNER_INDEX: Record<number, number> = { 5: 1, 10: 2, 15: 3 };

function groupKey(piece: PieceState): string {
  return `${piece.positionKind}:${piece.positionIndex}`;
}

export function GameBoard({ room }: { room: Room<MatchState> }) {
  const [chargeStartedAt, setChargeStartedAt] = useState(0);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (room.state.gaugePhase !== "idle") return;
    const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    if (currentSessionId !== room.sessionId) return;
    // 포인터를 보드 루트에 캡처해둔다 — GameBoard는 게임 내내 계속 마운트돼 있으므로
    // (docs/TROUBLESHOOTING.md #9와 달리) gaugePhase 전환 중 이 노드 자체가 사라질 일이 없다.
    e.currentTarget.setPointerCapture(e.pointerId);
    setChargeStartedAt(Date.now());
    room.send("throwStart", {});
  }

  function handlePointerUp() {
    room.send("throwRelease", {});
  }

  const onBoardPieces = Array.from(room.state.pieces).filter(
    (p) => p.positionKind !== "start" && p.positionKind !== "finished"
  );

  const groups = new Map<string, PieceState[]>();
  for (const piece of onBoardPieces) {
    const key = groupKey(piece);
    const list = groups.get(key);
    if (list) {
      list.push(piece);
    } else {
      groups.set(key, [piece]);
    }
  }

  return (
    <div
      className={styles.board}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg className={styles.backdrop} viewBox="0 0 100 100">
        <rect
          x={CORNERS[2].x}
          y={CORNERS[1].y}
          width={CORNERS[1].x - CORNERS[2].x}
          height={CORNERS[3].y - CORNERS[1].y}
          className={styles.track}
        />
        {[5, 10, 15].map((junction) => {
          const corner = CORNERS[JUNCTION_CORNER_INDEX[junction]];
          return (
            <line
              key={junction}
              x1={corner.x}
              y1={corner.y}
              x2={CENTER.x}
              y2={CENTER.y}
              className={styles.diagonal}
            />
          );
        })}
        <line x1={CENTER.x} y1={CENTER.y} x2={CORNERS[0].x} y2={CORNERS[0].y} className={styles.diagonal} />
        {OUTER_INDICES.map((index) => {
          const c = positionToCoords("outer", index);
          if (!c) return null;
          return <circle key={index} cx={c.x} cy={c.y} r={3} className={styles.cellDot} />;
        })}
        {CORNERS.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={4} className={styles.cornerDot} />
        ))}
        <circle cx={CENTER.x} cy={CENTER.y} r={3.5} className={styles.centerDot} />
      </svg>

      <div className={styles.pieceLayer}>
        {Array.from(groups.entries()).map(([key, group]) => {
          const first = group[0];
          const coords = positionToCoords(first.positionKind, first.positionIndex);
          if (!coords) return null;
          return (
            <div key={key} className={styles.stack} style={{ left: `${coords.x}%`, top: `${coords.y}%` }}>
              {group.map((piece, i) => {
                const owner = room.state.players.get(piece.ownerSessionId);
                return (
                  <div
                    key={piece.id}
                    className={styles.stackItem}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <PieceToken character={piece.character} team={owner?.team ?? ""} size="board" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className={styles.centerOverlay}>
        <TurnPanel room={room} chargeStartedAt={chargeStartedAt} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과. (아직 `App.tsx`는 옛 `GameBoard`+`TurnPanel` 형제 배치를 쓰고 있어 화면이 이상하게 보일 수 있지만, 이 태스크의 목표는 타입 정합성이고 실제 레이아웃 확인은 Task 7에서 한다.)

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/GameBoard.tsx client/src/components/GameBoard.module.css client/src/components/TurnPanel.tsx
git commit -m "보드를 정사각형 트랙으로 재작성하고 던지기 인터랙션을 보드 누르기로 변경"
```

---

### Task 6: `cornerSlots` 배치 로직 + `PlayerCorner` 컴포넌트

**Files:**
- Create: `client/src/game/cornerSlots.ts`
- Create: `client/src/components/PlayerCorner.tsx`
- Create: `client/src/components/PlayerCorner.module.css`

**Interfaces:**
- Consumes: `MatchState`(`matchTypes.ts`), `PieceToken`(Task 3), `playerLabel`(`client/src/game/playerLabel.ts`, 기존).
- Produces:
  - `export type CornerKey = "topLeft" | "topRight" | "bottomLeft" | "bottomRight"`
  - `export function assignCorners(state: MatchState): Record<CornerKey, string | null>`
  - `export function PlayerCorner({ room, sessionId }: { room: Room<MatchState>; sessionId: string }): JSX.Element`

- [ ] **Step 1: `cornerSlots.ts` 작성**

```ts
// client/src/game/cornerSlots.ts
import type { MatchState } from "./matchTypes";

export type CornerKey = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * 2v2: 같은 팀은 서로 마주보는 대각선에 배치 — A팀=좌상단·우하단, B팀=우상단·좌하단.
 * 1v1: 마주보는 두 모서리(좌상단·우하단)만 사용, turnOrder 순서대로.
 * 같은 팀 안에서 둘 중 누가 어느 모서리인지는 turnOrder에서 먼저 나오는 쪽이 먼저 나열한 모서리를 가져간다.
 */
export function assignCorners(state: MatchState): Record<CornerKey, string | null> {
  const order = state.turnOrder;

  if (state.mode === "1v1") {
    return {
      topLeft: order[0] ?? null,
      topRight: null,
      bottomLeft: null,
      bottomRight: order[1] ?? null,
    };
  }

  const teamA = order.filter((id) => state.players.get(id)?.team === "A");
  const teamB = order.filter((id) => state.players.get(id)?.team === "B");

  return {
    topLeft: teamA[0] ?? null,
    bottomRight: teamA[1] ?? null,
    topRight: teamB[0] ?? null,
    bottomLeft: teamB[1] ?? null,
  };
}
```

- [ ] **Step 2: 두 모드에 대해 직접 값 찍어서 확인**

Run:
```bash
cd client && npx tsx -e "
import { assignCorners } from './src/game/cornerSlots';

const oneVsOne = {
  mode: '1v1',
  turnOrder: ['p1', 'p2'],
  players: new Map([
    ['p1', { sessionId: 'p1', team: 'A', ready: true, characters: [] }],
    ['p2', { sessionId: 'p2', team: 'B', ready: true, characters: [] }],
  ]),
} as any;
console.log('1v1', assignCorners(oneVsOne));

const twoVsTwo = {
  mode: '2v2',
  turnOrder: ['p1', 'p2', 'p3', 'p4'],
  players: new Map([
    ['p1', { sessionId: 'p1', team: 'A', ready: true, characters: [] }],
    ['p2', { sessionId: 'p2', team: 'B', ready: true, characters: [] }],
    ['p3', { sessionId: 'p3', team: 'A', ready: true, characters: [] }],
    ['p4', { sessionId: 'p4', team: 'B', ready: true, characters: [] }],
  ]),
} as any;
console.log('2v2', assignCorners(twoVsTwo));
"
```

Expected:
- `1v1` → `{ topLeft: 'p1', topRight: null, bottomLeft: null, bottomRight: 'p2' }`
- `2v2` → `{ topLeft: 'p1', bottomRight: 'p3', topRight: 'p2', bottomLeft: 'p4' }`

- [ ] **Step 3: `PlayerCorner.module.css` 작성**

```css
/* client/src/components/PlayerCorner.module.css */
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 90px;
}

.nickname {
  font-size: 0.85rem;
  font-weight: bold;
  color: var(--text, #3a2e1a);
}

.pieceRow {
  display: flex;
  gap: 2px;
}
```

- [ ] **Step 4: `PlayerCorner.tsx` 작성**

```tsx
// client/src/components/PlayerCorner.tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { PieceToken } from "./PieceToken";
import styles from "./PlayerCorner.module.css";

/** 아이콘/점수 없이 닉네임 + 대기 중(positionKind==="start")인 말만 보여준다. 완주한 말은 그냥 사라진다. */
export function PlayerCorner({ room, sessionId }: { room: Room<MatchState>; sessionId: string }) {
  const player = room.state.players.get(sessionId);
  const waiting = Array.from(room.state.pieces).filter(
    (p) => p.ownerSessionId === sessionId && p.positionKind === "start"
  );

  return (
    <div className={styles.card}>
      <span className={styles.nickname}>{playerLabel(sessionId, room)}</span>
      <div className={styles.pieceRow}>
        {waiting.map((p) => (
          <PieceToken key={p.id} character={p.character} team={player?.team ?? ""} size="corner" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 6: 커밋**

```bash
git add client/src/game/cornerSlots.ts client/src/components/PlayerCorner.tsx client/src/components/PlayerCorner.module.css
git commit -m "모서리 플레이어 배치 로직과 카드 컴포넌트 추가"
```

---

### Task 7: `App.tsx` 통합 — 9분할 그리드 레이아웃

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/App.module.css`

**Interfaces:**
- Consumes: `GameBoard`(Task 5, 이제 `TurnPanel`을 내부에서 렌더링하므로 `App.tsx`는 `TurnPanel`을 더 이상 직접 임포트하지 않는다), `PlayerCorner`(Task 6), `assignCorners`(Task 6).

- [ ] **Step 1: `App.module.css` 작성**

```css
/* client/src/App.module.css */
.playScreen {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  grid-template-rows: 1fr auto 1fr;
  grid-template-areas:
    "tl . tr"
    ". board ."
    "bl . br";
  gap: 1rem;
  align-items: center;
  justify-items: center;
  padding: 1rem;
}

.topLeft {
  grid-area: tl;
}

.topRight {
  grid-area: tr;
}

.bottomLeft {
  grid-area: bl;
}

.bottomRight {
  grid-area: br;
}

.boardArea {
  grid-area: board;
}
```

- [ ] **Step 2: `App.tsx` 수정**

```tsx
// client/src/App.tsx
import { useMatchRoom } from "./game/useMatchRoom";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { PlayerCorner } from "./components/PlayerCorner";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatInput } from "./components/ChatInput";
import { assignCorners } from "./game/cornerSlots";
import styles from "./App.module.css";

function App() {
  const { status, room } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <div>
        <h1>윷놀이</h1>
        <p>연결 상태: {status}</p>
      </div>
    );
  }

  const corners = room.state.phase === "playing" ? assignCorners(room.state) : null;

  return (
    <div>
      {/* 대기실/플레이/종료 단계와 무관하게 항상 표시 — 채팅 말풍선이 뜰 자리 겸 채팅 입력창. */}
      <ParticipantBar room={room} />

      {room.state.phase === "waiting" && <WaitingRoom room={room} />}

      {room.state.phase === "playing" && corners && (
        <div className={styles.playScreen}>
          <div className={styles.topLeft}>
            {corners.topLeft && <PlayerCorner room={room} sessionId={corners.topLeft} />}
          </div>
          <div className={styles.topRight}>
            {corners.topRight && <PlayerCorner room={room} sessionId={corners.topRight} />}
          </div>
          <div className={styles.bottomLeft}>
            {corners.bottomLeft && <PlayerCorner room={room} sessionId={corners.bottomLeft} />}
          </div>
          <div className={styles.bottomRight}>
            {corners.bottomRight && <PlayerCorner room={room} sessionId={corners.bottomRight} />}
          </div>
          <div className={styles.boardArea}>
            <GameBoard room={room} />
          </div>
        </div>
      )}

      {room.state.phase === "finished" && <WinnerScreen room={room} />}

      <ChatInput room={room} />
    </div>
  );
}

export default App;
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 4: 서버+클라이언트 동시 실행**

Run(루트에서): `npm run dev`
Expected: 서버(2567)와 클라이언트(5173)가 둘 다 뜬다.

- [ ] **Step 5: 브라우저로 2v2 전체 플로우 확인**

브라우저 탭 4개(또는 시크릿 창 포함)로 `http://localhost:5173` 접속:
1. 대기실에서 2v2 선택, 팀 A에 2명·팀 B에 2명 배정, 캐릭터 선택, 준비 완료 → 게임 시작.
2. 정사각형 보드가 그려지고, 네 모서리에 카드 4개가 각각 뜨는지 확인 — 같은 팀 두 명이 대각선(좌상단·우하단 또는 우상단·좌하단)에 있는지 확인.
3. 각 카드에 닉네임(`playerLabel` 값)과 대기 중인 말(팀 색이 입혀진 캐릭터 그림)만 보이고, 원형 아이콘이나 점수 숫자는 없는지 확인.
4. 내 턴이 되면 보드 중앙에 윷가락 4개가 정지 상태로 보이는지 확인.
5. 보드 영역을 길게 누르고 있으면 게이지 막대가 뜨고, 손을 떼면 결과가 나오고 `YutSticks`(Matter.js 던짐 애니메이션)가 재생되는지 확인. **보드 바깥(모서리 카드나 화면 여백)을 눌렀을 때는 게이지가 시작되지 않는지도 확인.**
6. 이동할 말을 선택해 실제로 보드 위 정확한 좌표(모서리/중간칸/지름길/중앙)로 말이 옮겨가는지 확인 — 특히 5/10/15번 지름길을 타는 경우와 중앙을 지나는 경우.
7. 같은 소유자의 말 2개 이상이 같은 칸에 겹치는 상황(업기)을 만들어서, 카드 뭉치처럼 겹쳐 쌓여 보이고 어느 쪽도 화면 밖으로 안 나가는지 확인.
8. 말이 완주하면 그 말이 모서리 카드에서(대기 목록에서) 그냥 사라지는지 확인.

- [ ] **Step 6: 브라우저로 1v1 플로우 확인**

탭 2개로 1v1 모드 진행: 좌상단·우하단 모서리에만 카드가 뜨고 우상단·좌하단은 비어 있는지 확인. 나머지(누르기/게이지/이동)는 Step 5와 동일하게 재확인.

- [ ] **Step 7: 커밋**

```bash
git add client/src/App.tsx client/src/App.module.css
git commit -m "네 모서리 플레이어 카드와 중앙 보드로 플레이 화면 레이아웃 재구성"
```

---

## Self-Review

**스펙 커버리지:**
- §1 화면 레이아웃 → Task 7 (`App.module.css` 그리드).
- §2 `PlayerCorner` → Task 6.
- §3 캐릭터 토큰/팀 색/업기 → Task 1(자산), Task 3(`PieceToken`), Task 5(`GameBoard`의 그룹핑).
- §4 보드 좌표계 → Task 2.
- §5 던지기 인터랙션 재구성 → Task 4(정적 윷가락), Task 5(포인터 캡처 이전 + `TurnPanel` 축소).
- §6 테스트 전략 → 각 태스크의 `npm run build` + Task 7의 브라우저 체크리스트에 반영.
- §7 범위 제외(로그인/관전/로비/아바타·점수/서버 모델 변경) → 이 플랜의 어떤 태스크도 건드리지 않음, 확인 완료.

**플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드/실행 명령이 포함됨.

**타입 일관성**: `PieceToken`의 `size: "board" | "corner"` prop이 Task 3(정의)·Task 5(`size="board"`)·Task 6(`size="corner"`)에서 동일하게 쓰임. `TurnPanel`의 새 시그니처(`chargeStartedAt: number`)가 Task 5의 정의·Task 5의 `GameBoard` 호출부에서 일치. `assignCorners`의 반환 키(`topLeft`/`topRight`/`bottomLeft`/`bottomRight`)가 Task 6 정의·Task 7의 `App.tsx` 사용처에서 일치.
