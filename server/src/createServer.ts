import express from "express";
import { createServer as createHttpServer } from "http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./rooms/MatchRoom";

export function createGameServer() {
  const app = express();
  const httpServer = createHttpServer(app);

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define("match", MatchRoom);

  // colyseus.js 0.16.x에는 client.getAvailableRooms()가 없다(songpyeon과 동일하게
  // 확인된 사실) — 서버 전용 matchMaker.query() API로 이 엔드포인트를 대신 제공한다.
  app.get("/api/rooms", async (_req, res) => {
    // dev 환경에서는 client(5173)와 server(2567)가 다른 origin이라 CORS 헤더가
    // 없으면 브라우저가 응답을 못 읽는다. 인증 없는 공개 방 목록이라 와일드카드로 열어도 안전함.
    res.header("Access-Control-Allow-Origin", "*");
    const rooms = await matchMaker.query({ name: "match", locked: false });
    res.json(
      rooms.map((r) => ({
        roomId: r.roomId,
        clients: r.clients,
        maxClients: r.maxClients,
        metadata: r.metadata,
      })),
    );
  });

  return gameServer;
}
