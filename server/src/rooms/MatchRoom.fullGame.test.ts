// server/src/rooms/MatchRoom.fullGame.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import type { MatchState } from "./MatchState";

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

  // guard가 60->200으로 늘어(연속 던지기 규칙상 "모" 체인이 진행 한 칸당 반복 횟수를 최대
  // 2~3배로 늘릴 수 있음) 최악의 경우 vitest 기본 테스트 타임아웃(5000ms)을 넘길 수 있어
  // 세 번째 인자로 타임아웃을 넉넉히(20000ms) 늘렸다.
  it(
    "한 플레이어의 말 2개가 모두 완주할 때까지 반복해서 던지고 이동하면 그 팀이 승리한다",
    async () => {
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
      for (const client of clients) client.send("ready", {});
      await flush();

      expect(room.state.phase).toBe("playing");

      // 승리 조건: 한 플레이어(turnOrder[0])의 말 2개가 완주할 때까지,
      // 그 사람 턴이 돌아올 때마다 "모(5칸)" 구간을 노려서 최대한 빨리 진행시킨다.
      // 게이지가 왼쪽 "도"에서 시작해 오른쪽 "모"로 차오르도록 바뀌어서(2026-08-25), mo 구간은
      // 이제 정점 근처(상한 0.9375~1.0)다 — wavePosition(x)=x for x in [0, 0.5]인 전반부에서
      // 그 근처(elapsed≈0.97*cycleMs/2)를 노린다. 정확히 맞춰도 확인 확률(모/윷은 60%)에 실패하면
      // 비중대로 재판정되어 가끔 다른 패가 나올 수 있지만, guard 여유가 넉넉해 문제 없다.
      //
      // 연속 던지기 규칙 도입 이후: turnOrder는 항상 상대팀과 교대로 진행되므로([A0,B0,A1,B1]),
      // 모든 플레이어가 매번 "모"만 던지면 다들 정확히 같은 체크포인트(5/10/15/20)를 밟게 되고,
      // 목표 플레이어의 말이 다음 턴을 기다리며 쉬는 사이 상대팀 말이 같은 칸을 밟아 계속
      // 시작점으로 되돌리는 "무한 잡기 되돌림" 균형 상태에 빠져 절대 끝나지 않는다(직접 디버그
      // 로그로 확인 — 200회를 넘겨도 고정된 4턴 주기로 영원히 반복됨). 그래서 목표 플레이어만
      // "모"로 빠르게 전진시키고, 나머지 플레이어는 체인이 없는 "도"(1칸)로 아주 느리게만
      // 전진시켜 목표 플레이어의 체크포인트 근처에 얼씬거리지 못하게 한다.
      const targetSessionId = room.state.turnOrder[0];

      for (let guard = 0; guard < 200; guard++) {
        if (room.state.phase === "finished") break;

        const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
        const currentClient = clients.find((c) => c.sessionId === currentSessionId)!;
        const isTarget = currentSessionId === targetSessionId;

        currentClient.send("throwStart", {});
        if (isTarget) {
          await flush(485); // 정점 근처 -> "모" 구간 노림(목표 플레이어만 빠르게 전진)
        } else {
          await flush(50); // "도"(1칸) 구간 — 체인 없이 아주 느리게 전진(목표 말과 체크포인트 충돌 방지)
        }
        currentClient.send("throwRelease", {});
        await flush();

        // "모"는 이제 이동 없이 즉시 재던지기를 유발할 수 있다(연속 던지기 규칙) — gaugePhase가
        // "resolved"일 때만(쓸 패가 있을 때만) 이동을 시도한다. 아직 idle이면(추가 던지기 대기 중)
        // 이번 반복은 넘어가고 다음 반복에서 다시 던진다(같은 플레이어의 턴이 계속 유지된다).
        if (room.state.gaugePhase === "resolved") {
          const myUnfinished = room.state.pieces.find(
            (p) => p.ownerSessionId === currentSessionId && p.positionKind !== "finished",
          );
          const pending = room.state.pendingResults[0];
          if (myUnfinished && pending) {
            currentClient.send("movePiece", { pieceId: myUnfinished.id, resultId: pending.id });
            await flush();
          }
        }
      }

      expect(room.state.phase).toBe("finished");
      expect(room.state.winnerSessionId).not.toBe("");
    },
    20000,
  );
});
