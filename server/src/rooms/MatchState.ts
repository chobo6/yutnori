import { Schema, type } from "@colyseus/schema";

// 연결 검증용 placeholder. 실제 게임 스키마(말 위치/턴/게이지 등)는
// REQUIREMENTS.md/ARCHITECTURE.md 기반 구현 계획에서 채운다.
export class MatchState extends Schema {
  @type("number") round: number = 0;
}
