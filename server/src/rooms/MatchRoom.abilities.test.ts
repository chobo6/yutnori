// server/src/rooms/MatchRoom.abilities.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { MatchState } from "./MatchState";
import { connectAsUser } from "../testUtils/connectAsUser";
import { db } from "../db/connection";

function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 매 호출마다 다음 값을 순서대로 반환하고, 다 쓰면 마지막 값을 계속 반환하는 결정적 rng.
 * 던지기 확인 확률(게이지 확인/재판정, 2026-08-25~)과 능력 확률 판정이 같은 room.rng를
 * 공유하므로, "던지기는 항상 확정 성공 + 그 이후 능력 판정은 항상 실패"처럼 단계별로 다른
 * 값이 필요한 테스트에 쓴다(flat 상수 하나로는 표현 불가능한 조합). */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** wavePosition 정점 근처(게이지가 왼쪽 "도"에서 오른쪽 "모"로 차오르므로, 2026-08-25~)를
 * 노려 "모"(5칸) 결과를 안정적으로 얻는다. 이 파일 대부분의 테스트가 rng:()=>0 또는
 * rng:()=>0.37을 쓰는데 둘 다 확인 확률(모/윷 50%, 도/개/걸 70%, 2026-08-29 윷/모 60%→50%)보다
 * 작아 재판정 없이 그대로 확정되지만, "능력 판정을 전부 실패시키는" 0.99 하나는 확인 확률
 * 자체를 넘겨(재판정을 유발하고, 재판정 결과도 우연히 항상 "모"가 되어) 두 번째("개")
 * 던지기까지 덮어써버리므로 그 테스트들만 sequence()로 던지기 확인은 성공시키고 능력
 * 판정만 실패시킨다. */
const MO_TIMING_MS = 291;
// "모"는 이제 이동 없이 즉시 재던지기를 유발하므로(연속 던지기 규칙), 매번 "개" 결과로 한 번 더
// 던져 이동 가능 상태로 만든 뒤 첫 번째("모") 패를 골라 쓴다.

// setupTeams는 이 파일의 유일한 접속 지점이라, 매 호출마다 서로 겹치지 않는 닉네임 4개를
// 자동으로 생성한다(닉네임은 전역 유니크 제약이라 필요) — 테스트 각각이 개별 캐릭터 조합만
// 신경 쓰면 되도록, 호출부에 닉네임을 일일이 넘기게 하지 않는다.
let setupTeamsCallSeq = 0;

async function setupTeams(
  colyseus: ColyseusTestServer,
  characterPicks: [string, string][],
  roomOptions: Record<string, unknown> = {},
) {
  const room = await colyseus.createRoom<MatchState>("match", roomOptions);
  setupTeamsCallSeq += 1;
  const callId = setupTeamsCallSeq;
  const clients = await Promise.all([
    connectAsUser(colyseus, room, `능력${callId}-0`),
    connectAsUser(colyseus, room, `능력${callId}-1`),
    connectAsUser(colyseus, room, `능력${callId}-2`),
    connectAsUser(colyseus, room, `능력${callId}-3`),
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
  beforeEach(() => {
    // 닉네임이 전역 유니크 제약이라, 테스트 간에 남은 유저 레코드가 있으면 같은 문자열
    // 닉네임을 다시 쓸 때 setNickname이 "taken"을 반환해 onAuth가 로그인 거부로 이어진다.
    db.exec("DELETE FROM users");
  });

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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
      { rng: sequence(0.49, 0.5, 0.99) }, // 던지기 확인은 성공(모->개 순서 그대로), 능력 판정은 전부 실패
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
      { rng: sequence(0.49, 0.5, 0.99) }, // 던지기 확인은 성공(모->개 순서 그대로), 능력 판정은 둘 다 실패
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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

  it("업기로 겹쳐 있던 상대 말 2개를 한꺼번에 잡으면, 의사가 구할 때 둘 다 함께 부활한다(그룹당 확률 1회, 2026-08-30)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"], // 팀A — 이동할 말의 캐릭터는 무관, 유효한 조합이면 됨
        ["교주", "성직"],
        ["마담", "성직"], // 팀B — 이 두 말이 업혀서 함께 잡힐 스택
        ["의사", "성직"], // 팀B — clients[3]-0은 항상 의사(그룹 밖의 구조자)
      ],
      { rng: () => 0 }, // 확률 판정 전부 성공
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victim1Id = `${clients[2].sessionId}-0`;
    const victim2Id = `${clients[2].sessionId}-1`;
    const uisaId = `${clients[3].sessionId}-0`; // 항상 팀B, 캐릭터 "의사"

    placeAt(room, moverId, 3);
    placeAt(room, victim1Id, 8); // 3 + 5(모) — 도착 칸
    placeAt(room, victim2Id, 8); // victim1과 업혀서 스택을 이룬 상태
    placeAt(room, uisaId, 7); // victim들의 원래 칸(8)과 같은 줄(B: 6~10), 스택 밖의 별개 말

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(120); // "개" 구간 — 체인이 끝나 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id }); // "모"로 이동해 스택을 잡음
    await flush();

    const victim1 = room.state.pieces.find((p) => p.id === victim1Id)!;
    const victim2 = room.state.pieces.find((p) => p.id === victim2Id)!;
    expect(victim1.positionKind).toBe("outer");
    expect(victim1.positionIndex).toBe(8); // 둘 다 의사가 구조
    expect(victim2.positionKind).toBe("outer");
    expect(victim2.positionIndex).toBe(8);
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
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
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

    // 잡는 이동 자체는 "개"(윷/모가 아닌 결과)로 해야 한다 — 윷/모로 잡으면 그 자체로 이미
    // 받은 윷/모 추가 던지기와 별개로 잡기 보너스까지 겹쳐 주지 않기로 했으므로(2026-08-30),
    // "잡으면 보너스 던지기를 준다"는 이 테스트의 핵심 전제를 윷/모가 가려버리면 안 된다.
    placeAt(room, moverId, 6); // 6 + 2("개") = 8, victim과 같은 칸
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7); // 같은 줄(B) — 의사는 발동 시도하지만 실패
    placeAt(room, seongjikId, 12); // 다른 줄(C)이어도 성직은 제한 없음

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS); // "모" — chains into another throw under the new rules
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(120); // "개" 구간 — 윷/모가 아니므로 여기서 체인이 끝나고 이동 가능(resolved)해진다
    moverClient.send("throwRelease", {});
    await flush();
    const gaePending = room.state.pendingResults.find((p) => p.result === "gae")!;
    moverClient.send("movePiece", { pieceId: moverId, resultId: gaePending.id }); // "개"로 잡기
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
    await flush(120);
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
    await flush(120);
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
    await flush(120);
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

  it("가만히 있던 교주 위로 다른 말이 이동해와 업힌 경우엔 발동하지 않는다(2026-08-30)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "교주"], // 팀A — ${sessionId}-0은 성직, -1은 교주
        ["성직", "교주"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`; // 성직(교주 아님) — 출발 칸(3)에는 혼자 있다
    const gyojuId = `${sessionId}-1`; // 도착 칸(8)에 이미 자리잡고 가만히 있던 교주 — 이번 이동으로 움직이지 않았다
    placeAt(room, moverId, 3);
    placeAt(room, gyojuId, 8); // 3 + 5(모) = 8, 성직이 도착하는 바로 그 칸

    const received: Array<{ pieceId: string; character: string }> = [];
    moverClient.onMessage("abilityTriggered", (msg: { pieceId: string; character: string }) => received.push(msg));

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(120);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const gyoju = room.state.pieces.find((p) => p.id === gyojuId)!;
    expect(mover.positionIndex).toBe(8); // 3 + 5(모), 보너스 없음 — 가만히 있던 교주는 발동 주체가 아니다
    expect(gyoju.positionIndex).toBe(8);
    expect(received).toEqual([]); // abilityTriggered 없음
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
    await flush(225); // "걸" 구간
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

  it("교주 보너스 대기 패를 제한시간 안에 스스로 쓰지 않으면 일반 패와 동일하게 서버가 대신 이동시킨다(지름길 미사용, 2026-08-30)", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"], // 팀A — ${sessionId}-0은 교주
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0, moveTimeoutMs: 300 },
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const moverId = `${sessionId}-0`; // 교주
    const allyId = `${sessionId}-1`;
    placeAt(room, moverId, 2);
    placeAt(room, allyId, 2); // 업기 발생 -> 걸(3칸)로 도착 칸이 정확히 5번(지름길 모서리)

    moverClient.send("throwStart", {});
    await flush(225); // "걸" 구간
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId, resultId: room.state.pendingResults[0].id });
    await flush();

    // 지름길 선택 대기 패가 쌓였다 — 여기서 movePiece를 보내지 않고 제한시간을 넘긴다.
    expect(room.state.pendingResults.length).toBe(1);
    expect(room.state.pendingResults[0].result).toBe("gyojuBonus");
    await flush(500); // moveTimeoutMs(300)보다 넉넉히 대기

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const ally = room.state.pieces.find((p) => p.id === allyId)!;
    expect(mover.positionIndex).toBe(6); // 5 + 1(보너스), 시간초과라 지름길 없이 자동 이동
    expect(ally.positionIndex).toBe(6);
    expect(room.state.pendingResults.length).toBe(0); // 자동으로 소진됨
    expect(room.state.turnOrder[room.state.currentTurnIndex]).not.toBe(sessionId); // 턴이 다음 사람에게 넘어감
  });

  it("교주 보너스 대기 패가 쌓인 상태에서 다른 대기 패를 먼저 쓰면, 제한시간이 남아있어도 곧바로 사라진다(2026-08-30)", async () => {
    // "발동한 시점에만 유효한 일회성 기회"는 시간과 무관하다 — 시간이 남아있어도 플레이어가
    // 다른 패를 먼저 쓰기로 한 순간 이미 그 기회는 지나간 것이다. moveTimeoutMs를 넉넉히 줘서
    // 시간초과가 아니라 "다른 패를 먼저 씀" 자체가 소멸 원인임을 분명히 한다.
    // 1v1 모드를 써서 같은 플레이어가 4개의 말(교주/성직/마담/의사)을 전부 갖게 한다 — 두
    // 번째 이동에 쓸 말(의사)이 교주와 전혀 업혀있지 않은 완전히 별개의 말이어야, 그 이동
    // 자체가 새로운 교주 보너스를 또 만들어내는 혼선 없이 "먼저 쓰지 않은 보너스가 사라지는지"만
    // 순수하게 검증할 수 있다.
    const room = await colyseus.createRoom<MatchState>("match", { rng: () => 0, moveTimeoutMs: 5000, mode: "1v1" });
    const clientA = await connectAsUser(colyseus, room, "교주보너스순서A");
    const clientB = await connectAsUser(colyseus, room, "교주보너스순서B");
    clientA.send("pickTeam", { team: "A" });
    clientA.send("pickCharacters", { characters: ["교주", "성직", "마담", "의사"] });
    clientB.send("pickTeam", { team: "B" });
    clientB.send("pickCharacters", { characters: ["의사", "의사", "마담", "마담"] });
    await flush();
    clientA.send("ready", {});
    clientB.send("ready", {});
    await flush();

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = [clientA, clientB].find((c) => c.sessionId === sessionId)!;
    const gyojuId = `${sessionId}-0`; // 교주
    const seongjikId = `${sessionId}-1`; // 성직 — 교주와 업혀서 보너스를 발동시킬 말
    const uisaId = `${sessionId}-3`; // 의사 — 교주와 전혀 무관한, 두 번째 이동에 쓸 말
    placeAt(room, gyojuId, 5);
    placeAt(room, seongjikId, 5); // 업기 발생 -> 모(5칸)로 도착 칸이 정확히 10번(지름길 모서리)
    placeAt(room, uisaId, 2); // 교주 그룹과 완전히 별개인 위치

    // 모(5칸, 윷/모라 체인) -> 개(2칸, 체인이 끝나 이동 가능) 순으로 던져 대기 패 2개를 쌓는다.
    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("throwStart", {});
    await flush(120); // "개" 구간
    moverClient.send("throwRelease", {});
    await flush();
    expect(room.state.pendingResults.length).toBe(2);
    const moPending = room.state.pendingResults[0];
    const gaePending = room.state.pendingResults[1];

    // 먼저 "모" 패로 교주+성직을 함께 10번(모서리)까지 이동시켜 교주 보너스를 발동시킨다.
    moverClient.send("movePiece", { pieceId: gyojuId, resultId: moPending.id });
    await flush();

    expect(room.state.pendingResults.length).toBe(2); // 개 패 + 교주 보너스 대기 패
    const bonusPending = room.state.pendingResults.find((p) => p.result === "gyojuBonus")!;
    expect(bonusPending).toBeDefined();

    // 교주 보너스를 쓰지 않고, 대신 남아있던 "개" 패를 교주와 무관한 의사 말에 먼저 쓴다.
    moverClient.send("movePiece", { pieceId: uisaId, resultId: gaePending.id });
    await flush();

    const uisa = room.state.pieces.find((p) => p.id === uisaId)!;
    expect(uisa.positionIndex).toBe(4); // 2 + 2(개) — 교주와 무관하니 보너스 판정 자체가 없음
    // 아직 이동 선택 제한시간(5000ms)이 한참 남아있는데도, 다른 패를 먼저 썼으므로 교주
    // 보너스는 이미 사라져 있어야 한다.
    expect(room.state.pendingResults.some((p) => p.result === "gyojuBonus")).toBe(false);
    expect(room.state.pendingResults.length).toBe(0);
    expect(room.state.turnOrder[room.state.currentTurnIndex]).not.toBe(sessionId); // 턴도 넘어감
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
    await flush(225);
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

  it("교주 보너스가 정확히 중앙(centerCross)에서 발동하면 즉시 적용하지 않고 트랙 선택 대기 패로 쌓인다(2026-08-25)", async () => {
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
    placeAt(room, moverId, 5); // 이미 5번 모서리에 있다
    placeAt(room, allyId, 5); // 업기 발생

    moverClient.send("throwStart", {});
    await flush(225); // "걸"(3칸) 구간
    moverClient.send("throwRelease", {});
    await flush();
    // 지름길(useShortcut:true)로 3칸 이동 -> 5번+지름길+3칸 = 정확히 중앙(centerCross)
    moverClient.send("movePiece", {
      pieceId: moverId,
      resultId: room.state.pendingResults[0].id,
      useShortcut: true,
    });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    const ally = room.state.pieces.find((p) => p.id === allyId)!;
    // 보너스가 즉시 적용되지 않아 중앙에 그대로 멈춰 있어야 한다.
    expect(mover.positionKind).toBe("centerCross");
    expect(ally.positionKind).toBe("centerCross");

    // 대신 트랙 선택을 기다리는 교주 보너스 대기 패가 쌓인다.
    expect(room.state.pendingResults.length).toBe(1);
    const bonusPending = room.state.pendingResults[0];
    expect(bonusPending.result).toBe("gyojuBonus");
    expect(Array.from(bonusPending.restrictedToPieceIds).sort()).toEqual([allyId, moverId].sort());
    expect(room.state.gaugePhase).toBe("resolved");
    expect(room.state.turnOrder[room.state.currentTurnIndex]).toBe(sessionId);

    // 도착 방향(useShortcut:true)을 고르면 shortcutOut(완주 트랙)으로 전환된다.
    moverClient.send("movePiece", { pieceId: moverId, resultId: bonusPending.id, useShortcut: true });
    await flush();

    const moverAfterBonus = room.state.pieces.find((p) => p.id === moverId)!;
    const allyAfterBonus = room.state.pieces.find((p) => p.id === allyId)!;
    expect(moverAfterBonus.positionKind).toBe("shortcutOut");
    expect(moverAfterBonus.positionIndex).toBe(1);
    expect(allyAfterBonus.positionKind).toBe("shortcutOut");
    expect(room.state.pendingResults.length).toBe(0);
  });

  it("교주 보너스가 중앙에서 발동하고 원래 트랙(useShortcut:false)을 고르면 그대로 15번 방향으로 간다", async () => {
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
    placeAt(room, moverId, 5);
    placeAt(room, allyId, 5);

    moverClient.send("throwStart", {});
    await flush(225);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", {
      pieceId: moverId,
      resultId: room.state.pendingResults[0].id,
      useShortcut: true,
    });
    await flush();

    const bonusPending = room.state.pendingResults[0];
    moverClient.send("movePiece", { pieceId: moverId, resultId: bonusPending.id, useShortcut: false });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === moverId)!;
    expect(mover.positionKind).toBe("shortcutCross"); // 원래 트랙(15번 방향) 그대로 유지
    expect(mover.positionIndex).toBe(1);
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
    await flush(120);
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
    await flush(120);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0`, resultId: room.state.pendingResults[0].id });
    await flush();

    expect(received).toEqual([{ pieceId: enemyMadamId, character: "마담" }]);
  });
});
