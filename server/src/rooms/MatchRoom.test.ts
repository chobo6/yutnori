import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGameServer } from "../createServer";
import { MatchState } from "./MatchState";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

async function setupFourPlayers(colyseus: ColyseusTestServer, options: Record<string, unknown> = {}) {
  // 기본 rng는 항상 0.3으로 고정한다 — 게이지 확인 확률(2026-08-25~)이 도입된 뒤로는 rng가
  // Math.random이면 타이밍만 정확히 맞춰도 가끔(도/개/걸 30%, 윷/모 50%) 다른 패로 재판정될 수
  // 있어, 아래 *_ELAPSED_MS 상수로 특정 결과를 노리는 테스트들이 아주 드물게 flaky해진다.
  // 0.3은 모든 확인 확률(50%/70%)보다 작아 재판정이 없고, 빽도 확률(25%)보다는 커서 "도"를
  // 진짜 "도"로 유지한다(0처럼 너무 작으면 "도"가 항상 "빽도"로 재판정돼, autoThrow가 매번
  // "도" 구간을 때리는 케이스에서 시작점에 있는 말이 영원히 못 움직이는 죽은 상태에 빠진다).
  // 능력 확률까지 특정 값으로 고정해야 하는 테스트는 options로 넘겨 이 기본값을 덮어쓴다.
  const room = await colyseus.createRoom<MatchState>("match", { rng: () => 0.3, ...options });
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

// Global Constraints에 정리된 다섯 값 — 기본 flush()(~50ms)는 결과가 매번 달라지므로, 특정
// 결과를 확정해야 하는 테스트는 이 값들로 elapsed를 고정한다. 게이지가 왼쪽 "도"에서
// 시작해 오른쪽 "모"로 차오르도록 순서가 바뀌면서(2026-08-25) 각 값도 새 구간 경계에 맞게
// 다시 계산됐고, 게이지 주기가 600ms로 빨라지면서(2026-08-29) 다시 한 번 재계산됐다 — 아래
// 모든 테스트가 rng를 안 넘기거나(기본 Math.random) 결과 자체를
// 검사하지 않는 자리에서만 쓰므로, 확인 확률(70%/50%) 재판정으로 가끔 다른 패가 나와도
// 문제 없는 곳에서만 사용한다(구체적 결과를 검사하는 자리는 room.rng를 함께 고정해서 쓴다).
const DO_ELAPSED_MS = 30;
const GAE_ELAPSED_MS = 120;
const GEOL_ELAPSED_MS = 225;
const YUT_ELAPSED_MS = 270;
const MO_ELAPSED_MS = 291;

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

    await flush(GAE_ELAPSED_MS); // "개"(2칸) 구간을 노려 결과를 고정
    turnClient.send("throwRelease", {});
    await flush();

    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
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
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: otherPiece.id, resultId });
    await flush();

    const untouchedPiece = room.state.pieces.find((p) => p.id === otherPiece.id)!;
    expect(untouchedPiece.positionKind).toBe("start"); // 이동 안 됨
  });

  it("throwRelease 후에는 gaugePhase가 resolved가 되고 결과가 상태에 실린다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();

    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.lastThrowResult).not.toBe("");
  });

  it("이동하기 전에 다시 throwStart를 해도 무시된다(결과 재굴림 방지)", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
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
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
    await flush();

    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.lastThrowResult).toBe("");
  });

  it("말이 이동하면 pieceMoved가 이동한 말들 + steps/useShortcut/from/to로 브로드캐스트된다(이동 애니메이션용)", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    type PieceMovedMsg = {
      pieceIds: string[];
      steps: number;
      useShortcut: boolean;
      fromKind: string;
      fromIndex: number;
      toKind: string;
      toIndex: number;
    };
    const received: PieceMovedMsg[] = [];
    turnClient.onMessage("pieceMoved", (msg: PieceMovedMsg) => received.push(msg));

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS); // "개"(2칸)
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId, useShortcut: false });
    await flush();

    // myPiece는 새 게임에서 항상 start에서 시작하므로, 2칸 이동하면 outer(2)에 도착한다.
    expect(received).toEqual([
      {
        pieceIds: [myPiece.id],
        steps: 2,
        useShortcut: false,
        fromKind: "start",
        fromIndex: -1,
        toKind: "outer",
        toIndex: 2,
      },
    ]);
  });

  it("이미 완주한 말을 이동시키려 해도 방이 죽지 않고 말도 그대로다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;
    myPiece.positionKind = "finished";
    myPiece.positionIndex = -1;

    turnClient.send("throwStart", {});
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    const resultId = room.state.pendingResults[0].id;
    turnClient.send("movePiece", { pieceId: myPiece.id, resultId });
    await flush();

    expect(room.state.pieces.find((p) => p.id === myPiece.id)!.positionKind).toBe("finished");
    expect(room.state.phase).toBe("playing"); // 방이 살아 있음
    expect(room.state.gaugePhase).toBe("resolved"); // 이동이 성사되지 않았으므로 결과 유지

    // 방이 여전히 정상 동작하는지 확인 — 남은 말은 이동할 수 있다
    const otherPiece = room.state.pieces.find(
      (p) => p.ownerSessionId === currentTurnSessionId && p.id !== myPiece.id,
    )!;
    turnClient.send("movePiece", { pieceId: otherPiece.id, resultId });
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

  it("maxClients는 모드와 무관하게 관전자를 위해 크게 열려있고, 실제 플레이어 자리 수는 메타데이터의 playerCapacity로 정해진다(2026-08-27 관전 기능)", async () => {
    const room2v2 = await colyseus.createRoom<MatchState>("match", {});
    expect(room2v2.maxClients).toBeGreaterThan(4);
    expect(room2v2.metadata?.playerCapacity).toBe(4);

    const room1v1 = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    expect(room1v1.maxClients).toBeGreaterThan(2);
    expect(room1v1.metadata?.playerCapacity).toBe(2);
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

  it("게임이 시작되면 방은 잠기지 않지만(관전 입장을 막지 않기 위해) metadata.phase가 바뀐다(2026-08-27 관전 기능)", async () => {
    const { room } = await setupFourPlayers(colyseus);
    expect(room.locked).toBe(false);
    expect(room.metadata?.phase).toBe("playing");
  });

  it("핸들러 안에서 예외가 나도 onUncaughtException이 막아 방이 살아남는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 어떤 이유로든 핸들러 내부에서 예외가 터지는 상황을 강제한다.
    (room as unknown as { performMove: () => void }).performMove = () => {
      throw new Error("의도적으로 발생시킨 예외");
    };
    client.send("movePiece", { pieceId: "x", resultId: "x" });
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
  // 테스트들은 이 오버헤드보다 확실히 큰 제한시간(700ms)을 써서 "아직 안 끝남" 상태를 안정적으로
  // 관찰하고, 그보다 한참 뒤(300ms 추가)에 "끝남" 상태를 관찰한다. (기존 400ms/GAE_ELAPSED_MS=375ms
  // 조합은 여유가 25ms뿐이라 시스템 부하 시 간헐적으로 실패했다 — 여유를 넉넉히 키움.)
  const SAFE_TIMEOUT_MS = 700;
  const SAFE_WAIT_MS = 1000;

  it("던지기 제한시간을 넘기면 자동으로 무작위 결과가 던져진다", async () => {
    const { room } = await setupFourPlayers(colyseus, {
      throwTimeoutMs: SAFE_TIMEOUT_MS,
      moveTimeoutMs: 5000,
      // 0.5는 새 게이지 순서에서 정확히 정점(=마지막 fallback 구간인 "모")에 걸려 연속 던지기를
      // 유발한다(2026-08-25~) — 0.4는 "걸" 구간에 안전하게 걸려 체인 없이 한 번에 resolved된다.
      rng: () => 0.4,
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
      // 0.5는 새 게이지 순서에서 정확히 정점(=마지막 fallback 구간인 "모")에 걸려 연속 던지기를
      // 유발한다(2026-08-25~) — 0.4는 "걸" 구간에 안전하게 걸려 체인 없이 한 번에 resolved된다.
      rng: () => 0.4,
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
    await flush(GAE_ELAPSED_MS);
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
    await flush(GAE_ELAPSED_MS);
    turnClient.send("throwRelease", {}); // 직접 던지고, 말 선택은 일부러 안 보낸다
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");

    await flush(SAFE_WAIT_MS); // 말 선택 제한시간을 넉넉히 넘김

    expect(room.state.gaugePhase).toBe("idle"); // 자동 이동까지 완료되어 다시 idle
    expect(room.state.lastThrowResult).toBe("");
    expect(room.state.phase).toBe("playing"); // 방은 계속 진행 중
  });

  it("윷/모가 연속으로 나오면 이동 없이 즉시 재던지기하고, 최대 2회 추가(총 3회)로 막힌다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const turnClient = clients.find((c) => c.sessionId === room.state.turnOrder[room.state.currentTurnIndex])!;

    // 1번째 던지기: 윷 — 즉시 재던지기 가능 상태(idle)가 되고, 이동은 아직 안 함
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.pendingResults[0].result).toBe("yut");

    // 2번째 던지기: 또 윷 — 여전히 예산이 남아있어(1/2 사용) 다시 즉시 재던지기
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(2);

    // 3번째 던지기: 또 윷이지만 예산(최대 2회 추가)을 이미 다 썼으므로 더 이상 재던지기가 없다
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved"); // 이제 이동할 차례
    expect(room.state.pendingResults.length).toBe(3);

    // throwStart를 보내도 무시된다 — 더 던질 기회가 없다
    turnClient.send("throwStart", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");
  });

  it("쌓인 패 중 원하는 것을 골라 순서와 무관하게 이동할 수 있다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS); // 윷 — 즉시 재던지기
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("throwStart", {});
    await flush(GEOL_ELAPSED_MS); // 걸 — 윷이 아니므로 여기서 이동 단계로
    turnClient.send("throwRelease", {});
    await flush();

    expect(room.state.pendingResults.length).toBe(2);
    const [firstPending, secondPending] = room.state.pendingResults;
    expect(firstPending.result).toBe("yut");
    expect(secondPending.result).toBe("geol");

    const myPieces = room.state.pieces.filter((p) => p.ownerSessionId === currentTurnSessionId);
    // 먼저 쌓인 "윷"이 아니라 나중에 쌓인 "걸"을 먼저 쓴다 — 순서 강제 없음을 확인.
    turnClient.send("movePiece", { pieceId: myPieces[0].id, resultId: secondPending.id });
    await flush();

    const movedPiece = room.state.pieces.find((p) => p.id === myPieces[0].id)!;
    expect(movedPiece.positionIndex).toBe(3); // start(0) + geol(3칸)
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.pendingResults[0].id).toBe(firstPending.id); // "윷"은 아직 안 씀
  });

  it("잡으면 추가 던지기를 즉시 얻는다 — 남은 패가 있어도 그 자리에서 바로 실행된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPieces = room.state.pieces.filter((p) => p.ownerSessionId === currentTurnSessionId);
    // 상대팀 말 하나를 3번 칸에 미리 놓아 캡처 대상으로 만든다 — 여전히 start에 있는 나머지
    // 말들은 교주/성직 발동 조건(업기 대상 없음, onBoard 아님)을 만족하지 않아 얽히지 않는다.
    // ownerSessionId만으로 "다른 사람 소유"를 걸러내면 2v2에서 같은 팀 동료(A0 기준 A1)의 말이
    // 먼저 걸릴 수 있다(잡기는 teamId 기준이라 동료 말은 캡처되지 않는다) — 반드시 team까지 비교한다.
    const currentTeam = room.state.players.get(currentTurnSessionId)!.team;
    const enemyPiece = room.state.pieces.find(
      (p) => room.state.players.get(p.ownerSessionId)!.team !== currentTeam,
    )!;
    enemyPiece.positionKind = "outer";
    enemyPiece.positionIndex = 3;

    // 1번째 던지기: 윷 — 보너스 1회 사용, 남은 패(윷)를 쌓아둔 채 즉시 재던지기
    turnClient.send("throwStart", {});
    await flush(YUT_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.pendingResults.length).toBe(1);

    // 2번째 던지기: 걸(3칸) — 윷이 아니므로 정상적으로 이동 단계(resolved)로 전환
    turnClient.send("throwStart", {});
    await flush(GEOL_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.pendingResults.length).toBe(2);
    const geolPending = room.state.pendingResults.find((p) => p.result === "geol")!;

    // "걸"로 3번 칸까지 이동해 상대 말을 잡는다 — 잡기 보너스로 즉시 재던지기(idle)가 되고,
    // 아직 안 쓴 "윷" 패는 그대로 남아있어야 한다.
    turnClient.send("movePiece", { pieceId: myPieces[0].id, resultId: geolPending.id });
    await flush();

    expect(room.state.gaugePhase).toBe("idle"); // 잡기 보너스로 즉시 재던지기 상태
    expect(room.state.pendingResults.length).toBe(1); // "걸"만 소진, "윷"은 남음
    expect(room.state.pieces.find((p) => p.id === enemyPiece.id)!.positionKind).toBe("start"); // 상대는 시작점으로

    // 잡기 보너스로 얻은 던지기를 실제로 사용할 수 있는지 확인.
    turnClient.send("throwStart", {});
    await flush(DO_ELAPSED_MS);
    turnClient.send("throwRelease", {});
    await flush();
    expect(room.state.pendingResults.length).toBe(2); // "윷" + 방금 던진 "도"
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

  describe("관전 기능(2026-08-27)", () => {
    it("게임이 시작된 방에 새로 들어오면 플레이어가 아니라 관전자로 등록된다", async () => {
      const { room } = await setupFourPlayers(colyseus);
      const beforePlayerCount = room.state.players.size;

      const spectatorClient = await colyseus.connectTo(room);
      await flush();

      expect(room.state.players.size).toBe(beforePlayerCount); // 플레이어 수는 그대로
      expect(room.state.players.has(spectatorClient.sessionId)).toBe(false);
      expect(room.state.spectators.has(spectatorClient.sessionId)).toBe(true);
    });

    it("관전자가 나가면 spectators에서만 빠지고 players는 영향 없다", async () => {
      const { room } = await setupFourPlayers(colyseus);
      const spectatorClient = await colyseus.connectTo(room);
      await flush();
      expect(room.state.spectators.size).toBe(1);

      await spectatorClient.leave();
      await flush();

      expect(room.state.spectators.size).toBe(0);
      expect(room.state.players.size).toBe(4); // 플레이어는 그대로
    });

    it("방 만들 때 allowSpectators:false를 주면 게임 시작 후 새 입장이 거부된다", async () => {
      const { room } = await setupFourPlayers(colyseus, { allowSpectators: false });

      await expect(colyseus.connectTo(room)).rejects.toThrow();
      expect(room.state.spectators.size).toBe(0);
    });

    it("대기 중인 방이 꽉 차면(자리 4개 다 참) 5번째 입장은 거부된다", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {});
      await colyseus.connectTo(room);
      await colyseus.connectTo(room);
      await colyseus.connectTo(room);
      await colyseus.connectTo(room);
      await flush();
      expect(room.state.players.size).toBe(4);

      // 아직 phase는 "waiting"(4명 다 team/character/ready를 안 채웠으므로) — 이 상태에서
      // 5번째는 관전자가 아니라 거부되어야 한다(대기 중엔 관전 개념이 없다).
      expect(room.state.phase).toBe("waiting");
      await expect(colyseus.connectTo(room)).rejects.toThrow();
    });

    it("플레이어가 들어오고 나갈 때마다 메타데이터의 playerCount가 갱신된다", async () => {
      const room = await colyseus.createRoom<MatchState>("match", {});
      expect(room.metadata?.playerCount).toBe(0);

      const client = await colyseus.connectTo(room);
      await flush();
      expect(room.metadata?.playerCount).toBe(1);

      await client.leave();
      await flush();
      expect(room.metadata?.playerCount).toBe(0);
    });

    it("게임이 끝나면 metadata.phase가 finished로 바뀐다", async () => {
      // setupFourPlayers의 기본 rng(0.3)는 "도"(1칸) 구간을 확인 성공/빽도 없이 그대로
      // 확정시킨다(기본 flush(50)도 여전히 "도" 구간 안이라 DO_ELAPSED_MS(30)와 결과가 같다)
      // — 체인 없이 매번 정확히 1칸.
      const { room, clients } = await setupFourPlayers(colyseus);
      const winnerSessionId = room.state.turnOrder[room.state.currentTurnIndex];
      const winnerClient = clients.find((c) => c.sessionId === winnerSessionId)!;
      const winnerPieces = room.state.pieces.filter((p) => p.ownerSessionId === winnerSessionId);
      // 한 말은 이미 완주시켜두고, 나머지 한 말만 "도"(1칸) 한 번으로 완주하게 해서 턴이 다른
      // 사람에게 넘어가기 전(한 번의 movePiece)에 승리 판정까지 끝나게 한다. 도착점(20번)에
      // 정확히 도착만 해서는 완주가 아니므로(2026-08-28 변경), 이미 도착점에 있는 말이
      // 한 칸 더 가서 완주하는 시나리오로 둔다.
      winnerPieces[0].positionKind = "finished";
      winnerPieces[0].positionIndex = -1;
      winnerPieces[1].positionKind = "outer";
      winnerPieces[1].positionIndex = 20;

      winnerClient.send("throwStart", {});
      await flush(DO_ELAPSED_MS);
      winnerClient.send("throwRelease", {});
      await flush();
      winnerClient.send("movePiece", { pieceId: winnerPieces[1].id, resultId: room.state.pendingResults[0].id });
      await flush();

      expect(room.state.phase).toBe("finished");
      expect(room.metadata?.phase).toBe("finished");
    });
  });
});
