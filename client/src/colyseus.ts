import { Client, type Room, type RoomAvailable } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";

const wsUrl = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";
const client = new Client(wsUrl);

// colyseus.js 0.16.x에는 client.getAvailableRooms()가 없다 — 서버(createServer.ts)가
// matchMaker.query()로 대신 제공하는 /api/rooms를 직접 fetch한다.
const httpUrl = wsUrl.replace(/^ws/, "http");

export async function listRooms(): Promise<RoomAvailable<{ title: string; mode: "2v2" | "1v1" }>[]> {
  const res = await fetch(`${httpUrl}/api/rooms`);
  if (!res.ok) throw new Error(`방 목록 조회 실패: ${res.status}`);
  return res.json();
}

export function createRoom(
  title: string,
  mode: "2v2" | "1v1",
  nickname: string,
): Promise<Room<MatchState>> {
  return client.create<MatchState>("match", { title, mode, nickname });
}

export function joinRoom(roomId: string, nickname: string): Promise<Room<MatchState>> {
  return client.joinById<MatchState>(roomId, { nickname });
}
