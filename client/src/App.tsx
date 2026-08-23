// client/src/App.tsx
import { useMatchRoom } from "./game/useMatchRoom";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { PlayerCorner } from "./components/PlayerCorner";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatInput } from "./components/ChatInput";
import { assignCorners } from "./game/cornerSlots";
import styles from "./App.module.css";

function App() {
  const { status, room } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <div>
        <h1>윷놀이</h1>
        <p>연결 상태: {status}</p>
      </div>
    );
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
            {corners.topLeft && <PlayerCorner room={room} sessionId={corners.topLeft} />}
          </div>
          <div className={styles.topRight}>
            {corners.topRight && <PlayerCorner room={room} sessionId={corners.topRight} />}
          </div>
          <div className={styles.bottomLeft}>
            {corners.bottomLeft && <PlayerCorner room={room} sessionId={corners.bottomLeft} />}
          </div>
          <div className={styles.bottomRight}>
            {corners.bottomRight && <PlayerCorner room={room} sessionId={corners.bottomRight} />}
          </div>
          <div className={styles.boardArea}>
            <GameBoard room={room} />
          </div>
        </div>
      )}

      {room.state.phase === "finished" && <WinnerScreen room={room} />}

      <ChatInput room={room} />
    </div>
  );
}

export default App;
