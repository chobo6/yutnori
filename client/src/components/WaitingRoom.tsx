import { useState } from "react";
import type { Room } from "colyseus.js";
import { CHARACTERS, type CharacterId, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./WaitingRoom.module.css";

export function WaitingRoom({ room }: { room: Room<MatchState> }) {
  const me = room.state.players.get(room.sessionId);
  const [pendingCharacters, setPendingCharacters] = useState<CharacterId[]>(
    (me?.characters ?? []) as CharacterId[],
  );

  function pickTeam(team: "A" | "B") {
    room.send("pickTeam", { team });
  }

  function toggleCharacter(character: CharacterId) {
    setPendingCharacters((prev) => {
      let next: CharacterId[];
      if (prev.includes(character)) {
        // 이미 2개 골라 서버에 보낸 상태에서의 해제는 no-op.
        // 해제만 하면 서버로 보내는 메시지가 없어 서버는 옛 2개를 그대로 들고 있고,
        // 그 사이 "준비 완료"를 누르면 화면에 보이는 것과 다른 캐릭터로 게임이 시작된다.
        // 마음을 바꾸려면 아래 "3번째를 골라 가장 오래된 것을 밀어내는" 경로(정상 동기화됨)를 쓰면 된다.
        if (prev.length >= 2) return prev;
        next = prev.filter((c) => c !== character);
      } else if (prev.length >= 2) {
        next = [prev[1], character]; // 가장 오래된 선택을 밀어내고 새로 추가
      } else {
        next = [...prev, character];
      }
      if (next.length === 2) {
        room.send("pickCharacters", { characters: next });
      }
      return next;
    });
  }

  function toggleReady() {
    room.send("ready", {});
  }

  const players = Array.from(room.state.players.values());

  // 서버 maybeStartGame은 4명이 2/2로 나뉘고 각자 캐릭터 2종을 골라야만 시작한다.
  // 조건이 안 맞으면 아무 일도 없이 조용히 넘어가므로, 왜 안 시작하는지 여기서 알려준다.
  const teamACount = players.filter((p) => p.team === "A").length;
  const teamBCount = players.filter((p) => p.team === "B").length;
  const teamSplitOk = teamACount === 2 && teamBCount === 2;
  const charactersMissing = players.filter((p) => p.characters.length !== 2).length;

  return (
    <div className={styles.wrap}>
      <h2>대기실</h2>

      <section>
        <h3>팀 선택</h3>
        <button
          type="button"
          className={me?.team === "A" ? styles.selected : undefined}
          onClick={() => pickTeam("A")}
        >
          A팀
        </button>
        <button
          type="button"
          className={me?.team === "B" ? styles.selected : undefined}
          onClick={() => pickTeam("B")}
        >
          B팀
        </button>
      </section>

      <section>
        <h3>캐릭터 선택 (2종)</h3>
        {CHARACTERS.map((character) => (
          <button
            key={character}
            type="button"
            className={pendingCharacters.includes(character) ? styles.selected : undefined}
            onClick={() => toggleCharacter(character)}
          >
            {character}
          </button>
        ))}
      </section>

      <section>
        <button type="button" onClick={toggleReady}>
          {me?.ready ? "준비 취소" : "준비 완료"}
        </button>
      </section>

      <section>
        <h3>참가자 ({players.length}/4)</h3>
        {players.length === 4 && !teamSplitOk && (
          <p>
            A팀 2명 / B팀 2명이 되어야 게임이 시작됩니다 (현재 A팀 {teamACount}명, B팀 {teamBCount}명)
          </p>
        )}
        {players.length === 4 && teamSplitOk && charactersMissing > 0 && (
          <p>모두 캐릭터를 2종씩 골라야 게임이 시작됩니다 (아직 {charactersMissing}명 미완료)</p>
        )}
        <ul>
          {players.map((player) => (
            <li key={player.sessionId}>
              {playerLabel(player.sessionId, room)} — 팀: {player.team || "미정"}, 캐릭터:{" "}
              {player.characters.length > 0 ? player.characters.join(", ") : "미정"}, 준비:{" "}
              {player.ready ? "완료" : "대기중"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
