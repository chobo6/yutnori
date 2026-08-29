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

/** server/src/rooms/MatchRoom.ts가 setMetadata로 채우는 방 목록 메타데이터 — 2026-08-27
 * 관전 기능 도입 이후 phase/allowSpectators/playerCount/playerCapacity가 추가됐다. */
export interface RoomMeta {
  title: string;
  mode: "2v2" | "1v1";
  phase: "waiting" | "playing" | "finished";
  allowSpectators: boolean;
  playerCount: number;
  playerCapacity: number;
}

export class UnauthorizedError extends Error {}

export async function listRooms(): Promise<RoomAvailable<RoomMeta>[]> {
  const res = await fetch(`${httpUrl}/api/rooms`, { credentials: "same-origin" });
  if (res.status === 401) throw new UnauthorizedError("로그인이 필요합니다.");
  if (!res.ok) throw new Error(`방 목록 조회 실패: ${res.status}`);
  return res.json();
}

export function createRoom(
  title: string,
  mode: "2v2" | "1v1",
  allowSpectators: boolean,
): Promise<Room<MatchState>> {
  return client.create<MatchState>("match", { title, mode, allowSpectators });
}

export function joinRoom(roomId: string): Promise<Room<MatchState>> {
  return client.joinById<MatchState>(roomId);
}

// 게임 진행 중 갑작스런 연결 끊김(와이파이 끊김, 탭/창 닫힘 등)에서 재접속을 지원한다
// (2026-08-29~). 탭을 완전히 닫았다 다시 열어도 남아있어야 하므로 localStorage를 쓴다
// (sessionStorage는 탭을 닫는 순간 지워짐). 유예 시간은 server/src/rooms/MatchRoom.ts의
// RECONNECTION_GRACE_SECONDS(20초)와 반드시 같은 값을 써야 한다 — 서버가 이미 자리를 정리한
// 뒤에 재접속을 시도해봐야 항상 실패하므로, 클라이언트도 같은 기준으로 먼저 걸러낸다.
const RECONNECT_STORAGE_KEY = "yutnori:reconnect";
const RECONNECTION_GRACE_MS = 20_000;

interface StoredReconnectInfo {
  token: string;
  savedAt: number;
}

/** 방에 처음 들어가거나 재접속에 성공할 때마다 호출해서 최신 토큰으로 갱신한다. */
export function saveReconnectInfo(token: string): void {
  try {
    const info: StoredReconnectInfo = { token, savedAt: Date.now() };
    localStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(info));
  } catch {
    // localStorage를 못 쓰는 환경(프라이빗 모드 등)이어도 재접속 기능만 못 쓸 뿐,
    // 나머지 게임 플레이는 그대로 되어야 하므로 조용히 무시한다.
  }
}

/** "나가기"를 눌렀거나 게임이 끝났을 때 — 더 이상 재접속을 시도할 대상이 없으므로 지운다. */
export function clearReconnectInfo(): void {
  try {
    localStorage.removeItem(RECONNECT_STORAGE_KEY);
  } catch {
    // 위와 동일한 이유로 무시.
  }
}

/** 저장된 재접속 토큰이 있고 아직 유예 시간 안이면 반환, 아니면 null(만료분은 정리까지 함). */
export function loadValidReconnectToken(): string | null {
  try {
    const raw = localStorage.getItem(RECONNECT_STORAGE_KEY);
    if (!raw) return null;
    const info = JSON.parse(raw) as StoredReconnectInfo;
    if (typeof info.token !== "string" || Date.now() - info.savedAt >= RECONNECTION_GRACE_MS) {
      localStorage.removeItem(RECONNECT_STORAGE_KEY);
      return null;
    }
    return info.token;
  } catch {
    return null;
  }
}

export function reconnectToRoom(token: string): Promise<Room<MatchState>> {
  return client.reconnect<MatchState>(token);
}
