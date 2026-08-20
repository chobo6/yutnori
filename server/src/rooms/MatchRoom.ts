import { Room, Client } from "colyseus";
import { MatchState } from "./MatchState";

// 연결 검증용 placeholder room. maxClients=4 (2팀×2인)만 확정, 나머지 로직은 구현 계획에서 채운다.
export class MatchRoom extends Room<MatchState> {
  maxClients = 4;

  onCreate() {
    this.setState(new MatchState());
  }

  onJoin(client: Client) {
    console.log(`${client.sessionId} joined`);
  }

  onLeave(client: Client) {
    console.log(`${client.sessionId} left`);
  }
}
