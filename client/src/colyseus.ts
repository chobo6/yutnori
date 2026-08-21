import { Client, type Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";

const client = new Client(
  import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567",
);

// React StrictMode의 effect 이중 실행 때문에 joinOrCreate가 두 번 호출되는 것을 막기 위해
// 모듈 스코프에 join promise를 캐싱한다 (songpyeon과 동일한 패턴).
let joinPromise: Promise<Room<MatchState>> | null = null;

export function joinMatch(): Promise<Room<MatchState>> {
  if (!joinPromise) {
    joinPromise = client.joinOrCreate<MatchState>("match");
  }
  return joinPromise;
}
