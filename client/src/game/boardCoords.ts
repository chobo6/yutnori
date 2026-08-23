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
