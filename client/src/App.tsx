import { useMatchRoom } from "./game/useMatchRoom";
import "./App.css";

function App() {
  const { status, room } = useMatchRoom();

  return (
    <div>
      <h1>윷놀이</h1>
      <p>연결 상태: {status}</p>
      {room && <p>room id: {room.roomId}</p>}
    </div>
  );
}

export default App;
