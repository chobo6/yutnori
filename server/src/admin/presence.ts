// 로비에만 머물러 있는(어떤 매치 룸에도 안 들어간) 유저는 Colyseus 룸 단위로는 전혀
// 추적되지 않는다 — 그래서 "진짜 전체 접속자"를 보려면 별도의 하트비트가 필요하다.
// 클라이언트가 로그인 상태인 동안 주기적으로 `GET /api/auth/me`를 호출하고(App.tsx),
// 그 라우트가 매 호출마다 touch()를 불러 마지막으로 본 시각을 갱신한다 — 이 TTL 안에
// 다시 touch되지 않으면 접속 종료로 간주해 목록에서 빠진다.
const ONLINE_TTL_MS = 30_000;

const lastSeen = new Map<number, { nickname: string; lastSeenAt: number }>();

export function touch(userId: number, nickname: string): void {
  lastSeen.set(userId, { nickname, lastSeenAt: Date.now() });
}

export function getOnlineNicknames(): string[] {
  const now = Date.now();
  const online: string[] = [];
  for (const [userId, entry] of lastSeen) {
    if (now - entry.lastSeenAt > ONLINE_TTL_MS) {
      lastSeen.delete(userId);
      continue;
    }
    online.push(entry.nickname);
  }
  return online;
}

export function _resetForTest(): void {
  lastSeen.clear();
}
