// server/src/rooms/MatchRoom.abilities.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { MatchState } from "./MatchState";

function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** wavePosition 상승 초입 근처를 노려 "모"(5칸) 결과를 안정적으로 얻는다 — 기존 테스트와 동일한 관례. */
const MO_TIMING_MS = 5;
// "모"는 이제 이동 없이 즉시 재던지기를 유발하므로(연속 던지기 규칙), 매번 "개" 결과로 한 번 더
// 던져 이동 가능 상태로 만든 뒤 첫 번째("모") 패를 골라 쓴다.

async function setupTeams(
  colyseus: ColyseusTestServer,
  characterPicks: [string, string][],
  roomOptions: Record<string, unknown> = {},
) {
  const room = await colyseus.createRoom<MatchState>("match", roomOptions);
  const clients = await Promise.all([
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
  ]);

  const teams = ["A", "A", "B", "B"];
  for (let i = 0; i < 4; i++) {
    clients[i].send("pickTeam", { team: teams[i] });
    clients[i].send("pickCharacters", { characters: characterPicks[i] });
  }
  await flush();
  for (const client of clients) client.send("ready", {});
  await flush();

  return { room, clients };
}

function placeAt(room: { state: MatchState }, pieceId: string, index: number) {
  const piece = room.state.pieces.find((p) => p.id === pieceId)!;
  piece.positionKind = "outer";
  piece.positionIndex = index;
  piece.previousPositionKind = "outer";
  piece.previousPositionIndex = index;
}

describe("MatchRoom 캐릭터 능력 통합", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  // turnOrder = [teamA[0], teamB[0], teamA[1], teamB[1]] (buildTurnOrder, turns.ts)에서
  // teamA[0]/teamA[1]가 clients[0]/clients[1] 중 어느 쪽인지는 join 처리 순서에 따라 달라질 수
  // 있다 — 팀 배정(clients[i]가 스스로 보낸 pickTeam) 자체는 결정적이지만, 같은 팀 내 두 명 중
  // 누가 "0번"이 되는지는 아니다. 그래서 아래 테스트들은 절대 clients[0]을 무브해로 가정하지
  // 않는다: (1) 이동시켜야 하는 캐릭터(교주 등)가 필요한 경우 같은 팀의 두 클라이언트에게
  // 항상 동일한 캐릭터 조합을 주고, (2) 실제로 첫 턴을 받은 세션을
  // `room.state.turnOrder[room.state.currentTurnIndex]`로 조회해서 사용한다. 팀 자체(A/B)는
  // 각 클라이언트가 스스로 선언하므로 clients[2]/clients[3]가 항상 팀B라는 점은 안전하게 쓸 수
  // 있다.

  it("교주가 업힌 상태로 이동해 능력이 성공하면 1칸 더 전진한다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"], // 팀A 두 명 모두 동일 — 누가 첫 턴이든 교주가 움직인다
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 모든 확률 판정 성공
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    const ally = room.state.pieces.find((p) => p.id === `${sessionId}-1`)!;
    expect(mover.positionIndex).toBe(9); // 3 + 5(모) + 1(보너스)
    expect(ally.positionIndex).toBe(9);
  });

  it("교주 능력이 실패하면 보너스 전진 없이 정상 이동만 일어난다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0.99 }, // 모든 확률 판정 실패
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    const ally = room.state.pieces.find((p) => p.id === `${sessionId}-1`)!;
    expect(mover.positionIndex).toBe(8); // 3 + 5(모), 보너스 없음
    expect(ally.positionIndex).toBe(8);
  });

  it("상대 마담이 도착 칸과 같은 줄에 있으면 교주 능력이 저지된다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 저지가 없다면 반드시 성공할 값
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const enemyMadamId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B(스스로 선언한 팀)
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);
    placeAt(room, enemyMadamId, 7); // 도착 칸(8)과 같은 줄(B: 6~10)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    expect(mover.positionIndex).toBe(8); // 저지되어 보너스 없음
  });

  it("같은 줄의 의사가 잡힘을 무효화하면 잡힌 말이 원위치에 남는다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"], // 팀A — 이동할 말의 캐릭터는 이 능력과 무관, 유효한 조합이면 된다
        ["성직", "의사"],
        ["의사", "성직"], // 팀B — 의사가 잡힌 말을 지킨다
        ["의사", "성직"],
      ],
      { rng: () => 0 }, // 마담이 없으므로 저지 없이 항상 의사가 성공
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`; // clients[3]는 항상 팀B
    const uisaId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B, 캐릭터 "의사"

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8); // 3 + 5(모)와 동일한 도착 칸
    placeAt(room, uisaId, 7); // victim과 같은 줄(B)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(8); // 잡히지 않은 것으로 복원
  });

  it("의사가 실패하면 이어서 성직이 판정해 성공 시 성직 위치로 순간이동한다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0.37 }, // 의사(0.35 미만) 실패, 성직(0.4 미만) 성공 — 마담 없음
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;
    const seongjikId = `${clients[2].sessionId}-1`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7); // 같은 줄(B) — 의사는 발동 시도하지만 실패
    placeAt(room, seongjikId, 12); // 다른 줄(C)이어도 성직은 제한 없음

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(12); // 성직 위치로 순간이동
  });

  it("의사와 성직이 모두 실패하면 정상적으로 시작점으로 돌아간다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0.99 }, // 둘 다 실패
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;
    const seongjikId = `${clients[2].sessionId}-1`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7);
    placeAt(room, seongjikId, 12);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("start"); // 정상적으로 잡힘
  });

  it("교주 보너스 전진이 새로 만든 잡힘에도 의사가 정상적으로 반응한다(메인 이동 도착 칸이 아니라 보너스 도착 칸)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"], // 팀A — 누가 첫 턴이든 교주가 움직인다
        ["의사", "성직"],
        ["의사", "성직"], // 팀B — clients[2]-0은 항상 의사
      ],
      { rng: () => 0 }, // 모든 확률 판정 성공(교주 보너스도, 의사 구조도)
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`;
    const allyId = `${sessionId}-1`;
    const victimId = `${clients[3].sessionId}-0`; // clients[3]는 항상 팀B
    const uisaId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B, 캐릭터 "의사"

    placeAt(room, moverId, 3);
    placeAt(room, allyId, 3); // 업기 발생 -> 메인 이동 도착 칸은 8
    placeAt(room, victimId, 9); // 메인 도착 칸(8)이 아니라 보너스 도착 칸(9)에 배치
    placeAt(room, uisaId, 7); // victim의 원래 칸(9)과 같은 줄(B: 6~10)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패를 쓴다
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const ally = room.state.pieces.find((p) => p.id === allyId)!;
    expect(mover.positionIndex).toBe(9); // 3 + 5(모) + 1(보너스)
    expect(ally.positionIndex).toBe(9);

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(9); // 의사가 구조 — start로 보내지지 않고 원위치에 남는다
  });

  // 스펙에서 가장 미묘한 규칙: 의사가 잡기를 무효화하면 잡기 보너스 던지기를 주지 않지만,
  // 성직이 리다이렉트하면(잡기 자체는 "유효"했던 것으로 취급) 보너스 던지기를 그대로 준다.
  // performMove의 두 hasEffectiveCapture(...) 호출이 이 구분을 실제로 지키는지 룸 레벨에서
  // 검증한다 — 순수 함수 단위 테스트(abilities.test.ts)만으로는 이 두 호출이 뒤바뀌거나
  // 누락돼도 잡히지 않는다.

  it("의사가 잡기를 무효화하면 보너스 던지기를 안 준다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"], // 팀A — 이동할 말의 캐릭터는 이 능력과 무관, 유효한 조합이면 된다
        ["성직", "의사"],
        ["의사", "성직"], // 팀B — 의사가 잡힌 말을 지킨다
        ["의사", "성직"],
      ],
      { rng: () => 0 }, // 마담이 없으므로 저지 없이 항상 의사가 성공
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`; // clients[3]는 항상 팀B
    const uisaId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B, 캐릭터 "의사"

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8); // 3 + 5(모)와 동일한 도착 칸
    placeAt(room, uisaId, 7); // victim과 같은 줄(B)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();

    // 첫 번째로 쌓인 "모" 패로 잡기를 시도한다 — 의사가 무효화하므로 보너스 던지기는 없다.
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    // 보너스가 지급되지 않았으므로 throwsOwed는 0이지만, 체인 중 미리 쌓아둔 "개" 패가 아직
    // pendingResults에 남아있어 턴은 아직 끝나지 않는다(같은 플레이어가 그 패로 한 번 더
    // 이동해야 한다) — resolveThrowFor가 "모"/"개" 두 패를 모두 쌓아둔 뒤에야 이동을 허용하는
    // 이 파일의 체인 탈출 패턴 특성상 불가피하다.
    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.turnOrder[room.state.currentTurnIndex]).toBe(moverSessionId);

    // 남은 "개" 패를 아무것도 잡지 않는 무해한 이동으로 마저 소진해 턴을 실제로 종료시킨다.
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(8); // 잡히지 않은 것으로 복원

    // 보너스 던지기가 한 번도 없었고 다른 남은 패도 없으므로 턴이 실제로 다음 사람에게 넘어간다.
    expect(room.state.pendingResults.length).toBe(0);
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.turnOrder[room.state.currentTurnIndex]).not.toBe(moverSessionId);
  });

  it("성직이 리다이렉트하면 보너스 던지기를 준다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0.37 }, // 의사(0.35 미만) 실패, 성직(0.4 미만) 성공 — 마담 없음
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;
    const seongjikId = `${clients[2].sessionId}-1`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7); // 같은 줄(B) — 의사는 발동 시도하지만 실패
    placeAt(room, seongjikId, 12); // 다른 줄(C)이어도 성직은 제한 없음

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // 첫 번째로 쌓인 "모" 패로 잡기
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(12); // 성직 위치로 순간이동 — 잡기 자체는 유효했던 것으로 취급된다

    // 성직의 리다이렉트는 "무효화"(negated)가 아니므로 잡기 보너스 던지기가 그대로 지급된다 —
    // 같은 플레이어가 보너스 던지기를 기다리는 상태(idle)이지, 턴이 다음 사람에게 넘어간 게
    // 아니다.
    expect(room.state.gaugePhase).toBe("idle");
    expect(room.state.turnOrder[room.state.currentTurnIndex]).toBe(moverSessionId);
  });

  // 능력 발동 UI(말풍선)는 상태(MatchState)가 아니라 chatMessage와 같은 방식의 순수
  // 브로드캐스트("abilityTriggered")로 전달된다 — 여기서는 그 브로드캐스트가 실제로
  // 나가는지, pieceId/character가 올바른지만 검증한다.

  it("교주 능력이 발동하면 abilityTriggered가 이동한 말의 pieceId로 브로드캐스트된다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id });
    await flush();

    expect(received).toEqual([{ pieceId: `${sessionId}-0`, character: "교주" }]);
  });

  it("교주가 업혀서 함께 온 경우에도 발동하고, abilityTriggered는 그 교주(업힌 말)의 pieceId로 나간다(2026-08-24 조건 확장)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"], // 팀A — ${sessionId}-0은 교주, -1은 성직
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-1`; // 성직(교주 아님)을 직접 이동시킨다
    const gyojuId = `${sessionId}-0`; // 같은 칸에서 업혀서 함께 이동하는 교주
    placeAt(room, moverId, 3);
    placeAt(room, gyojuId, 3);

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const gyoju = room.state.pieces.find((p) => p.id === gyojuId)!;
    expect(mover.positionIndex).toBe(9); // 3 + 5(모) + 1(보너스) — 성직 자신은 교주가 아니어도 그룹이 함께 전진
    expect(gyoju.positionIndex).toBe(9);
    expect(received).toEqual([{ pieceId: gyojuId, character: "교주" }]); // 발동 주체는 업혀서 온 교주
  });

  it("교주가 혼자 이동해 도착한 칸에 이미 아군 말이 있어 업힌 경우에도 발동한다(출발 칸이 아니라 도착 칸 기준 업기)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"], // 팀A — ${sessionId}-0은 교주
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`; // 교주 — 출발 칸(3)에는 혼자 있다(업기 대상 없음)
    const allyId = `${sessionId}-1`; // 도착 칸(8)에 이미 자리잡고 있던 아군 — 이동으로 움직이지 않았다
    placeAt(room, moverId, 3);
    placeAt(room, allyId, 8); // 3 + 5(모) = 8, 교주가 도착하는 바로 그 칸

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const ally = room.state.pieces.find((p) => p.id === allyId)!;
    expect(mover.positionIndex).toBe(9); // 3 + 5(모) + 1(보너스) — 도착 칸에서 업혔어도 발동
    expect(ally.positionIndex).toBe(9); // 도착 칸에 있던 아군도 보너스 전진에 함께 딸려간다
    expect(received).toEqual([{ pieceId: moverId, character: "교주" }]);
  });

  it("교주 보너스가 모서리에서 발동하면 즉시 적용하지 않고 지름길 선택 대기 패로 쌓인다(2026-08-25)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"], // 팀A — ${sessionId}-0은 교주
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 확률 판정 전부 성공
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`; // 교주
    const allyId = `${sessionId}-1`;
    placeAt(room, moverId, 2);
    placeAt(room, allyId, 2); // 업기 발생 -> 걸(3칸)로 도착 칸이 정확히 5번(지름길 모서리)

    moverClient.send("throwStart", {});
    await flush(188); // "걸" 구간
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const ally = room.state.pieces.find((p) => p.id === allyId)!;
    // 보너스가 즉시 적용되지 않아 5번(모서리)에 그대로 멈춰 있어야 한다.
    expect(mover.positionKind).toBe("outer");
    expect(mover.positionIndex).toBe(5);
    expect(ally.positionIndex).toBe(5);

    // 대신 지름길 선택을 기다리는 교주 보너스 대기 패가 쌓인다.
    expect(room.state.pendingResults.length).toBe(1);
    const bonusPending = room.state.pendingResults[0];
    expect(bonusPending.result).toBe("gyojuBonus");
    expect(Array.from(bonusPending.restrictedToPieceIds).sort()).toEqual([allyId, moverId].sort());
    expect(room.state.gaugePhase).toBe("resolved"); // 이동 선택 UI가 계속 떠 있어야 함
    expect(room.state.turnOrder[room.state.currentTurnIndex]).toBe(sessionId); // 턴도 안 넘어감

    // 지름길을 선택하면(useShortcut:true) 일반 이동과 똑같이 shortcutIn으로 들어간다.
    moverClient.send("movePiece", { pieceId: moverId, resultId: bonusPending.id, useShortcut: true });
    await flush();

    const moverAfterBonus = room.state.pieces.find((p) => p.id === moverId)!;
    const allyAfterBonus = room.state.pieces.find((p) => p.id === allyId)!;
    expect(moverAfterBonus.positionKind).toBe("shortcutIn5");
    expect(moverAfterBonus.positionIndex).toBe(1);
    expect(allyAfterBonus.positionKind).toBe("shortcutIn5"); // 업힌 아군도 함께 지름길로 들어간다
    expect(room.state.pendingResults.length).toBe(0);
  });

  it("교주 보너스 대기 패에서 지름길을 안 쓰면(useShortcut:false) 그냥 바깥길로 1칸 간다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`;
    const allyId = `${sessionId}-1`;
    placeAt(room, moverId, 2);
    placeAt(room, allyId, 2);

    moverClient.send("throwStart", {});
    await flush(188);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const bonusPending = room.state.pendingResults[0];
    moverClient.send("movePiece", { pieceId: moverId, resultId: bonusPending.id, useShortcut: false });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    expect(mover.positionKind).toBe("outer");
    expect(mover.positionIndex).toBe(6); // 5번에서 지름길 없이 1칸 더
  });

  it("의사가 잡기를 무효화하면 abilityTriggered가 구조된(원위치 복원된) 말의 pieceId로 브로드캐스트된다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0 },
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7);

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    expect(received).toEqual([{ pieceId: victimId, character: "의사" }]);
  });

  it("마담이 저지하면 abilityTriggered가 그 마담의 pieceId로 브로드캐스트된다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 저지가 없다면 반드시 성공할 값
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const enemyMadamId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B, 캐릭터 "마담"
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);
    placeAt(room, enemyMadamId, 7); // 도착 칸(8)과 같은 줄(B)

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(375);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id });
    await flush();

    expect(received).toEqual([{ pieceId: enemyMadamId, character: "마담" }]);
  });
});
