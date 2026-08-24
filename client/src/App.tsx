// client/src/App.tsx
import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";
import { useMatchRoom } from "./game/useMatchRoom";
import { getStoredNickname } from "./game/nickname";
import { NicknameGate } from "./components/NicknameGate";
import { RoomList } from "./components/RoomList";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { PlayerCorner } from "./components/PlayerCorner";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatInput } from "./components/ChatInput";
import { assignCorners } from "./game/cornerSlots";
import styles from "./App.module.css";

function App() {
  const [nickname, setNickname] = useState<string | null>(() => getStoredNickname());
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  useMatchRoom(room);

  // 이동할 말을 보드/코너에서 직접 선택하는 UI(마피아42 실제 게임처럼 말 선택 -> 도착 칸이
  // 파란 점으로 표시)를 위한 선택 상태 — GameBoard와 PlayerCorner 둘 다 대기 중인 말도
  // 클릭 대상이 될 수 있어야 해서 공통 조상인 여기서 들고 내려준다. 말 선택이 유효한 건
  // gaugePhase가 "resolved"일 때뿐이므로, 그 상태를 벗어나면(이동 완료, 시간초과 등) 항상
  // 정리해서 다음 내 턴에 지난 선택이 남아있지 않게 한다.
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  useEffect(() => {
    if (room && room.state?.gaugePhase !== "resolved") setSelectedPieceId(null);
  }, [room, room?.state?.gaugePhase]);

  if (!nickname) {
    return <NicknameGate onDone={setNickname} />;
  }

  if (!room) {
    return <RoomList nickname={nickname} onRoomJoined={setRoom} />;
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
      {/* 대기실/플레이/종료 단계와 무관하게 항상 표시 — 채팅 말풍선이 뜰 자리 겸 채팅 입력창. */}
      <ParticipantBar room={room} />

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

      <ChatInput room={room} />
    </div>
  );
}

export default App;
