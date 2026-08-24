import { SHORTCUT_JUNCTION_INDICES, type PositionKind } from "./matchTypes";

/**
 * server/src/game/position.ts의 moveForward/moveBackward를 손으로 미러링한다(공유 타입
 * 패키지가 없는 이 프로젝트의 확립된 관례 — matchTypes.ts와 동일). 서버는 최종 도착 칸만
 * 상태로 알려주므로, "한 칸씩 거쳐가는" 이동 애니메이션을 그리려면 클라이언트가 중간 칸들을
 * 직접 재계산해야 한다. 이 파일은 순수 시각 연출용이며, 실제 게임 로직(어디로 이동했는지)은
 * 항상 서버 상태(positionKind/positionIndex)를 그대로 신뢰한다 — 여기 계산은 "그 결과까지
 * 어떤 경로로 갔는지"를 보여주기 위한 것일 뿐이다.
 */

const LAST_OUTER_INDEX = 19;

export interface SimplePosition {
  kind: PositionKind;
  index: number;
}

/** "finish" 트랙(10번/15번 진입, server의 shortcutPositionFromAbsolute와 대응) 한 칸 전진. */
function shortcutFromAbsolute(junctionKind: PositionKind, absoluteStep: number): SimplePosition {
  if (absoluteStep <= 2) return { kind: junctionKind, index: absoluteStep };
  if (absoluteStep === 3) return { kind: "center", index: -1 };
  if (absoluteStep <= 5) return { kind: "shortcutOut", index: absoluteStep - 3 };
  return { kind: "finished", index: -1 };
}

/** "cross" 트랙(5번 진입 전용, server의 crossPositionFromAbsolute와 대응) 한 칸 전진.
 * stepForwardOnce가 항상 딱 1칸씩만 계산하므로(아래 computeMovePath의 for 루프 참고),
 * absoluteStep은 여기서 최대 6까지만 나온다 — 6을 넘는 오버플로는 그 다음 호출에서
 * "outer" 케이스(기존 일반 전진 로직)가 알아서 이어받는다. */
function crossFromAbsolute(absoluteStep: number): SimplePosition {
  if (absoluteStep <= 2) return { kind: "shortcutIn5", index: absoluteStep };
  if (absoluteStep === 3) return { kind: "centerCross", index: -1 };
  if (absoluteStep <= 5) return { kind: "shortcutCross", index: absoluteStep - 3 };
  return { kind: "outer", index: 15 };
}

function stepForwardOnce(
  pos: SimplePosition,
  useShortcut: boolean,
  junctionKind: PositionKind | null,
): { pos: SimplePosition; junctionKind: PositionKind | null } {
  if (pos.kind === "outer" && useShortcut && SHORTCUT_JUNCTION_INDICES.has(pos.index)) {
    const jk = (`shortcutIn${pos.index}` as PositionKind);
    return { pos: shortcutFromAbsolute(jk, 1), junctionKind: jk };
  }
  if (pos.kind === "shortcutIn5" || pos.kind === "shortcutIn10" || pos.kind === "shortcutIn15") {
    const absoluteStep = pos.index + 1;
    if (pos.kind === "shortcutIn5") {
      return { pos: crossFromAbsolute(absoluteStep), junctionKind: pos.kind };
    }
    return { pos: shortcutFromAbsolute(pos.kind, absoluteStep), junctionKind: pos.kind };
  }
  if (pos.kind === "centerCross") {
    // 5번에서 타서 정확히 중앙에 멈춰 선 말은 예외적으로 여기서만 선택지가 있다(server의
    // position.ts moveForward와 동일, 2026-08-25 변경) — useShortcut=false면 원래 트랙(15번
    // 방향)을 계속 타고, true면 완주 방향 트랙으로 전환한다.
    if (useShortcut) {
      return { pos: shortcutFromAbsolute(junctionKind ?? "shortcutIn5", 4), junctionKind };
    }
    return { pos: crossFromAbsolute(4), junctionKind };
  }
  if (pos.kind === "center") {
    return { pos: shortcutFromAbsolute(junctionKind ?? "shortcutIn5", 4), junctionKind };
  }
  if (pos.kind === "shortcutCross") {
    const absoluteStep = 3 + pos.index + 1;
    return { pos: crossFromAbsolute(absoluteStep), junctionKind };
  }
  if (pos.kind === "shortcutOut") {
    const absoluteStep = 3 + pos.index + 1;
    return { pos: shortcutFromAbsolute(junctionKind ?? "shortcutIn5", absoluteStep), junctionKind };
  }
  const startIndex = pos.kind === "start" ? 0 : pos.index;
  const nextIndex = startIndex + 1;
  if (nextIndex > LAST_OUTER_INDEX) return { pos: { kind: "finished", index: -1 }, junctionKind };
  return { pos: { kind: "outer", index: nextIndex }, junctionKind };
}

/**
 * from에서 steps만큼 한 칸씩 전진한 중간 위치들을 순서대로 반환한다(from 자신은 제외, 마지막이
 * 최종 도착 칸). steps가 음수(빽도)면 중간 경로 없이 단일 홉으로 처리하라는 뜻이라 빈 배열을
 * 반환한다 — 호출부가 대신 previousPosition으로 직행하는 애니메이션을 쓴다.
 */
export function computeMovePath(from: SimplePosition, steps: number, useShortcut: boolean): SimplePosition[] {
  if (steps <= 0) return [];
  const path: SimplePosition[] = [];
  let current = from;
  let junctionKind: PositionKind | null = null;
  for (let i = 0; i < steps; i++) {
    const stepped = stepForwardOnce(current, useShortcut, junctionKind);
    current = stepped.pos;
    junctionKind = stepped.junctionKind;
    path.push(current);
    if (current.kind === "finished") break;
  }
  return path;
}
