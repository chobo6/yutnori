import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 닉네임이 있으면 그걸 쓰고, 없으면(이론상 항상 있지만 방어적으로) 팀+세션ID 조각으로 폴백한다.
 * players뿐 아니라 spectators(2026-08-27 관전 기능)도 같은 방식으로 찾는다 — 관전자는 팀이
 * 없으므로 teamLabel은 항상 빈 문자열이 된다. */
export function playerLabel(sessionId: string, room: Room<MatchState>): string {
  const player = room.state.players.get(sessionId);
  const nickname = player?.nickname || room.state.spectators.get(sessionId)?.nickname;
  if (nickname) return nickname;
  const teamLabel = player?.team ? `${player.team}팀 ` : "";
  const isMe = sessionId === room.sessionId;
  return `${teamLabel}${isMe ? "나" : sessionId.slice(0, 4)}`;
}
