import { Room, Client } from "colyseus";
import { applyMove, samePosition, type Piece } from "../game/pieces";
import { SHORTCUT_JUNCTIONS, type Position } from "../game/position";
import { applyGyojuBonus, hasEffectiveCapture, resolveCaptureResponses, type CaptureRecord, type Rng } from "../game/abilities";
import {
  DEFAULT_GAUGE_CYCLE_MS,
  GRANTS_EXTRA_THROW,
  GYOJU_BONUS_RESULT,
  resolveThrow,
  YUT_STEPS,
  type YutResult,
} from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { sanitizeNickname } from "../game/nickname";
import { sanitizeRoomTitle } from "../game/roomTitle";
import {
  MatchState,
  PendingResultSchema,
  PieceSchema,
  PlayerState,
  SpectatorState,
  fromSchemaPosition,
  toSchemaPosition,
} from "./MatchState";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);
const DEFAULT_THROW_TIMEOUT_MS = 10000;
const DEFAULT_MOVE_TIMEOUT_MS = 10000;
const MAX_CHAT_LENGTH = 200;
/** 턴당 부여 가능한 추가 던지기 총량(윷/모 + 잡기 보너스 합산) — 첫 던지기 포함 최대 3회. */
const MAX_EXTRA_THROWS = 2;
/** 실제 플레이어 자리 수(2v2=4, 1v1=2)와 무관하게 넉넉히 잡아두는 Colyseus maxClients — 진짜
 * 자리 제한은 playerCapacity로 직접 관리한다(관전자가 이 한도에 걸리면 안 되므로). */
const MAX_CLIENTS_WITH_SPECTATORS = 1000;

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
  /** 실제 플레이어 자리 수(2v2=4, 1v1=2) — Colyseus maxClients는 관전자를 위해 크게 열어두므로
   * (MAX_CLIENTS_WITH_SPECTATORS), "대기 중인 방이 꽉 찼는지"는 이 값으로 직접 판정한다. */
  private playerCapacity = 4;
  /** 게임 시작 후 관전 입장을 허용할지 — 방 만들 때 결정, 기본 허용. */
  private allowSpectators = true;

  async onCreate(options?: {
    title?: string;
    mode?: "2v2" | "1v1";
    throwTimeoutMs?: number;
    moveTimeoutMs?: number;
    rng?: Rng;
    allowSpectators?: boolean;
  }) {
    this.setState(new MatchState());

    const mode = options?.mode === "1v1" ? "1v1" : "2v2";
    this.state.mode = mode;
    this.playerCapacity = mode === "1v1" ? 2 : 4;
    this.allowSpectators = options?.allowSpectators !== false;
    // 실제 인원 제한(playerCapacity)과 별개로, Colyseus 자체의 maxClients는 관전자도 받을 수
    // 있게 넉넉히 열어둔다 — onJoin이 방 단계(phase)로 플레이어/관전자를 직접 가른다.
    this.maxClients = MAX_CLIENTS_WITH_SPECTATORS;

    const title = sanitizeRoomTitle(options?.title) || "이름 없는 방";
    // matchMaker가 onCreate의 반환(Promise)을 기다려주므로, 방 생성 직후 바로
    // getAvailableRooms()/테스트에서 메타데이터를 조회해도 항상 최신 값이 보이도록 await한다.
    await this.setMetadata({
      title,
      mode,
      phase: "waiting",
      allowSpectators: this.allowSpectators,
      playerCount: 0,
      playerCapacity: this.playerCapacity,
    });

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

  /**
   * 대기 중(phase==="waiting")이고 자리가 남아있으면 플레이어로, 그 외(이미 시작됐거나 끝난
   * 방)에는 관전이 허용된 경우에만 관전자로 받는다. 둘 다 안 되면 예외를 던져 입장 자체를
   * 거부한다(Colyseus가 join 요청을 reject 처리) — 2026-08-27 관전 기능 추가.
   */
  onJoin(client: Client, options?: { nickname?: string }) {
    const nickname = sanitizeNickname(options?.nickname) || "플레이어";

    if (this.state.phase === "waiting") {
      if (this.state.players.size >= this.playerCapacity) {
        throw new Error("방이 가득 찼습니다");
      }
      const player = new PlayerState();
      player.sessionId = client.sessionId;
      player.nickname = nickname;
      this.state.players.set(client.sessionId, player);
      this.setMetadata({ playerCount: this.state.players.size });
      return;
    }

    if (!this.allowSpectators) {
      throw new Error("관전이 허용되지 않는 방입니다");
    }
    const spectator = new SpectatorState();
    spectator.sessionId = client.sessionId;
    spectator.nickname = nickname;
    this.state.spectators.set(client.sessionId, spectator);
  }

  onLeave(client: Client) {
    if (this.state.spectators.has(client.sessionId)) {
      this.state.spectators.delete(client.sessionId);
      return;
    }
    this.state.players.delete(client.sessionId);
    if (this.state.phase === "waiting") {
      this.setMetadata({ playerCount: this.state.players.size });
    }
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
    // 예전엔 여기서 this.lock()을 불렀지만, Colyseus의 진짜 lock()은 joinById 자체를 막아버려서
    // (matchmaker가 "room is locked"로 거부) 관전자도 못 들어오게 된다 — 그래서 더 이상 잠그지
    // 않고, onJoin이 phase를 보고 플레이어/관전자를 직접 가른다(관전 방지는 allowSpectators로).
    this.setMetadata({ phase: "playing" });
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

  /**
   * 말 선택 제한시간 초과 — 가장 오래 쌓인 패로, 완주하지 않은 말 중 첫 번째를 지름길 없이 이동시킨다.
   * 가장 오래 쌓인 패가 특정 말(그룹)에만 허용된 패(예: 교주 보너스)라면 아무 말이나 골라선 안
   * 되고 그 목록 안에서 골라야 한다 — 아니면 performMove가 조용히 거부해서 턴이 멈춰버린다.
   */
  private autoMove(sessionId: string) {
    if (!this.isCurrentTurn(sessionId)) return;
    const oldestPending = this.state.pendingResults[0];
    if (!oldestPending) return; // 이론상 도달 불가 — resolved 상태는 항상 pendingResults가 있어야 진입한다.
    const target =
      oldestPending.restrictedToPieceIds.length > 0
        ? this.state.pieces.find((p) => oldestPending.restrictedToPieceIds.includes(p.id))
        : this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
    if (!target) return; // 이론상 도달 불가 — 자기 말이 모두 완주했다면 이미 승리 처리되어 턴이 없다.
    this.performMove(sessionId, target.id, oldestPending.id, false);
  }

  /** 실제 movePiece와 시간초과 자동 말 선택이 공유하는 "이동 실행" 로직. */
  private performMove(sessionId: string, pieceId: string, resultId: string, useShortcut: boolean) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase !== "resolved") return;
    const pendingIndex = this.state.pendingResults.findIndex((p) => p.id === resultId);
    if (pendingIndex === -1) return;
    const pending = this.state.pendingResults[pendingIndex];
    // restrictedToPieceIds가 있는 패(예: 모서리에서 발동한 교주 보너스)는 그 목록 안의 말에만
    // 쓸 수 있다 — 아무 말이나 골라서 남의 보너스를 가로채면 안 된다.
    if (pending.restrictedToPieceIds.length > 0 && !pending.restrictedToPieceIds.includes(pieceId)) return;
    // 실제 윷 던지기 결과(YutResult) 또는 합성 패(GYOJU_BONUS_RESULT) 둘 다 올 수 있어 string으로 둔다.
    const result = pending.result;

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

    const mainCaptureRecords: CaptureRecord[] = capturedPieceIds.map((id) => {
      const original = pieces.find((p) => p.id === id)!;
      return {
        pieceId: id,
        teamId: original.teamId,
        originalPosition: original.position,
        originalPreviousPosition: original.previousPosition,
      };
    });

    // 교주 능력(REQUIREMENTS.md 능력 스펙 §3.1 — "도착한 위치의 아군 말에 업혔을 경우") — applyMove가
    // 반환한 piggybackedIds는 "출발 칸" 기준(함께 움직인 말들만)이라 이 능력엔 그대로 못 쓴다.
    // 이동한 말이 "도착한" 칸에 이미 아군 말이 있어서(그 아군은 이번 이동으로 움직이지 않고
    // 제자리에 있다가 지금 막 업힌 경우) 업힌 상태가 된 경우도 발동해야 하므로, 이동이 끝난 뒤
    // (afterMove) 실제로 이동한 말과 같은 칸에 있는 모든 아군 말을 다시 계산한다 — "출발 칸부터
    // 같이 왔던 말"과 "도착 칸에 이미 있던 말" 둘 다 이렇게 하면 자연스럽게 잡힌다. 그룹 안에
    // 교주가 하나라도 있으면 80% 확률로 그룹 전원이 1칸 더 전진한다. result가 이미 교주 보너스
    // 자체(GYOJU_BONUS_RESULT)라면 이 블록 전체를 건너뛴다 — 보너스 전진이 또 다른 보너스
    // 발동을 만들지 않는다는 스펙(§3.1 "연쇄 방지")을 지키는 가드다.
    let piecesAfterBonus = afterMove;
    let bonusCaptureRecords: CaptureRecord[] = [];
    if (result !== GYOJU_BONUS_RESULT) {
      const groupAfterMove = afterMove
        .filter(
          (p) => p.id !== pieceId && p.ownerId === moverAfterMove.ownerId && samePosition(p.position, moverAfterMove.position),
        )
        .map((p) => p.id);
      const bonus = applyGyojuBonus(afterMove, pieceId, groupAfterMove, this.rng);
      if (bonus.fired && bonus.triggeredBy) {
        this.broadcastAbility(bonus.triggeredBy, "교주");
        // 모서리(5/10/15) 또는 정확히 중앙(centerCross)에 멈춰 선 경우 둘 다 다음 이동에 실제
        // 트랙 선택지가 있다(CLAUDE.md "중앙(centerCross)에서만 트랙 전환 허용" 참고) — 이런
        // 경우 보너스를 useShortcut:false로 못박아 즉시 적용하면 안 되고, 일반 이동과 동일하게
        // 대기 패로 쌓아 플레이어가 직접 고르게 해야 한다.
        const atJunction =
          moverAfterMove.position.kind === "outer" && SHORTCUT_JUNCTIONS.has(moverAfterMove.position.index);
        const atCenterChoice =
          moverAfterMove.position.kind === "center" && moverAfterMove.position.exitVia === "cross";
        if (atJunction || atCenterChoice) {
          // 모서리/중앙에서 발동했으면 즉시 적용하지 않고, 트랙 선택을 직접 고를 수 있는
          // 대기 패로 쌓아둔다 — 일반 던지기 이동과 같은 파란 점 선택 UI를 그대로 재사용한다.
          const pendingBonus = new PendingResultSchema();
          pendingBonus.id = `p${++this.pendingResultCounter}`;
          pendingBonus.result = GYOJU_BONUS_RESULT;
          for (const id of [pieceId, ...groupAfterMove]) pendingBonus.restrictedToPieceIds.push(id);
          this.state.pendingResults.push(pendingBonus);
        } else {
          const moverAfterBonus = bonus.pieces.find((p) => p.id === pieceId)!;
          this.broadcastPieceMoved([pieceId, ...groupAfterMove], 1, false, moverAfterMove.position, moverAfterBonus.position);
          piecesAfterBonus = bonus.pieces;
          bonusCaptureRecords = bonus.capturedPieceIds.map((id) => {
            const original = afterMove.find((p) => p.id === id)!;
            return {
              pieceId: id,
              teamId: original.teamId,
              originalPosition: original.position,
              originalPreviousPosition: original.previousPosition,
            };
          });
        }
      }
      if (bonus.blockedBy) this.broadcastAbility(bonus.blockedBy, "마담");
    }

    const { pieces: updated, negatedPieceIds, effects } = resolveCaptureResponses(
      piecesAfterBonus,
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
      this.setMetadata({ phase: "finished" });
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
