import { Room, Client } from "colyseus";
import { applyMove, type Piece } from "../game/pieces";
import { resolveThrow, YUT_STEPS, type YutResult } from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { MatchState, PieceSchema, PlayerState, fromSchemaPosition, toSchemaPosition } from "./MatchState";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;
  private pendingThrows = new Map<string, YutResult>();

  onCreate() {
    this.setState(new MatchState());

    this.onMessage("pickTeam", (client, message: { team: "A" | "B" } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (message?.team !== "A" && message?.team !== "B") return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.team = message.team;
    });

    this.onMessage("pickCharacters", (client, message: { characters: string[] } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (!Array.isArray(message?.characters)) return;
      if (message.characters.length !== 2 || !message.characters.every((c) => VALID_CHARACTERS.has(c))) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.characters.clear();
      for (const c of message.characters) player.characters.push(c);
    });

    this.onMessage("ready", (client) => {
      if (this.state.phase !== "waiting") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = !player.ready;
      this.maybeStartGame();
    });

    this.onMessage("throwStart", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "idle") return;
      this.state.gaugePhase = "charging";
      this.state.throwStartAt = Date.now();
    });

    this.onMessage("throwRelease", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "charging") return;
      const result = resolveThrow(this.state.throwStartAt, Date.now());
      this.pendingThrows.set(client.sessionId, result);
      this.state.lastThrowResult = result;
      // "resolved" 상태에서는 throwStart 가드에 걸려 재던지기가 불가능하다 (이동해야 다시 idle).
      this.state.gaugePhase = "resolved";
    });

    this.onMessage("movePiece", (client, message: { pieceId: string; useShortcut?: boolean } | undefined) => {
      if (!message || typeof message.pieceId !== "string") return;
      this.handleMovePiece(client, message);
    });
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  /**
   * 핸들러 안에서 발생한 예외가 프로세스를 죽이지 않도록 하는 최후의 방어선.
   * 이 메서드가 정의돼 있어야 Colyseus가 onMessage 핸들러를 try/catch로 감싼다.
   */
  onUncaughtException(err: unknown, methodName: string) {
    console.error(`[MatchRoom:${this.roomId}] ${methodName} 처리 중 예외 발생:`, err);
  }

  /** PieceSchema[] -> 순수 Piece[] 변환 (teamId는 players에서 조회해 채운다). */
  private toGamePieces(): Piece[] {
    return this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      teamId: this.state.players.get(p.ownerSessionId)?.team ?? "",
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));
  }

  private isCurrentTurn(sessionId: string): boolean {
    return this.state.phase === "playing" && this.state.turnOrder[this.state.currentTurnIndex] === sessionId;
  }

  private maybeStartGame() {
    if (this.state.players.size !== 4) return;
    const allPlayers = Array.from(this.state.players.values());
    if (!allPlayers.every((p) => p.ready && p.characters.length === 2)) return;

    const teamA = allPlayers.filter((p) => p.team === "A").map((p) => p.sessionId);
    const teamB = allPlayers.filter((p) => p.team === "B").map((p) => p.sessionId);
    if (teamA.length !== 2 || teamB.length !== 2) return;

    const order = buildTurnOrder([teamA[0], teamA[1]], [teamB[0], teamB[1]]);
    this.state.turnOrder.clear();
    for (const id of order) this.state.turnOrder.push(id);
    this.state.currentTurnIndex = 0;

    this.state.pieces.clear();
    for (const sessionId of [...teamA, ...teamB]) {
      for (let i = 0; i < 2; i++) {
        const piece = new PieceSchema();
        piece.id = `${sessionId}-${i}`;
        piece.ownerSessionId = sessionId;
        piece.positionKind = "start";
        piece.positionIndex = -1;
        piece.previousPositionKind = "start";
        piece.previousPositionIndex = -1;
        this.state.pieces.push(piece);
      }
    }

    this.state.phase = "playing";
  }

  private handleMovePiece(client: Client, message: { pieceId: string; useShortcut?: boolean }) {
    if (!this.isCurrentTurn(client.sessionId)) return;
    const result = this.pendingThrows.get(client.sessionId);
    if (!result) return;

    const targetPiece = this.state.pieces.find((p) => p.id === message.pieceId);
    if (!targetPiece || targetPiece.ownerSessionId !== client.sessionId) return;
    // 이미 완주한 말은 이동 대상이 될 수 없다 (applyMove가 예외를 던진다).
    if (targetPiece.positionKind === "finished") return;

    const pieces: Piece[] = this.toGamePieces();

    const { pieces: updated } = applyMove(pieces, message.pieceId, YUT_STEPS[result], message.useShortcut ?? false);

    for (const updatedPiece of updated) {
      const schemaPiece = this.state.pieces.find((p) => p.id === updatedPiece.id)!;
      const pos = toSchemaPosition(updatedPiece.position);
      const prevPos = toSchemaPosition(updatedPiece.previousPosition);
      schemaPiece.positionKind = pos.kind;
      schemaPiece.positionIndex = pos.index;
      schemaPiece.previousPositionKind = prevPos.kind;
      schemaPiece.previousPositionIndex = prevPos.index;
    }

    // 던지기 결과 소진 — 서버 기록(pendingThrows)과 동기화 상태(lastThrowResult)를 항상 함께 비운다.
    this.pendingThrows.delete(client.sessionId);
    this.state.lastThrowResult = "";
    this.state.gaugePhase = "idle";

    const finalPieces: Piece[] = this.toGamePieces();

    if (checkWinner(finalPieces, client.sessionId)) {
      this.state.phase = "finished";
      this.state.winnerSessionId = client.sessionId;
      return;
    }

    this.state.currentTurnIndex = nextTurnIndex(
      this.state.currentTurnIndex,
      Array.from(this.state.turnOrder),
      result,
    );
  }
}
