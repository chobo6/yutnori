// server/src/rooms/MatchRoom.shortcut.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { MatchState } from "./MatchState";

const CHARACTERS = ["교주", "성직"];

function flush(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupFourPlayers(colyseus: ColyseusTestServer) {
  const room = await colyseus.createRoom<MatchState>("match", {});
  const clients = await Promise.all([
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
  ]);

  const teams = ["A", "A", "B", "B"];
  for (let i = 0; i < 4; i++) {
    clients[i].send("pickTeam", { team: teams[i] });
    clients[i].send("pickCharacters", { characters: CHARACTERS });
  }
  await flush();
  for (const client of clients) client.send("ready", {});
  await flush();

  return { room, clients };
}

describe("MatchRoom 지름길 통합", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  it("모서리에서 지름길을 타면 서버 상태가 shortcutOut으로 정확히 인코딩되고 previousPosition도 올바르게 남는다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentSessionId)!;

    myPiece.positionKind = "outer";
    myPiece.positionIndex = 10;
    myPiece.previousPositionKind = "outer";
    myPiece.previousPositionIndex = 9;

    turnClient.send("throwStart", {});
    await flush(5); // "모"(5칸) 결과를 안정적으로 노리는 기존 관례(다른 테스트 파일들과 동일한 타이밍)
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 체인이 끝나고 이동 가능(resolved)해진다
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("movePiece", { pieceId: myPiece.id, useShortcut: true, resultId: room.state.pendingResults[0].id });
    await flush();

    const moved = room.state.pieces.find((p) => p.id === myPiece.id)!;
    // 10번 모서리 + 모(5칸) 지름길 = 절대값 0+5=5 → shortcutOut 2단계(5-3=2)
    expect(moved.positionKind).toBe("shortcutOut");
    expect(moved.positionIndex).toBe(2);
    // 직전 위치(이동 전 모서리 10번)가 스키마 왕복 변환을 거쳐도 올바르게 보존되어야 한다
    expect(moved.previousPositionKind).toBe("outer");
    expect(moved.previousPositionIndex).toBe(10);
  });
});
