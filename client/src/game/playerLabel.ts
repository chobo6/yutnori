import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 닉네임 시스템이 없으므로 팀 + 본인 여부 + 세션ID 일부로 표시한다. */
export function playerLabel(sessionId: string, room: Room<MatchState>): string {
  const player = room.state.players.get(sessionId);
  const teamLabel = player?.team ? `${player.team}팀 ` : "";
  const isMe = sessionId === room.sessionId;
  return `${teamLabel}${isMe ? "나" : sessionId.slice(0, 4)}`;
}
