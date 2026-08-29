import express from "express";
import { createServer as createHttpServer } from "http";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";
import cookieParser from "cookie-parser";
import { getOrCreateUser, getUserById, setNickname, touchLastLogin, verifyGoogleIdToken } from "./auth/googleAuth";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, signSession, verifySession } from "./auth/session";
import { recordUserIp } from "./admin/userIps";
import { recordVisit } from "./admin/dailyVisits";
import { recordInquiry } from "./admin/inquiries";
import { checkPassword, createSession, destroySession, requireAdmin } from "./admin/auth";
import { isRateLimited, recordFailedAttempt, recordSuccessfulLogin } from "./admin/loginRateLimit";
import { getEvents, searchEventsByNickname } from "./admin/eventLog";
import { getChatLogs } from "./admin/chatLog";
import { getDailyVisitStats } from "./admin/dailyVisits";
import { adminSetNickname, listUsers, setUserBanned } from "./auth/googleAuth";
import { getIpsForUser } from "./admin/userIps";
import { getInquiries } from "./admin/inquiries";
import { broadcast, subscribe } from "./admin/announcements";
import { getOnlineNicknames, touch as touchPresence } from "./admin/presence";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 프로덕션 Docker 이미지에서 client의 빌드 결과(client/dist)를 여기로 복사해 넣는다(Dockerfile
 * 참고). 개발 환경(`npm run dev`)에서는 이 폴더가 없으므로 정적 서빙 자체를 건너뛴다 — client는
 * 그때 Vite(5173)가 별도로 서빙한다. */
const clientDistPath = path.join(__dirname, "../public");

export function createGameServer() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  const httpServer = createHttpServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define("match", MatchRoom);

  // colyseus.js 0.16.x에는 client.getAvailableRooms()가 없다(songpyeon과 동일하게
  // 확인된 사실) — 서버 전용 matchMaker.query() API로 이 엔드포인트를 대신 제공한다.
  app.get("/api/rooms", async (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!userId || !getUserById(userId)?.nickname) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    // dev 환경에서는 client(5173)와 server(2567)가 다른 origin이라 CORS 헤더가
    // 없으면 브라우저가 응답을 못 읽는다. 이 라우트는 위에서 이미 세션 쿠키 검증을 거치므로
    // 와일드카드를 열어도 미인증 접근이 뚫리는 건 아니다.
    res.header("Access-Control-Allow-Origin", "*");
    // 관전 기능(2026-08-27~) 도입 이후로는 진행 중인 방도 목록에 보여야(관전하기) 하므로
    // 더 이상 locked:false로 거르지 않는다 — MatchRoom.ts가 metadata.phase로 대기/진행 상태를
    // 직접 알려준다. 끝난 방(승패가 나서 아무도 다시 볼 이유가 없는 상태)만 걸러낸다.
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms
        .filter((r) => r.metadata?.phase !== "finished")
        .map((r) => ({
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          metadata: r.metadata,
        })),
    );
  });

  app.post("/api/auth/google", async (req, res) => {
    const credential = (req.body as { credential?: unknown } | undefined)?.credential;
    if (typeof credential !== "string") {
      res.status(400).json({ error: "credential이 필요합니다." });
      return;
    }
    try {
      const { sub, email, name } = await verifyGoogleIdToken(credential);
      const user = getOrCreateUser(sub, { email, name });
      const token = signSession(user.id);
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: req.secure,
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE_MS,
      });
      const ip = req.ip ?? "unknown";
      recordUserIp(user.id, ip);
      recordVisit(user.id);
      res.json(user);
    } catch (err) {
      console.error("[auth/google] 로그인 실패:", err);
      res.status(401).json({ error: "로그인에 실패했습니다." });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    const user = userId ? getUserById(userId) : undefined;
    if (!user) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    recordUserIp(user.id, req.ip ?? "unknown");
    recordVisit(user.id);
    touchLastLogin(user.id);
    // 닉네임 설정 전(로그인만 하고 아직 계정 세팅 중)에는 "접속 중인 유저" 목록에
    // 의미 있게 보여줄 이름이 없으므로 제외한다 — 닉네임이 생긴 이후부터 집계한다.
    if (user.nickname) touchPresence(user.id, user.nickname);
    res.json(user);
  });

  app.post("/api/auth/nickname", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const nickname = (req.body as { nickname?: unknown } | undefined)?.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임을 입력해주세요." });
      return;
    }
    const result = setNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
      return;
    }
    if (result === "already_set") {
      res.status(409).json({ error: "닉네임은 이미 설정되어 있습니다." });
      return;
    }
    res.json(getUserById(userId));
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(204).end();
  });

  app.post("/api/admin/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (isRateLimited(ip)) {
      res.status(429).json({ error: "너무 많이 시도했습니다. 잠시 후 다시 시도해주세요." });
      return;
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== "string" || !checkPassword(password)) {
      recordFailedAttempt(ip);
      res.status(401).json({ error: "비밀번호가 틀렸습니다." });
      return;
    }
    recordSuccessfulLogin(ip);
    const token = createSession();
    res.cookie("admin_session", token, { httpOnly: true, secure: req.secure, sameSite: "lax" });
    res.status(204).end();
  });

  app.post("/api/admin/logout", (req, res) => {
    destroySession(req.cookies?.admin_session);
    res.clearCookie("admin_session");
    res.status(204).end();
  });

  app.get("/api/admin/rooms", requireAdmin, async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    res.json(rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, metadata: r.metadata })));
  });

  app.get("/api/admin/online-users", requireAdmin, (_req, res) => {
    res.json(getOnlineNicknames());
  });

  app.get("/api/admin/events", requireAdmin, (_req, res) => {
    res.json(getEvents());
  });

  app.get("/api/admin/events/search", requireAdmin, (req, res) => {
    const nickname = req.query.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "nickname 쿼리가 필요합니다." });
      return;
    }
    res.json(searchEventsByNickname(nickname));
  });

  app.get("/api/admin/chat-logs", requireAdmin, (_req, res) => {
    res.json(getChatLogs());
  });

  app.get("/api/admin/stats/daily-visitors", requireAdmin, (_req, res) => {
    res.json(getDailyVisitStats());
  });

  app.get("/api/admin/users", requireAdmin, (req, res) => {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    res.json(listUsers(offset, limit));
  });

  app.post("/api/admin/users/:id/ban", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "잘못된 유저 ID입니다." });
      return;
    }
    const banned = Boolean((req.body as { banned?: unknown } | undefined)?.banned);
    setUserBanned(userId, banned);
    res.status(204).end();
  });

  app.post("/api/admin/users/:id/nickname", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "잘못된 유저 ID입니다." });
      return;
    }
    const nickname = (req.body as { nickname?: unknown } | undefined)?.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임을 입력해주세요." });
      return;
    }
    const result = adminSetNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
      return;
    }
    res.status(204).end();
  });

  app.get("/api/admin/users/:id/ips", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) {
      res.status(400).json({ error: "잘못된 유저 ID입니다." });
      return;
    }
    res.json(getIpsForUser(userId));
  });

  app.get("/api/admin/inquiries", requireAdmin, (_req, res) => {
    res.json(getInquiries());
  });

  app.post("/api/admin/announce", requireAdmin, (req, res) => {
    const message = (req.body as { message?: unknown } | undefined)?.message;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "메시지를 입력해주세요." });
      return;
    }
    broadcast(message.trim());
    res.status(204).end();
  });

  app.get("/api/announcements/stream", (req, res) => {
    subscribe(req, res);
  });

  app.post("/api/inquiries", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const body = req.body as { title?: unknown; content?: unknown } | undefined;
    if (typeof body?.title !== "string" || typeof body?.content !== "string" || !body.title.trim() || !body.content.trim()) {
      res.status(400).json({ error: "제목과 내용을 입력해주세요." });
      return;
    }
    recordInquiry(user.id, user.nickname, body.title.trim(), body.content.trim());
    res.status(204).end();
  });

  // 프로덕션 배포용: client 정적 파일 서빙 + SPA catch-all. /api/rooms보다 뒤에 등록해야
  // 그 라우트를 가리지 않는다. Colyseus의 웹소켓 업그레이드는 Express 라우팅이 아니라
  // httpServer의 'upgrade' 이벤트에서 직접 처리되므로 이 catch-all과 충돌하지 않는다.
  if (existsSync(path.join(clientDistPath, "index.html"))) {
    app.use(express.static(clientDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDistPath, "index.html"));
    });
  }

  return gameServer;
}
