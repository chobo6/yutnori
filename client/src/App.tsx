// client/src/App.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";
import { useMatchRoom } from "./game/useMatchRoom";
import { fetchMe, loginWithGoogle, ping, type Profile } from "./game/auth";
import { clearReconnectInfo, loadValidReconnectToken, reconnectToRoom, saveReconnectInfo } from "./colyseus";
import { GoogleLoginScreen } from "./components/GoogleLoginScreen";
import { NicknameSetupScreen } from "./components/NicknameSetupScreen";
import { InquiryModal } from "./components/InquiryModal";
import { AnnouncementBanner } from "./components/AnnouncementBanner";
import { RoomList } from "./components/RoomList";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { PlayerCorner } from "./components/PlayerCorner";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatBox } from "./components/ChatBox";
import { assignCorners } from "./game/cornerSlots";
import styles from "./App.module.css";

function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = 아직 확인 전
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showInquiry, setShowInquiry] = useState(false);
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const { clockOffsetMs } = useMatchRoom(room);

  // "나가기"/"로비로 돌아가기"처럼 의도적으로 room.leave()를 부르는 경로임을 표시하는
  // 플래그(2026-08-29~) — room.onLeave는 의도적 퇴장과 갑작스런 연결 끊김을 구분 없이
  // 똑같이 호출하므로, 아래 재접속 effect가 "방금 그 leave가 의도한 것이었는지"를 알아야
  // 자동 재접속을 걸지 말지 판단할 수 있다.
  const intentionalLeaveRef = useRef(false);
  // 마운트 시 재접속 시도가 끝나기 전까지 로비 화면이 잠깐 보였다 게임 화면으로 바뀌는
  // 깜빡임을 막기 위한 게이트(아래 렌더 분기에서 profile 체크보다 먼저 검사한다).
  const [reconnectAttempted, setReconnectAttempted] = useState(false);

  const handleLeaveLobby = useCallback(() => {
    intentionalLeaveRef.current = true;
    clearReconnectInfo();
    room?.leave();
    setRoom(null);
  }, [room]);

  useEffect(() => {
    fetchMe().then(setProfile).catch(() => setProfile(null));
  }, []);

  // 탭/창을 완전히 닫았다가 20초 안에 다시 열었을 때 하던 게임에 자동으로 재접속한다
  // (2026-08-29~, 설계: 게임 플레이 중 갑작스런 연결 끊김만 대상 — server/src/rooms/MatchRoom.ts의
  // RECONNECTION_GRACE_SECONDS 참고). 마운트당 한 번만 시도하면 되므로 의존성 배열을 비워둔다.
  useEffect(() => {
    const token = loadValidReconnectToken();
    if (!token) {
      setReconnectAttempted(true);
      return;
    }
    reconnectToRoom(token)
      .then((reconnectedRoom) => {
        saveReconnectInfo(reconnectedRoom.reconnectionToken);
        setRoom(reconnectedRoom);
      })
      .catch(() => {
        clearReconnectInfo();
      })
      .finally(() => {
        setReconnectAttempted(true);
      });
  }, []);

  // room에 들어갈 때마다(최초 입장이든 재접속 성공이든) 최신 토큰을 저장해둔다 — 저장을
  // 안 하면 재접속에 성공한 뒤 또 끊겼을 때 이미 만료된 옛 토큰으로 재시도하게 된다.
  useEffect(() => {
    if (room) saveReconnectInfo(room.reconnectionToken);
  }, [room]);

  // 게임 진행 중(playing) 갑작스런 연결 끊김에서 자동 재접속을 시도한다. "나가기"/"로비로
  // 돌아가기"처럼 의도적으로 나간 경우(intentionalLeaveRef)는 재접속을 걸지 않는다 — 어차피
  // 서버도 그런 경우엔 유예를 안 주지만(consented=true), 클라이언트에서도 같은 판단을
  // 미리 걸러서 불필요한 재접속 시도를 하지 않는다.
  useEffect(() => {
    if (!room) return;
    const currentRoom = room;
    function handleUnexpectedLeave() {
      if (intentionalLeaveRef.current) {
        intentionalLeaveRef.current = false;
        return;
      }
      reconnectToRoom(currentRoom.reconnectionToken)
        .then((reconnectedRoom) => {
          saveReconnectInfo(reconnectedRoom.reconnectionToken);
          setRoom(reconnectedRoom);
        })
        .catch(() => {
          clearReconnectInfo();
          setRoom(null);
        });
    }
    currentRoom.onLeave(handleUnexpectedLeave);
    return () => {
      currentRoom.onLeave.remove(handleUnexpectedLeave);
    };
  }, [room]);

  // 로비에만 머물러 어떤 매치 룸에도 안 들어간 유저는 서버 입장에서 실시간으로 추적할
  // 방법이 없다 — 로그인 상태인 동안 주기적으로 핑을 보내서 관리자 대시보드의
  // "현재 접속자"(server/src/admin/presence.ts, TTL 30초)가 갱신되게 한다.
  useEffect(() => {
    if (!profile) return;
    const interval = setInterval(ping, 15000);
    return () => clearInterval(interval);
  }, [profile]);

  const handleCredential = useCallback(async (credential: string) => {
    setLoginError(null);
    try {
      const p = await loginWithGoogle(credential);
      setProfile(p);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    }
  }, []);

  // 이동할 말을 보드/코너에서 직접 선택하는 UI(마피아42 실제 게임처럼 말 선택 -> 도착 칸이
  // 파란 점으로 표시)를 위한 선택 상태 — GameBoard와 PlayerCorner 둘 다 대기 중인 말도
  // 클릭 대상이 될 수 있어야 해서 공통 조상인 여기서 들고 내려준다. 말 선택이 유효한 건
  // gaugePhase가 "resolved"일 때뿐이므로, 그 상태를 벗어나면(이동 완료, 시간초과 등) 항상
  // 정리해서 다음 내 턴에 지난 선택이 남아있지 않게 한다.
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  useEffect(() => {
    if (room && room.state?.gaugePhase !== "resolved") setSelectedPieceId(null);
  }, [room, room?.state?.gaugePhase]);

  if (!reconnectAttempted || profile === undefined) {
    return <p>불러오는 중...</p>;
  }

  if (profile === null) {
    return <GoogleLoginScreen onCredential={handleCredential} error={loginError} />;
  }

  if (!profile.nickname) {
    return <NicknameSetupScreen onDone={(nickname) => setProfile({ ...profile, nickname })} />;
  }

  const nickname = profile.nickname;

  if (!room) {
    return (
      <>
        <AnnouncementBanner />
        <RoomList
          nickname={nickname}
          onRoomJoined={setRoom}
          onOpenInquiry={() => setShowInquiry(true)}
          onSessionExpired={() => setProfile(null)}
        />
        {showInquiry && <InquiryModal onClose={() => setShowInquiry(false)} />}
      </>
    );
  }

  // create()/joinById()는 시트 예약이 끝나면 바로 resolve되고, 초기 state 전체 동기화는
  // 그 직후 별도 메시지(리플렉션 스키마 핸드셰이크 + 첫 패치)로 도착한다 — 그 사이 한두 틱
  // 동안 room.state 자체 또는 그 안의 players 같은 컬렉션 필드가 아직 없을 수 있어, 이
  // 시점에 바로 읽으면 깨진다. useMatchRoom이 다음 상태 도착 시 다시 렌더시키므로 여기서는
  // 잠깐 대기 화면만 보여주면 된다.
  if (!room.state?.players) {
    return <p>입장하는 중...</p>;
  }

  const corners = room.state.phase === "playing" ? assignCorners(room.state) : null;

  return (
    <div>
      <AnnouncementBanner />
      {/* 대기실/플레이/종료 단계와 무관하게 항상 표시 — 참가자/관전자 아바타 + 나가기 버튼. */}
      <ParticipantBar room={room} onLeaveLobby={handleLeaveLobby} />

      {room.state.phase === "waiting" && <WaitingRoom room={room} />}

      {room.state.phase === "playing" && corners && (
        <div className={styles.playScreen}>
          <div className={styles.topLeft}>
            {corners.topLeft && (
              <PlayerCorner
                room={room}
                sessionId={corners.topLeft}
                selectedPieceId={selectedPieceId}
                onSelectPiece={setSelectedPieceId}
              />
            )}
          </div>
          <div className={styles.topRight}>
            {corners.topRight && (
              <PlayerCorner
                room={room}
                sessionId={corners.topRight}
                selectedPieceId={selectedPieceId}
                onSelectPiece={setSelectedPieceId}
              />
            )}
          </div>
          <div className={styles.bottomLeft}>
            {corners.bottomLeft && (
              <PlayerCorner
                room={room}
                sessionId={corners.bottomLeft}
                selectedPieceId={selectedPieceId}
                onSelectPiece={setSelectedPieceId}
              />
            )}
          </div>
          <div className={styles.bottomRight}>
            {corners.bottomRight && (
              <PlayerCorner
                room={room}
                sessionId={corners.bottomRight}
                selectedPieceId={selectedPieceId}
                onSelectPiece={setSelectedPieceId}
              />
            )}
          </div>
          <div className={styles.boardArea}>
            <GameBoard
              room={room}
              selectedPieceId={selectedPieceId}
              onSelectPiece={setSelectedPieceId}
              clockOffsetMs={clockOffsetMs}
            />
          </div>
        </div>
      )}

      {room.state.phase === "finished" && (
        <WinnerScreen room={room} onLeaveLobby={handleLeaveLobby} />
      )}

      {/* 대기실/플레이 화면 어디서든 항상 같은 자리(우하단)에 떠 있는 채팅창(2026-08-29~) —
          songpyeon처럼 지금까지의 채팅을 스크롤해서 볼 수 있다(예전엔 아바타 위 3초짜리 말풍선). */}
      <ChatBox room={room} />
    </div>
  );
}

export default App;
