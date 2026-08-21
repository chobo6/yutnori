import { useMatchRoom } from "./game/useMatchRoom";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { TurnPanel } from "./components/TurnPanel";
import { WinnerScreen } from "./components/WinnerScreen";
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

  if (room.state.phase === "waiting") {
    return <WaitingRoom room={room} />;
  }

  if (room.state.phase === "playing") {
    return (
      <div>
        <GameBoard room={room} />
        <TurnPanel room={room} />
      </div>
    );
  }

  return <WinnerScreen room={room} />;
}

export default App;
