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

    this.onMessage("pickTeam", (client, message: { team: "A" | "B" }) => {
      if (this.state.phase !== "waiting") return;
      if (message.team !== "A" && message.team !== "B") return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.team = message.team;
    });

    this.onMessage("pickCharacters", (client, message: { characters: string[] }) => {
      if (this.state.phase !== "waiting") return;
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
      this.state.gaugePhase = "idle";
    });

    this.onMessage("movePiece", (client, message: { pieceId: string; useShortcut?: boolean }) => {
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

    const pieces: Piece[] = this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));

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

    this.pendingThrows.delete(client.sessionId);

    const finalPieces: Piece[] = this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));

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
