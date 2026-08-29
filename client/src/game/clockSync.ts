import type { Room } from "colyseus.js";

const SAMPLE_COUNT = 5;

interface PongMessage {
  clientSentAt: number;
  serverTime: number;
}

/**
 * 이 클라이언트 시계가 서버 시계와 얼마나 어긋나 있는지 추정한다(songpyeon과 동일 패턴,
 * client/src/game/clockSync.ts) — 서버가 내려주는 절대 시각(turnDeadlineAt)을 그대로
 * 로컬 Date.now()와 비교하면, 기기 시계가 서버(EC2)와 어긋난 경우(흔함 — 폰은 EC2처럼
 * NTP로 딱 맞춰져 있지 않음) 턴 남은 시간이 실제 서버 기준과 눈에 띄게 어긋나 보인다:
 * 내 시계가 서버보다 느리면 실제로는 이미 시간초과가 지났는데도 화면엔 아직 여유가 있는
 * 것처럼 보여서, "내 차례인데 던지지도 못하고 넘어갔다"는 체감으로 이어진다(2026-08-30
 * 발견). 왕복 5회를 재서 중간값을 쓰는 이유는 한 번의 샘플만으로는 네트워크 지연 튐에
 * 흔들리기 때문.
 */
export function estimateClockOffset<T>(room: Room<T>): Promise<number> {
  return new Promise((resolve) => {
    const samples: number[] = [];

    const unsubscribe = room.onMessage<PongMessage>("pong", (message) => {
      const receivedAt = Date.now();
      const roundTripMs = receivedAt - message.clientSentAt;
      samples.push(message.serverTime + roundTripMs / 2 - receivedAt);

      if (samples.length < SAMPLE_COUNT) {
        room.send("ping", Date.now());
        return;
      }

      unsubscribe();
      samples.sort((a, b) => a - b);
      resolve(samples[Math.floor(samples.length / 2)]);
    });

    room.send("ping", Date.now());
  });
}
