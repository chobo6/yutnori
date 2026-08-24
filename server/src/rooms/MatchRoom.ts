import { Room, Client } from "colyseus";
import { applyMove, type Piece } from "../game/pieces";
import type { Position } from "../game/position";
import { applyGyojuBonus, hasEffectiveCapture, resolveCaptureResponses, type CaptureRecord, type Rng } from "../game/abilities";
import { DEFAULT_GAUGE_CYCLE_MS, GRANTS_EXTRA_THROW, resolveThrow, YUT_STEPS, type YutResult } from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { sanitizeNickname } from "../game/nickname";
import { sanitizeRoomTitle } from "../game/roomTitle";
import { MatchState, PendingResultSchema, PieceSchema, PlayerState, fromSchemaPosition, toSchemaPosition } from "./MatchState";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);
const DEFAULT_THROW_TIMEOUT_MS = 10000;
const DEFAULT_MOVE_TIMEOUT_MS = 10000;
const MAX_CHAT_LENGTH = 200;
/** 턴당 부여 가능한 추가 던지기 총량(윷/모 + 잡기 보너스 합산) — 첫 던지기 포함 최대 3회. */
const MAX_EXTRA_THROWS = 2;

export class MatchRoom extends Room<MatchState> {
  /** 안정적 pendingResults id 발급용 단순 증가 카운터. */
  private pendingResultCounter = 0;
  /** 이번 턴에 지금까지 부여된 추가 던지기 총량(윷/모 + 잡기 보너스 합산) — 최대 MAX_EXTRA_THROWS. */
  private extraThrowsGranted = 0;
  /** 부여는 됐지만 아직 실행하지 않은 추가 던지기 개수 — 한 번의 이동에서 최대 2번(원래 이동 + 교주 보너스) 겹쳐 부여될 수 있어 큐가 필요하다. */
  private throwsOwed = 0;
  /**
   * 현재 활성 타이머(던지기 또는 말 선택)를 구분하는 토큰. 새 타이머를 걸 때마다 증가시키고,
   * 타이머 콜백이 실행될 때 자신이 걸릴 당시의 토큰과 현재 값을 비교한다 — 이미 실제 행동으로
   * 더 앞서 나간 상태라면(값이 달라짐) 오래된 타이머는 조용히 무시된다. 별도의 타이머 취소
   * 호출 없이도 오작동을 막을 수 있는 songpyeon과 동일한 패턴.
   */
  private turnToken = 0;
  private throwTimeoutMs = DEFAULT_THROW_TIMEOUT_MS;
  private moveTimeoutMs = DEFAULT_MOVE_TIMEOUT_MS;
  /** 능력/빽도 확률 판정에 쓰는 난수 함수. 기본은 Math.random, 테스트에서 결정적 값 주입 가능. */
  private rng: Rng = Math.random;

  async onCreate(options?: {
    title?: string;
    mode?: "2v2" | "1v1";
    throwTimeoutMs?: number;
    moveTimeoutMs?: number;
    rng?: Rng;
  }) {
    this.setState(new MatchState());

    const mode = options?.mode === "1v1" ? "1v1" : "2v2";
    this.state.mode = mode;
    this.maxClients = mode === "1v1" ? 2 : 4;

    const title = sanitizeRoomTitle(options?.title) || "이름 없는 방";
    // matchMaker가 onCreate의 반환(Promise)을 기다려주므로, 방 생성 직후 바로
    // getAvailableRooms()/테스트에서 메타데이터를 조회해도 항상 최신 값이 보이도록 await한다.
    await this.setMetadata({ title, mode });

    if (typeof options?.throwTimeoutMs === "number") this.throwTimeoutMs = options.throwTimeoutMs;
    if (typeof options?.moveTimeoutMs === "number") this.moveTimeoutMs = options.moveTimeoutMs;
    if (typeof options?.rng === "function") this.rng = options.rng;

    this.onMessage("pickTeam", (client, message: { team: "A" | "B" } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (message?.team !== "A" && message?.team !== "B") return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.team = message.team;
      this.maybeStartGame();
    });

    this.onMessage("pickCharacters", (client, message: { characters: string[] } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (!Array.isArray(message?.characters)) return;
      const requiredCount = this.state.mode === "1v1" ? 4 : 2;
      if (message.characters.length !== requiredCount) return;
      if (!message.characters.every((c) => VALID_CHARACTERS.has(c))) return;
      if (this.state.mode !== "1v1" && new Set(message.characters).size !== message.characters.length) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.characters.clear();
      for (const c of message.characters) player.characters.push(c);
      this.maybeStartGame();
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
      const result = resolveThrow(this.state.throwStartAt, Date.now(), DEFAULT_GAUGE_CYCLE_MS, this.rng);
      this.resolveThrowFor(client.sessionId, result);
    });

    this.onMessage(
      "movePiece",
      (client, message: { pieceId: string; resultId: string; useShortcut?: boolean } | undefined) => {
        if (!message || typeof message.pieceId !== "string" || typeof message.resultId !== "string") return;
        this.performMove(client.sessionId, message.pieceId, message.resultId, message.useShortcut ?? false);
      },
    );

    // 채팅은 REQUIREMENTS.md §8: 말풍선으로 잠깐 표시했다가 사라지는 용도라 상태에 저장하지
    // 않는다 — 방 단계(대기실/플레이/종료)와 무관하게 전원에게(보낸 사람 포함) 브로드캐스트만 한다.
    this.onMessage("sendChat", (client, message: { text?: unknown } | undefined) => {
      if (typeof message?.text !== "string") return;
      const text = message.text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return;
      this.broadcast("chatMessage", { sessionId: client.sessionId, text });
    });
  }

  onJoin(client: Client, options?: { nickname?: string }) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.nickname = sanitizeNickname(options?.nickname) || "플레이어";
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
      character: p.character,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));
  }

  /**
   * 캐릭터 능력이 실제로 발동했을 때 브로드캐스트 — 상태(MatchState)에는 저장하지 않는다
   * (채팅 말풍선과 같은 패턴, REQUIREMENTS.md §8). 클라이언트는 이 pieceId 근처에 능력명
   * 말풍선을 잠깐 띄웠다가 자동으로 지운다.
   */
  private broadcastAbility(pieceId: string, character: "교주" | "의사" | "성직" | "마담") {
    this.broadcast("abilityTriggered", { pieceId, character });
  }

  /**
   * 말 이동(원래 이동 또는 교주 보너스 전진)이 있을 때마다 브로드캐스트 — 상태에는 저장하지
   * 않는다(채팅/능력 말풍선과 같은 패턴). from/to를 메시지에 직접 담아 보낸다 — 예전에는
   * 클라이언트가 room.state.pieces의 previousPosition을 시작점으로 읽었는데, 이 raw
   * broadcast가 상태 패치(같은 이동을 반영하는 스키마 변경)보다 먼저 도착하는 경우가 있어
   * (raw broadcast는 즉시 전송되지만 스키마 패치는 별도 주기로 배치 전송됨), 메시지 도착
   * 시점엔 아직 "이번 이동 전" 값으로 패치되지 않은 채 "그 이전 이동 전" 값(previousPosition)이
   * 남아있는 경우가 있었다 — 이미 나온 말이 다시 움직일 때 매번 출발점(start)에서 움직이는
   * 것처럼 보이던 버그의 원인. from/to를 메시지 자체에 실어 보내면 상태 패치 타이밍과 무관하게
   * 항상 정확하다. 클라이언트는 from에서 steps/useShortcut으로 중간 칸들을 직접 계산해
   * 한 칸씩 이동하는 애니메이션을 재생한다(position.ts를 그대로 미러링, matchTypes.ts와
   * 동일한 이 프로젝트의 확립된 관례) — 빽도(steps<0)일 때는 중간 경로 없이 to로 직행한다.
   */
  private broadcastPieceMoved(pieceIds: string[], steps: number, useShortcut: boolean, from: Position, to: Position) {
    const fromSchema = toSchemaPosition(from);
    const toSchema = toSchemaPosition(to);
    this.broadcast("pieceMoved", {
      pieceIds,
      steps,
      useShortcut,
      fromKind: fromSchema.kind,
      fromIndex: fromSchema.index,
      toKind: toSchema.kind,
      toIndex: toSchema.index,
    });
  }

  private isCurrentTurn(sessionId: string): boolean {
    return this.state.phase === "playing" && this.state.turnOrder[this.state.currentTurnIndex] === sessionId;
  }

  private maybeStartGame() {
    if (this.state.phase !== "waiting") return;
    const requiredPerTeam = this.state.mode === "1v1" ? 1 : 2;
    const requiredCharacters = this.state.mode === "1v1" ? 4 : 2;
    const piecesPerPlayer = this.state.mode === "1v1" ? 4 : 2;

    if (this.state.players.size !== requiredPerTeam * 2) return;
    const allPlayers = Array.from(this.state.players.values());
    if (!allPlayers.every((p) => p.ready && p.characters.length === requiredCharacters)) return;

    const teamA = allPlayers.filter((p) => p.team === "A").map((p) => p.sessionId);
    const teamB = allPlayers.filter((p) => p.team === "B").map((p) => p.sessionId);
    if (teamA.length !== requiredPerTeam || teamB.length !== requiredPerTeam) return;

    const order = buildTurnOrder(teamA, teamB);
    this.state.turnOrder.clear();
    for (const id of order) this.state.turnOrder.push(id);
    this.state.currentTurnIndex = 0;

    this.state.pieces.clear();
    for (const sessionId of [...teamA, ...teamB]) {
      const owner = this.state.players.get(sessionId)!;
      for (let i = 0; i < piecesPerPlayer; i++) {
        const piece = new PieceSchema();
        piece.id = `${sessionId}-${i}`;
        piece.ownerSessionId = sessionId;
        piece.character = owner.characters[i];
        piece.positionKind = "start";
        piece.positionIndex = -1;
        piece.previousPositionKind = "start";
        piece.previousPositionIndex = -1;
        this.state.pieces.push(piece);
      }
    }

    this.state.phase = "playing";
    this.lock(); // maxClients 자동 잠금은 플레이어 이탈 시 풀리므로 명시적으로 잠가야 한다
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
  }

  /**
   * 던지기 결과가 나올 때마다 실행 — 실제 throwRelease와 시간초과 자동 던지기가 공유한다.
   * 결과를 pendingResults에 쌓고, 윷/모이면서 예산이 남아있으면 즉시 재던지기(idle) 상태로
   * 되돌린다 — 이동 단계로 넘어가지 않는다.
   */
  private resolveThrowFor(sessionId: string, result: YutResult) {
    const pending = new PendingResultSchema();
    pending.id = `p${++this.pendingResultCounter}`;
    pending.result = result;
    this.state.pendingResults.push(pending);
    this.state.lastThrowResult = result;

    if (GRANTS_EXTRA_THROW.has(result) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }

    if (this.throwsOwed > 0) {
      this.throwsOwed--;
      this.state.gaugePhase = "idle";
      this.armThrowTimeout(sessionId);
      return;
    }

    this.state.gaugePhase = "resolved";
    this.armMoveTimeout(sessionId);
  }

  /** 던지기 제한시간(REQUIREMENTS.md §4.1) — 안 누르거나, 누르고 안 뗀 경우 둘 다 이 타이머로 처리된다. */
  private armThrowTimeout(sessionId: string) {
    const token = ++this.turnToken;
    this.state.turnDeadlineAt = Date.now() + this.throwTimeoutMs;
    this.clock.setTimeout(() => {
      if (token !== this.turnToken) return; // 이미 다른 행동으로 앞서 나간 오래된 타이머
      this.autoThrow(sessionId);
    }, this.throwTimeoutMs);
  }

  /** 말 선택 제한시간(REQUIREMENTS.md §4.1) — 던지기가 끝난 시점부터 새로 카운트. */
  private armMoveTimeout(sessionId: string) {
    const token = ++this.turnToken;
    this.state.turnDeadlineAt = Date.now() + this.moveTimeoutMs;
    this.clock.setTimeout(() => {
      if (token !== this.turnToken) return;
      this.autoMove(sessionId);
    }, this.moveTimeoutMs);
  }

  /** 던지기 제한시간 초과 — §5의 확률 분포를 그대로 따르는 무작위 결과로 대신 던진다. */
  private autoThrow(sessionId: string) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase === "resolved") return;
    const randomElapsed = this.rng() * DEFAULT_GAUGE_CYCLE_MS;
    const result = resolveThrow(0, randomElapsed, DEFAULT_GAUGE_CYCLE_MS, this.rng);
    this.resolveThrowFor(sessionId, result);
  }

  /** 말 선택 제한시간 초과 — 가장 오래 쌓인 패로, 완주하지 않은 말 중 첫 번째를 지름길 없이 이동시킨다. */
  private autoMove(sessionId: string) {
    if (!this.isCurrentTurn(sessionId)) return;
    const target = this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
    if (!target) return; // 이론상 도달 불가 — 자기 말이 모두 완주했다면 이미 승리 처리되어 턴이 없다.
    const oldestPending = this.state.pendingResults[0];
    if (!oldestPending) return; // 이론상 도달 불가 — resolved 상태는 항상 pendingResults가 있어야 진입한다.
    this.performMove(sessionId, target.id, oldestPending.id, false);
  }

  /** 실제 movePiece와 시간초과 자동 말 선택이 공유하는 "이동 실행" 로직. */
  private performMove(sessionId: string, pieceId: string, resultId: string, useShortcut: boolean) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase !== "resolved") return;
    const pendingIndex = this.state.pendingResults.findIndex((p) => p.id === resultId);
    if (pendingIndex === -1) return;
    const result = this.state.pendingResults[pendingIndex].result as YutResult;

    const targetPiece = this.state.pieces.find((p) => p.id === pieceId);
    if (!targetPiece || targetPiece.ownerSessionId !== sessionId) return;
    // 이미 완주한 말은 이동 대상이 될 수 없다 (applyMove가 예외를 던진다).
    if (targetPiece.positionKind === "finished") return;

    const pieces: Piece[] = this.toGamePieces();

    const mover = pieces.find((p) => p.id === pieceId)!;
    const { pieces: afterMove, capturedPieceIds, piggybackedIds } = applyMove(
      pieces,
      pieceId,
      YUT_STEPS[result],
      useShortcut,
    );
    const moverAfterMove = afterMove.find((p) => p.id === pieceId)!;
    this.broadcastPieceMoved(
      [pieceId, ...piggybackedIds],
      YUT_STEPS[result],
      useShortcut,
      mover.position,
      moverAfterMove.position,
    );

    // 교주 능력(REQUIREMENTS.md 능력 스펙 §3.1, 2026-08-24 조건 확장) — 이번 이동으로 실제로
    // 자리를 옮긴 말들(이동한 말 + 업힌 말들) 중 교주가 하나라도 있으면 80% 확률로 그룹 전원이
    // 1칸 더 전진한다. 이 보너스 전진이 새로 만든 잡힘도 아래 resolveCaptureResponses에 함께
    // 넘긴다(원래 이동의 잡힘 다음 순서로).
    const bonus = applyGyojuBonus(afterMove, pieceId, piggybackedIds, this.rng);
    if (bonus.fired && bonus.triggeredBy) {
      this.broadcastAbility(bonus.triggeredBy, "교주");
      const moverAfterBonus = bonus.pieces.find((p) => p.id === pieceId)!;
      this.broadcastPieceMoved([pieceId, ...piggybackedIds], 1, false, moverAfterMove.position, moverAfterBonus.position);
    }
    if (bonus.blockedBy) this.broadcastAbility(bonus.blockedBy, "마담");

    const mainCaptureRecords: CaptureRecord[] = capturedPieceIds.map((id) => {
      const original = pieces.find((p) => p.id === id)!;
      return {
        pieceId: id,
        teamId: original.teamId,
        originalPosition: original.position,
        originalPreviousPosition: original.previousPosition,
      };
    });
    const bonusCaptureRecords: CaptureRecord[] = bonus.capturedPieceIds.map((id) => {
      const original = afterMove.find((p) => p.id === id)!;
      return {
        pieceId: id,
        teamId: original.teamId,
        originalPosition: original.position,
        originalPreviousPosition: original.previousPosition,
      };
    });

    const { pieces: updated, negatedPieceIds, effects } = resolveCaptureResponses(
      bonus.pieces,
      [...mainCaptureRecords, ...bonusCaptureRecords],
      this.rng,
    );
    for (const effect of effects) {
      if (effect.negated) this.broadcastAbility(effect.pieceId, "의사");
      else if (effect.redirectedTo) this.broadcastAbility(effect.pieceId, "성직");
      else if (effect.blockedBy) this.broadcastAbility(effect.blockedBy, "마담");
    }

    for (const updatedPiece of updated) {
      const schemaPiece = this.state.pieces.find((p) => p.id === updatedPiece.id)!;
      const pos = toSchemaPosition(updatedPiece.position);
      const prevPos = toSchemaPosition(updatedPiece.previousPosition);
      schemaPiece.positionKind = pos.kind;
      schemaPiece.positionIndex = pos.index;
      schemaPiece.previousPositionKind = prevPos.kind;
      schemaPiece.previousPositionIndex = prevPos.index;
    }

    // 사용한 패 소진 — 서버 기록(pendingResults)에서 제거한다. lastThrowResult는 턴이 실제로
    // 끝나는 분기(승리 판정 / 최종 턴 넘김)에서만 비운다 — pendingResults가 아직 남아있거나
    // 보너스 던지기가 예정된 경우엔 턴이 이어지므로, 방금 던진 결과의 윷가락 시각화가 화면에
    // 계속 남아있어야 한다.
    this.state.pendingResults.splice(pendingIndex, 1);

    const finalPieces: Piece[] = this.toGamePieces();

    if (checkWinner(finalPieces, sessionId)) {
      this.state.phase = "finished";
      this.state.winnerSessionId = sessionId;
      this.state.turnDeadlineAt = 0;
      this.state.lastThrowResult = "";
      return;
    }

    if (hasEffectiveCapture(mainCaptureRecords, negatedPieceIds) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }
    if (hasEffectiveCapture(bonusCaptureRecords, negatedPieceIds) && this.extraThrowsGranted < MAX_EXTRA_THROWS) {
      this.extraThrowsGranted++;
      this.throwsOwed++;
    }

    if (this.throwsOwed > 0) {
      this.throwsOwed--;
      this.state.gaugePhase = "idle";
      this.armThrowTimeout(sessionId);
      return;
    }

    if (this.state.pendingResults.length > 0) {
      this.state.gaugePhase = "resolved";
      this.armMoveTimeout(sessionId);
      return;
    }

    this.state.gaugePhase = "idle";
    this.extraThrowsGranted = 0;
    this.throwsOwed = 0;
    this.state.lastThrowResult = "";
    this.state.currentTurnIndex = nextTurnIndex(this.state.currentTurnIndex, Array.from(this.state.turnOrder));
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
  }
}
