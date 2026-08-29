// client/src/App.tsx
import { useCallback, useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";
import { useMatchRoom } from "./game/useMatchRoom";
import { fetchMe, loginWithGoogle, type Profile } from "./game/auth";
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
  useMatchRoom(room);

  useEffect(() => {
    fetchMe().then(setProfile).catch(() => setProfile(null));
  }, []);

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

  if (profile === undefined) {
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
      <ParticipantBar room={room} onLeaveLobby={() => setRoom(null)} />

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
            <GameBoard room={room} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
          </div>
        </div>
      )}

      {room.state.phase === "finished" && (
        <WinnerScreen room={room} onLeaveLobby={() => setRoom(null)} />
      )}

      {/* 대기실/플레이 화면 어디서든 항상 같은 자리(우하단)에 떠 있는 채팅창(2026-08-29~) —
          songpyeon처럼 지금까지의 채팅을 스크롤해서 볼 수 있다(예전엔 아바타 위 3초짜리 말풍선). */}
      <ChatBox room={room} />
    </div>
  );
}

export default App;
