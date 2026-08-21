import { useMatchRoom } from "./game/useMatchRoom";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { TurnPanel } from "./components/TurnPanel";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatInput } from "./components/ChatInput";
import "./App.css";

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

  return (
    <div>
      {/* 대기실/플레이/종료 단계와 무관하게 항상 표시 — 채팅 말풍선이 뜰 자리 겸 채팅 입력창. */}
      <ParticipantBar room={room} />

      {room.state.phase === "waiting" && <WaitingRoom room={room} />}

      {room.state.phase === "playing" && (
        <div>
          <GameBoard room={room} />
          <TurnPanel room={room} />
        </div>
      )}

      {room.state.phase === "finished" && <WinnerScreen room={room} />}

      <ChatInput room={room} />
    </div>
  );
}

export default App;
