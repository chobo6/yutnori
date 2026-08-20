import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { DEFAULT_GAUGE_CYCLE_MS } from "../game/gauge";
import { MatchState } from "./MatchState";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

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
    clients[i].send("pickCharacters", { characters: [CHARACTERS[0], CHARACTERS[1]] });
  }
  await flush();
  for (const client of clients) {
    client.send("ready", {});
  }
  await flush();

  return { room, clients };
}

function flush(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MatchRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  it("4명이 팀/캐릭터를 정하고 준비하면 게임이 시작된다", async () => {
    const { room } = await setupFourPlayers(colyseus);
    expect(room.state.phase).toBe("playing");
    expect(room.state.pieces.length).toBe(8);
    expect(room.state.turnOrder.length).toBe(4);
  });

  it("현재 턴 플레이어가 아니면 throwStart가 무시된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const notTurnClient = clients.find((c) => c.sessionId !== currentTurnSessionId)!;

    notTurnClient.send("throwStart", {});
    await flush();

    expect(room.state.gaugePhase).toBe("idle");
  });

  it("현재 턴 플레이어가 throwStart -> throwRelease -> movePiece를 하면 말이 이동한다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    expect(room.state.gaugePhase).toBe("charging");

    // wavePosition(0.03 * cycle/2) 근방 -> "mo"(5칸) 구간을 노리고 아주 짧게 대기 후 release
    await flush(0.03 * (DEFAULT_GAUGE_CYCLE_MS / 2));
    turnClient.send("throwRelease", {});
    await flush();

    turnClient.send("movePiece", { pieceId: myPiece.id });
    await flush();

    const movedPiece = room.state.pieces.find((p) => p.id === myPiece.id)!;
    expect(movedPiece.positionKind).toBe("outer");
    expect(movedPiece.positionIndex).toBeGreaterThan(0);
  });

  it("자기 말이 아닌 말은 이동시킬 수 없다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const otherPiece = room.state.pieces.find((p) => p.ownerSessionId !== currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("movePiece", { pieceId: otherPiece.id });
    await flush();

    const untouchedPiece = room.state.pieces.find((p) => p.id === otherPiece.id)!;
    expect(untouchedPiece.positionKind).toBe("start"); // 이동 안 됨
  });
});
