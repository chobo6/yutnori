import { Room, Client, type AuthContext } from "colyseus";
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
import { getCookieValue, SESSION_COOKIE_NAME, verifySession } from "../auth/session";
import { getUserById } from "../auth/googleAuth";
import { recordEvent } from "../admin/eventLog";
import { recordChatLog } from "../admin/chatLog";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);
const DEFAULT_THROW_TIMEOUT_MS = 10000;
const DEFAULT_MOVE_TIMEOUT_MS = 10000;
/** 게임 진행 중(playing) 갑작스런 연결 끊김에 주는 재접속 유예 시간(초). 대기실 이탈이나
 * "나가기" 버튼 클릭 같은 의도적 퇴장(consented)에는 적용하지 않는다 — 플레이 중엔 애초에
 * 나가기 버튼이 없어(ParticipantBar.tsx) 이 단계의 끊김은 항상 의도치 않은 것이다. 클라이언트의
 * localStorage 재접속 유예 판단(client/src/colyseus.ts)과 반드시 같은 값을 써야 한다. */
const RECONNECTION_GRACE_SECONDS = 20;
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
  /** 이벤트 로그(events 테이블)에 남길 방 제목 — onCreate에서 1회 설정. */
  private roomTitle = "";
  /** 같은 계정이 탭/기기 두 개로 같은 방에 동시에 플레이어로 들어오는 걸 막기 위한
   * sessionId -> userId 매핑. 관전자는 여기 안 들어간다. */
  private playerUserIds = new Map<string, number>();
  /** 재접속 유예 시간(초) — 기본 RECONNECTION_GRACE_SECONDS(20), 테스트에서 짧게 주입 가능. */
  private reconnectionGraceSeconds = RECONNECTION_GRACE_SECONDS;

  async onCreate(options?: {
    title?: string;
    mode?: "2v2" | "1v1";
    throwTimeoutMs?: number;
    moveTimeoutMs?: number;
    reconnectionGraceSeconds?: number;
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
    this.roomTitle = title;
    // matchMaker가 onCreate의 반환(Promise)을 기다려주므로, 방 생성 직후 바로
    // getAvailableRooms()/테스트에서 메타데이터를 조회해도 항상 최신 값이 보이도록 await한다.
    await this.setMetadata({
      title,
      mode,
      phase: "waiting",
      allowSpectators: this.allowSpectators,
      playerCount: 0,
      playerCapacity: this.playerCapacity,
      nicknames: [] as string[],
    });

    if (typeof options?.throwTimeoutMs === "number") this.throwTimeoutMs = options.throwTimeoutMs;
    if (typeof options?.moveTimeoutMs === "number") this.moveTimeoutMs = options.moveTimeoutMs;
    if (typeof options?.reconnectionGraceSeconds === "number") {
      this.reconnectionGraceSeconds = options.reconnectionGraceSeconds;
    }
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

    // 게임 종료 후 로비로 나가지 않고 같은 방의 대기실로 바로 돌아간다(2026-08-30 추가) —
    // 플레이어 아무나 눌러도 방 전체에 즉시 적용된다(팀 배정/준비 완료 토글과 같은 패턴).
    // 관전자는 대상이 아니다(자기 말이 없으니 "대기실로"의 의미가 없다 — 그대로 관전 유지).
    this.onMessage("returnToWaitingRoom", (client) => {
      if (this.state.phase !== "finished") return;
      if (!this.state.players.has(client.sessionId)) return;
      this.returnToWaitingRoom();
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
      // 관전자 채팅은 닉네임에 "(관전)"을 붙여 기록한다(songpyeon과 동일 관례) — 관리자
      // 채팅 로그만 봐서는 플레이어와 관전자를 구분할 방법이 없어서다. 입장/퇴장 이벤트
      // 로그(recordEvent)는 이미 type이 spectate_join/spectate_leave로 따로 구분되므로
      // 여기서 건드리지 않는다 — 닉네임에 접미사가 필요한 건 채팅 로그뿐이다.
      const isSpectator = this.state.spectators.has(client.sessionId);
      recordChatLog(isSpectator ? `${client.auth.nickname} (관전)` : client.auth.nickname, text);
    });

    // 클라이언트가 자기 시계와 서버 시계의 오차를 추정할 때 쓰는 왕복 시간 측정용
    // (client/src/game/clockSync.ts, songpyeon과 동일 패턴) — 로그인/게임 진행 상태와
    // 무관하게 언제든 응답한다.
    this.onMessage("ping", (client, clientSentAt: unknown) => {
      if (typeof clientSentAt !== "number") return;
      client.send("pong", { clientSentAt, serverTime: Date.now() });
    });
  }

  /**
   * Colyseus의 ws-transport가 실제 클라이언트 IP를 이미 계산해서 context.ip로 준다.
   * IP 외에 로그인 세션도 검증한다 — WS 업그레이드 요청은 Express의 cookie-parser를
   * 안 거치므로(Express 미들웨어 체인 밖) 쿠키 헤더를 직접 파싱한다. 세션이 없거나,
   * 계정에 닉네임이 아직 없거나(로그인만 하고 닉네임 설정을 안 끝냄), 밴된 계정이면
   * 입장 자체를 거부한다 — 클라이언트는 로그인+닉네임 설정을 먼저 끝내지 않으면 방
   * 목록조차 못 보므로, 이 경로는 직접 API 호출이나 세션이 로비 중간에 만료된 경우에만
   * 실제로 발동한다.
   */
  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
    const userId = verifySession(token);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      throw new Error("로그인이 필요합니다.");
    }
    if (user.bannedAt) {
      throw new Error("이용이 제한된 계정입니다.");
    }
    return { ip: context.ip, userId: user.id, nickname: user.nickname };
  }

  /**
   * 대기 중(phase==="waiting")이고 자리가 남아있으면 플레이어로, 그 외(이미 시작됐거나 끝난
   * 방)에는 관전이 허용된 경우에만 관전자로 받는다. 둘 다 안 되면 예외를 던져 입장 자체를
   * 거부한다(Colyseus가 join 요청을 reject 처리) — 2026-08-27 관전 기능 추가.
   */
  onJoin(client: Client) {
    const nickname = client.auth.nickname;
    const ip = String(client.auth.ip ?? "unknown");

    if (this.state.phase === "waiting") {
      if (this.state.players.size >= this.playerCapacity) {
        throw new Error("방이 가득 찼습니다");
      }
      // 같은 계정이 탭/기기 두 개로 이미 이 방에 플레이어로 들어와 있으면 또 자리를
      // 차지하지 못하게 막는다(관전은 이 체크와 무관).
      if ([...this.playerUserIds.values()].includes(client.auth.userId)) {
        throw new Error("이미 이 방에 참가 중인 계정입니다.");
      }
      const player = new PlayerState();
      player.sessionId = client.sessionId;
      player.nickname = nickname;
      this.state.players.set(client.sessionId, player);
      this.playerUserIds.set(client.sessionId, client.auth.userId);
      this.setMetadata({
        playerCount: this.state.players.size,
        nicknames: [...this.state.players.values()].map((p) => p.nickname),
      });
      recordEvent({
        type: "join",
        timestamp: Date.now(),
        nickname,
        roomId: this.roomId,
        roomTitle: this.roomTitle,
        ip,
        sessionId: client.sessionId,
      });
      return;
    }

    if (!this.allowSpectators) {
      throw new Error("관전이 허용되지 않는 방입니다");
    }
    const spectator = new SpectatorState();
    spectator.sessionId = client.sessionId;
    spectator.nickname = nickname;
    this.state.spectators.set(client.sessionId, spectator);
    recordEvent({
      type: "spectate_join",
      timestamp: Date.now(),
      nickname,
      roomId: this.roomId,
      roomTitle: this.roomTitle,
      ip,
      sessionId: client.sessionId,
    });
  }

  async onLeave(client: Client, consented: boolean) {
    const ip = String(client.auth?.ip ?? "unknown");
    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      // 관전자는 재접속 유예 대상이 아니다 — 다시 들어와서 관전하면 그만이라 자리를
      // 붙잡아둘 이유가 없다.
      this.state.spectators.delete(client.sessionId);
      recordEvent({
        type: "spectate_leave",
        timestamp: Date.now(),
        nickname: spectator.nickname,
        roomId: this.roomId,
        roomTitle: this.roomTitle,
        ip,
        sessionId: client.sessionId,
      });
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // 게임 진행 중(playing) 갑작스런 연결 끊김(consented=false)만 재접속 유예를 준다 —
    // 대기실 이탈은 다른 사람이 그 자리에 들어올 수 있어야 하므로 유예 없이 즉시 처리한다.
    if (!consented && this.state.phase === "playing") {
      try {
        await this.allowReconnection(client, this.reconnectionGraceSeconds);
        // 재접속 성공 — Colyseus의 재접속은 onAuth를 다시 안 거치므로, 유예 시간 동안
        // 계정이 밴됐을 가능성을 여기서 직접 다시 확인해야 한다(재접속 후 그대로 게임에
        // 남아있게 되는 걸 막기 위함).
        const freshUser = client.auth?.userId ? getUserById(client.auth.userId) : undefined;
        if (freshUser?.bannedAt) {
          this.state.players.delete(client.sessionId);
          this.playerUserIds.delete(client.sessionId);
          client.leave();
        }
        return;
      } catch {
        // 유예 시간 안에 재접속하지 못함 — 아래로 내려가 평소처럼 완전히 퇴장 처리한다.
      }
    }

    this.state.players.delete(client.sessionId);
    this.playerUserIds.delete(client.sessionId);
    if (this.state.phase === "waiting") {
      this.setMetadata({
        playerCount: this.state.players.size,
        nicknames: [...this.state.players.values()].map((p) => p.nickname),
      });
    }
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: player.nickname,
      roomId: this.roomId,
      roomTitle: this.roomTitle,
      ip,
      sessionId: client.sessionId,
    });
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

  /** 빽도가 실제로 뒤로 옮길 대상이 있는지 판단할 때 쓴다 — start(대기 중)/finished(완주)는
   * "판 위"가 아니다. */
  private hasPieceOnBoard(sessionId: string): boolean {
    return this.state.pieces.some(
      (p) => p.ownerSessionId === sessionId && p.positionKind !== "start" && p.positionKind !== "finished",
    );
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
   * "returnToWaitingRoom" 메시지 처리 — maybeStartGame이 채웠던 진행 상태를 전부 되돌려
   * phase를 다시 "waiting"으로 만든다. 팀/캐릭터 선택은 편의상 그대로 유지하고(다시 고르지
   * 않아도 되게), 준비 완료만 초기화해서 전원이 다시 "준비 완료"를 눌러야 새 게임이 시작되게
   * 한다 — 누군가의 실수/뒤늦은 클릭으로 곧바로 재시작돼버리는 걸 막기 위함이다.
   */
  private returnToWaitingRoom() {
    this.state.phase = "waiting";
    this.setMetadata({ phase: "waiting" });
    this.state.pieces.clear();
    this.state.turnOrder.clear();
    this.state.currentTurnIndex = 0;
    this.state.pendingResults.clear();
    this.state.winnerSessionId = "";
    this.state.gaugePhase = "idle";
    this.state.throwStartAt = 0;
    this.state.lastThrowResult = "";
    this.state.turnDeadlineAt = 0;
    this.extraThrowsGranted = 0;
    this.throwsOwed = 0;
    this.turnToken++; // 혹시 남아있을 예전 던지기/이동 타이머 콜백을 무력화
    for (const player of this.state.players.values()) {
      player.ready = false;
    }
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

    // 빽도인데 판 위(=대기 중도 완주도 아닌)에 내 말이 하나도 없으면 어느 말을 골라도 제자리
    // 이동일 뿐이다(moveBackward가 start는 그대로 start로 되돌림) — 클라이언트도 이 경우
    // 도착 칸을 계산해내지 못해(positionToCoords("start", …)가 null) 말을 선택해도 확정할
    // 방법이 없어 10초 시간초과까지 화면이 멈춘 것처럼 보인다. 그 대기 없이 곧장 이 패를
    // 소비하고 턴을 넘긴다 — performMove가 알아서 다음 대기 패/턴 전환까지 이어서 처리한다.
    if (result === "backDo" && !this.hasPieceOnBoard(sessionId)) {
      const target = this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
      if (target) {
        this.state.gaugePhase = "resolved";
        this.performMove(sessionId, target.id, pending.id, false);
        return;
      }
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
   * 빽도는 예외적으로 판 위(대기 중도 완주도 아닌)에 있는 말을 우선 고른다 — 배열 순서대로
   * "완주 안 한 첫 번째 말"을 그냥 고르면, 아직 대기 중인(시작점) 말이 먼저 골라져 아무
   * 효과 없이(제자리 유지) 빽도가 낭비될 수 있다(2026-08-30 발견).
   */
  private autoMove(sessionId: string) {
    if (!this.isCurrentTurn(sessionId)) return;
    const oldestPending = this.state.pendingResults[0];
    if (!oldestPending) return; // 이론상 도달 불가 — resolved 상태는 항상 pendingResults가 있어야 진입한다.
    let target: PieceSchema | undefined;
    if (oldestPending.restrictedToPieceIds.length > 0) {
      target = this.state.pieces.find((p) => oldestPending.restrictedToPieceIds.includes(p.id));
    } else if (oldestPending.result === "backDo") {
      target =
        this.state.pieces.find(
          (p) => p.ownerSessionId === sessionId && p.positionKind !== "start" && p.positionKind !== "finished",
        ) ?? this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
    } else {
      target = this.state.pieces.find((p) => p.ownerSessionId === sessionId && p.positionKind !== "finished");
    }
    if (!target) return; // 이론상 도달 불가 — 자기 말이 모두 완주했다면 이미 승리 처리되어 턴이 없다.
    this.performMove(sessionId, target.id, oldestPending.id, false);
  }

  /** 실제 movePiece와 시간초과 자동 말 선택이 공유하는 "이동 실행" 로직. */
  private performMove(sessionId: string, pieceId: string, resultId: string, useShortcut: boolean) {
    if (!this.isCurrentTurn(sessionId) || this.state.gaugePhase !== "resolved") return;

    // 교주 보너스는 "발동한 시점"에만 유효한 일회성 기회다(REQUIREMENTS.md §3.1) — 제한시간이
    // 남아있어도, 다른 패를 먼저 쓰기로 한 결정 자체가 곧 그 기회가 지나갔다는 뜻이다. 지금
    // 쓰려는 패(resultId)가 그 보너스 자신이 아니라면, 아직 안 쓰고 남아있는 교주 보너스를
    // 이번 이동을 적용하기 전에 먼저 버린다(2026-08-30). 반대로 플레이어가 그냥 아무 것도
    // 안 하고 시간초과된 경우(autoMove가 이 보너스 자신을 오래된 패로 골라 여기로 넘어온
    // 경우)는 이 반복문에서 걸러지지 않는다(resultId가 이 보너스 자신이라 stale.id!==resultId
    // 조건에 안 걸림) — 일반 패와 동일하게 서버가 대신 이동시켜준다(2026-08-30, useShortcut
    // 기본값 false).
    for (let i = this.state.pendingResults.length - 1; i >= 0; i--) {
      const stale = this.state.pendingResults[i];
      if (stale.result === GYOJU_BONUS_RESULT && stale.id !== resultId) {
        this.state.pendingResults.splice(i, 1);
      }
    }

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

    // 교주 능력(REQUIREMENTS.md 능력 스펙 §3.1) — 전진/포획 대상 그룹은 "도착 칸에 있는 전원"
    // 기준이라 applyMove가 반환한 piggybackedIds("출발 칸" 기준, 함께 움직인 말들만)만으로는
    // 부족하다. 이동이 끝난 뒤(afterMove) 실제로 이동한 말과 같은 칸에 있는 모든 아군 말을
    // 다시 계산해 "출발 칸부터 같이 왔던 말"과 "도착 칸에 이미 있던 말" 둘 다 그룹에 넣는다 —
    // 성공 시 이 그룹 전원이 함께 전진한다. 다만 "발동 여부" 판정은 이 그룹 전체가 아니라
    // 이번 이동으로 실제로 움직인 쪽(mover + 출발 칸 기준 piggybackedIds)만 본다(2026-08-30) —
    // 가만히 있던 교주 위로 다른 말이 이동해와 업힌 경우까지 발동시키면 안 되기 때문이다
    // (server/src/game/abilities.ts의 applyGyojuBonus 문서 참고). result가 이미 교주 보너스
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
      const bonus = applyGyojuBonus(afterMove, pieceId, groupAfterMove, piggybackedIds, this.rng);
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
