import { Client as ColyseusJsClient } from "colyseus.js";
import type { Room as ClientRoom } from "colyseus.js";
import type { Room as ServerRoom } from "colyseus";
import type { ColyseusTestServer } from "@colyseus/testing";
import { getOrCreateUser, setNickname } from "../auth/googleAuth";
import { signSession } from "../auth/session";
import type { MatchState } from "../rooms/MatchState";

// MatchRoom.onAuth가 로그인 세션을 요구하므로, 게임 로직만 검증하려는 기존 테스트들도
// "로그인된 유저로 접속"을 거쳐야 한다. 테스트용 유저를 DB에 만들고 실제 세션 쿠키를
// 발급받아, colyseus.js Client를 커스텀 Cookie 헤더로 직접 연결한다 — @colyseus/testing의
// connectTo는 헤더를 커스터마이즈할 수 없어서 이 방식이 필요하다(songpyeon과 동일 패턴).
let testUserCounter = 0;

export async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
): Promise<ClientRoom<MatchState>> {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}
