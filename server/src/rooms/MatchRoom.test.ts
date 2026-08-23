import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGameServer } from "../createServer";
import { DEFAULT_GAUGE_CYCLE_MS } from "../game/gauge";
import { MatchState } from "./MatchState";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

async function setupFourPlayers(colyseus: ColyseusTestServer, options: Record<string, unknown> = {}) {
  const room = await colyseus.createRoom<MatchState>("match", options);
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

  it("1v1 모드에서는 2명(팀당 1명)이 캐릭터 4종씩 고르고 준비하면 게임이 시작되고 말이 8개(4개씩) 생긴다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    clientA.send("pickTeam", { team: "A" });
    clientA.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    clientB.send("pickTeam", { team: "B" });
    clientB.send("pickCharacters", { characters: ["의사", "의사", "마담", "마담"] });
    await flush();

    clientA.send("ready", {});
    clientB.send("ready", {});
    await flush();

    expect(room.state.phase).toBe("playing");
    expect(room.state.pieces.length).toBe(8);
    expect(room.state.turnOrder.length).toBe(2);
    expect(room.state.pieces.filter((p) => p.ownerSessionId === clientA.sessionId).length).toBe(4);
    expect(room.state.pieces.filter((p) => p.ownerSessionId === clientB.sessionId).length).toBe(4);
  });

  it("1v1 모드에서 두 명 다 같은 팀을 고르면(팀 분배가 안 맞으면) 게임이 시작되지 않는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    clientA.send("pickTeam", { team: "A" });
    clientA.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    clientB.send("pickTeam", { team: "A" });
    clientB.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    await flush();

    clientA.send("ready", {});
    clientB.send("ready", {});
    await flush();

    expect(room.state.phase).toBe("waiting");
  });

  it("ready 이후 마지막 조건(pickCharacters)이 채워지면 추가 ready 없이도 게임이 시작된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    clientA.send("pickTeam", { team: "A" });
    clientB.send("pickTeam", { team: "B" });
    clientA.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    await flush();

    clientA.send("ready", {});
    clientB.send("ready", {});
    await flush();

    // B가 아직 캐릭터를 안 골라 시작 조건 미충족 -> waiting 유지
    expect(room.state.phase).toBe("waiting");

    // 마지막 조건(B의 캐릭터 선택)이 채워지는 순간 - 추가 ready 없이 바로 시작되어야 한다
    clientB.send("pickCharacters", { characters: ["의사", "의사", "마담", "마담"] });
    await flush();

    expect(room.state.phase).toBe("playing");
  });

  it("게임 시작 시 각 말에 플레이어가 고른 캐릭터가 순서대로 배정된다", async () => {
    const { room } = await setupFourPlayers(colyseus);
    const players = Array.from(room.state.players.values());
    for (const player of players) {
      const piece0 = room.state.pieces.find((p) => p.id === `${player.sessionId}-0`)!;
      const piece1 = room.state.pieces.find((p) => p.id === `${player.sessionId}-1`)!;
      expect(piece0.character).toBe(player.characters[0]);
      expect(piece1.character).toBe(player.characters[1]);
    }
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

  it("1v1 모드에서는 캐릭터 4종을 골라야 반영된다(2종은 무시)", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const client = await colyseus.connectTo(room);

    client.send("pickCharacters", { characters: ["교주", "성직"] });
    await flush();
    expect(room.state.players.get(client.sessionId)!.characters.length).toBe(0);

    client.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    await flush();
    expect(Array.from(room.state.players.get(client.sessionId)!.characters)).toEqual([
      "교주",
      "성직",
      "마담",
      "의사",
    ]);
  });

  it("1v1 모드에서는 캐릭터 중복이 허용된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const client = await colyseus.connectTo(room);

    client.send("pickCharacters", { characters: ["의사", "의사", "마담", "마담"] });
    await flush();
    expect(Array.from(room.state.players.get(client.sessionId)!.characters)).toEqual([
      "의사",
      "의사",
      "마담",
      "마담",
    ]);
  });

  it("2v2 모드(기본값)에서는 캐릭터 중복이 거부된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    client.send("pickCharacters", { characters: ["교주", "교주"] });
    await flush();
    expect(room.state.players.get(client.sessionId)!.characters.length).toBe(0);
  });

  it("mode에 따라 maxClients가 정해진다", async () => {
    const room2v2 = await colyseus.createRoom<MatchState>("match", {});
    expect(room2v2.maxClients).toBe(4);

    const room1v1 = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    expect(room1v1.maxClients).toBe(2);
  });

  it("방 생성 시 title이 메타데이터로 저장된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { title: "  즐거운 한판  ", mode: "1v1" });
    expect(room.metadata?.title).toBe("즐거운 한판");
    expect(room.metadata?.mode).toBe("1v1");
  });

  it("title을 안 주면 기본 제목이 붙는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    expect(room.metadata?.title).toBe("이름 없는 방");
  });

  it("입장 시 넘긴 nickname이 정제되어 저장되고, 없으면 기본값이 붙는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const withNickname = await colyseus.connectTo(room, { nickname: "  둘리  " });
    const withoutNickname = await colyseus.connectTo(room, {});
    await flush();

    expect(room.state.players.get(withNickname.sessionId)!.nickname).toBe("둘리");
    expect(room.state.players.get(withoutNickname.sessionId)!.nickname).toBe("플레이어");
  });

  it("게임이 시작되면 방이 잠긴다", async () => {
    const { room } = await setupFourPlayers(colyseus);
    expect(room.locked).toBe(true);
  });

  it("핸들러 안에서 예외가 나도 onUncaughtException이 막아 방이 살아남는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 어떤 이유로든 핸들러 내부에서 예외가 터지는 상황을 강제한다.
    (room as unknown as { performMove: () => void }).performMove = () => {
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

  // setupFourPlayers 자체가 flush(50)를 두 번 거치므로(팀/캐릭터 확정 + ready), 게임 시작 시점에
  // 걸리는 첫 던지기 타이머는 테스트 본문이 시작될 때 이미 ~50~100ms가 흐른 뒤다. 아래 타이머
  // 테스트들은 이 오버헤드보다 확실히 큰 제한시간(400ms)을 써서 "아직 안 끝남" 상태를 안정적으로
  // 관찰하고, 그보다 한참 뒤(500ms 추가)에 "끝남" 상태를 관찰한다.
  const SAFE_TIMEOUT_MS = 400;
  const SAFE_WAIT_MS = 500;

  it("던지기 제한시간을 넘기면 자동으로 무작위 결과가 던져진다", async () => {
    const { room } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
    });

    expect(room.state.gaugePhase).toBe("idle"); // 아직 아무도 안 눌렀다

    await flush(SAFE_WAIT_MS);

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });

  it("게이지를 누르기만 하고 떼지 않아도(charging 상태) 던지기 제한시간이 지나면 자동 처리된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(10);
    expect(room.state.gaugePhase).toBe("charging");

    await flush(SAFE_WAIT_MS); // 누른 채로 제한시간을 넘김 — throwRelease를 안 보냈다

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });

  it("정상적으로 제한시간 안에 던지면 시간초과 자동 던지기가 나중에 다시 발동하지 않는다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(5);
    turnClient.send("throwRelease", {}); // 제한시간 안에 직접 던짐
    await flush();

    const resultRightAfterRelease = room.state.lastThrowResult;
    expect(resultRightAfterRelease).not.toBe("");

    await flush(SAFE_WAIT_MS); // 원래 throwTimeout이 발동했을 시점을 넉넉히 지남

    // autoThrow가 뒤늦게 발동해 결과를 덮어쓰지 않았어야 한다 (토큰 가드)
    expect(room.state.lastThrowResult).toBe(resultRightAfterRelease);
    expect(room.state.gaugePhase).toBe("resolved");
  });

  it("말 선택 제한시간을 넘기면 완주하지 않은 말이 자동으로 이동하고 턴이 넘어간다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: 5000,
      moveTimeoutMs: SAFE_TIMEOUT_MS,
    });
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {}); // 직접 던지고, 말 선택은 일부러 안 보낸다
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");

    await flush(SAFE_WAIT_MS); // 말 선택 제한시간을 넉넉히 넘김

    expect(room.state.gaugePhase).toBe("idle"); // 자동 이동까지 완료되어 다시 idle
    expect(room.state.lastThrowResult).toBe("");
    expect(room.state.phase).toBe("playing"); // 방은 계속 진행 중
  });

  it("sendChat을 보내면 모든 클라이언트가 chatMessage 브로드캐스트를 받는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    const receivedByB: Array<{ sessionId: string; text: string }> = [];
    clientB.onMessage("chatMessage", (msg: { sessionId: string; text: string }) => receivedByB.push(msg));

    clientA.send("sendChat", { text: "안녕하세요" });
    await flush();

    expect(receivedByB).toEqual([{ sessionId: clientA.sessionId, text: "안녕하세요" }]);
  });

  it("보낸 사람 본인도 자기 chatMessage 브로드캐스트를 받는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    const received: Array<{ sessionId: string; text: string }> = [];
    client.onMessage("chatMessage", (msg: { sessionId: string; text: string }) => received.push(msg));

    client.send("sendChat", { text: "테스트" });
    await flush();

    expect(received).toEqual([{ sessionId: client.sessionId, text: "테스트" }]);
  });

  it("앞뒤 공백은 제거되고, 너무 긴 채팅은 200자로 잘린다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    const received: Array<{ sessionId: string; text: string }> = [];
    clientB.onMessage("chatMessage", (msg: { sessionId: string; text: string }) => received.push(msg));

    clientA.send("sendChat", { text: "  안녕  " });
    clientA.send("sendChat", { text: "가".repeat(300) });
    await flush();

    expect(received[0].text).toBe("안녕");
    expect(received[1].text).toBe("가".repeat(200));
  });

  it("빈 문자열이거나 잘못된 형식의 sendChat은 무시된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    const received: unknown[] = [];
    client.onMessage("chatMessage", (msg: unknown) => received.push(msg));

    client.send("sendChat", { text: "   " }); // 공백만
    client.send("sendChat"); // payload 없음
    client.send("sendChat", { text: 123 }); // 문자열 아님
    await flush();

    expect(received).toHaveLength(0);
  });

  it("대기실(waiting) 단계에서도 채팅을 보낼 수 있다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    const received: unknown[] = [];
    client.onMessage("chatMessage", (msg: unknown) => received.push(msg));

    expect(room.state.phase).toBe("waiting");
    client.send("sendChat", { text: "대기실 채팅" });
    await flush();

    expect(received).toHaveLength(1);
  });

  it("두 제한시간을 모두 짧게 두면 아무도 응답하지 않아도 게임이 계속 진행된다", async () => {
    const { room } = await setupFourPlayers(colyseus, { throwTimeoutMs: 20, moveTimeoutMs: 20 });

    // 던지기/말선택 사이클이 반복될 시간을 넉넉히 준다. 매 사이클의 정확한 위상(resolved 순간에
    // 걸릴지 idle 순간에 걸릴지)은 Colyseus의 patch-tick 주기에 따라 흔들릴 수 있으므로, 특정
    // gaugePhase 스냅샷이 아니라 "누적된 진행"을 확인한다 — 사람 입력 없이도 말이 실제로 움직였는가.
    await flush(500);

    const stillAllAtStart = room.state.pieces.every((p) => p.positionKind === "start");
    expect(stillAllAtStart).toBe(false); // 최소 한 번은 자동으로 말이 움직였어야 한다
    expect(room.state.phase).toBe("playing"); // 이 정도 시간으로는 아직 승부가 나지 않는다
  });
});
