import { Client, type Room, type RoomAvailable } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";

// 프로덕션 빌드는 client가 서버(같은 Express 앱)에서 정적으로 서빙되므로(createServer.ts
// 참고), 같은 origin/포트로 접속하면 된다 — nip.io 주소는 EC2를 재시작할 때마다 바뀌므로
// (CLAUDE.md 참고 대상: songpyeon 배포 기록) 빌드에 고정 주소를 박아넣으면 재배포 없이는
// 재시작마다 다시 빌드해야 하는 번거로움이 생긴다. VITE_COLYSEUS_URL은 개발 중 client(5173)와
// server(2567)를 분리해서 띄울 때만 필요하다.
// 빈 문자열("")도 "값 없음"으로 취급해야 한다 — Docker 빌드에서 ARG를 안 넘기면 ""로
// 정의돼버려서(undefined가 아님) `??`만으로는 안 걸러진다.
const wsUrl =
  import.meta.env.VITE_COLYSEUS_URL ||
  (import.meta.env.DEV ? "ws://localhost:2567" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
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
