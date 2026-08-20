// server/src/rooms/MatchRoom.fullGame.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MatchRoom 전체 매치 흐름", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  it("한 플레이어의 말 2개가 모두 완주할 때까지 반복해서 던지고 이동하면 그 팀이 승리한다", async () => {
    const room = await colyseus.createRoom("match", {});
    const clients = await Promise.all([
      colyseus.connectTo(room),
      colyseus.connectTo(room),
      colyseus.connectTo(room),
      colyseus.connectTo(room),
    ]);

    const teams = ["A", "A", "B", "B"];
    for (let i = 0; i < 4; i++) {
      clients[i].send("pickTeam", { team: teams[i] });
      clients[i].send("pickCharacters", { characters: [CHARACTERS[0], CHARACTERS[1]] });
    }
    await flush();
    for (const client of clients) client.send("ready", {});
    await flush();

    expect(room.state.phase).toBe("playing");

    // 승리 조건: 한 플레이어(turnOrder[0])의 말 2개가 완주할 때까지,
    // 그 사람 턴이 돌아올 때마다 "모(5칸)" 구간을 노려서 최대한 빨리 진행시킨다.
    // wavePosition(x)=x for x in [0, 0.5]인 전반부를 이용해 mo 구간(상한 0.0625) 초반을 노린다.
    const targetSessionId = room.state.turnOrder[0];
    const targetClient = clients.find((c) => c.sessionId === targetSessionId)!;

    for (let guard = 0; guard < 60; guard++) {
      if (room.state.phase === "finished") break;

      const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
      const currentClient = clients.find((c) => c.sessionId === currentSessionId)!;

      currentClient.send("throwStart", {});
      await flush(5); // wavePosition 전반부 초입 근처 -> "모" 구간 노림
      currentClient.send("throwRelease", {});
      await flush();

      const myUnfinished = room.state.pieces.find(
        (p) => p.ownerSessionId === currentSessionId && p.positionKind !== "finished",
      );
      if (myUnfinished) {
        currentClient.send("movePiece", { pieceId: myUnfinished.id });
        await flush();
      }
    }

    expect(room.state.phase).toBe("finished");
    expect(room.state.winnerSessionId).not.toBe("");
  });
});
