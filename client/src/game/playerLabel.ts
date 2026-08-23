import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 닉네임이 있으면 그걸 쓰고, 없으면(이론상 항상 있지만 방어적으로) 팀+세션ID 조각으로 폴백한다. */
export function playerLabel(sessionId: string, room: Room<MatchState>): string {
  const player = room.state.players.get(sessionId);
  if (player?.nickname) return player.nickname;
  const teamLabel = player?.team ? `${player.team}팀 ` : "";
  const isMe = sessionId === room.sessionId;
  return `${teamLabel}${isMe ? "나" : sessionId.slice(0, 4)}`;
}
