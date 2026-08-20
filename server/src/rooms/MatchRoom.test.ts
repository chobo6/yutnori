import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

  it("throwRelease 후에는 gaugePhase가 resolved가 되고 결과가 상태에 실린다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });

  it("이동하기 전에 다시 throwStart를 해도 무시된다(결과 재굴림 방지)", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();
    const firstResult = room.state.lastThrowResult;
    const firstThrowStartAt = room.state.throwStartAt;

    turnClient.send("throwStart", {}); // 두 번째 시도 — 거부되어야 한다
    await flush();

    expect(room.state.gaugePhase).toBe("resolved"); // charging으로 넘어가지 않음
    expect(room.state.throwStartAt).toBe(firstThrowStartAt);
    expect(room.state.lastThrowResult).toBe(firstResult);
  });

  it("이동에 성공하면 gaugePhase가 idle로, lastThrowResult가 비워진다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("movePiece", { pieceId: myPiece.id });
    await flush();

    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.lastThrowResult).toBe("");
  });

  it("이미 완주한 말을 이동시키려 해도 방이 죽지 않고 말도 그대로다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;
    myPiece.positionKind = "finished";
    myPiece.positionIndex = -1;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("movePiece", { pieceId: myPiece.id });
    await flush();

    expect(room.state.pieces.find((p) => p.id === myPiece.id)!.positionKind).toBe("finished");
    expect(room.state.phase).toBe("playing"); // 방이 살아 있음
    expect(room.state.gaugePhase).toBe("resolved"); // 이동이 성사되지 않았으므로 결과 유지

    // 방이 여전히 정상 동작하는지 확인 — 남은 말은 이동할 수 있다
    const otherPiece = room.state.pieces.find(
      (p) => p.ownerSessionId === currentTurnSessionId && p.id !== myPiece.id,
    )!;
    turnClient.send("movePiece", { pieceId: otherPiece.id });
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
  });

  it("payload가 없거나 형식이 잘못된 메시지는 방을 죽이지 않고 무시된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    client.send("pickTeam"); // payload 자체가 없음
    client.send("pickTeam", { team: "C" });
    client.send("pickCharacters"); // payload 자체가 없음
    client.send("pickCharacters", { characters: "교주" });
    client.send("movePiece"); // payload 자체가 없음
    client.send("movePiece", { pieceId: 123 });
    await flush();

    const player = room.state.players.get(client.sessionId)!;
    expect(player.team).toBe("");
    expect(player.characters.length).toBe(0);

    // 방이 여전히 살아 있어 정상 메시지를 처리한다
    client.send("pickTeam", { team: "A" });
    await flush();
    expect(room.state.players.get(client.sessionId)!.team).toBe("A");
  });

  it("핸들러 안에서 예외가 나도 onUncaughtException이 막아 방이 살아남는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 어떤 이유로든 핸들러 내부에서 예외가 터지는 상황을 강제한다.
    (room as unknown as { handleMovePiece: () => void }).handleMovePiece = () => {
      throw new Error("의도적으로 발생시킨 예외");
    };
    client.send("movePiece", { pieceId: "x" });
    await flush();

    expect(errorSpy).toHaveBeenCalled(); // onUncaughtException이 잡아서 로깅
    errorSpy.mockRestore();

    // 방은 여전히 살아 있고 다음 메시지를 정상 처리한다
    client.send("pickTeam", { team: "B" });
    await flush();
    expect(room.state.players.get(client.sessionId)!.team).toBe("B");
  });
});
