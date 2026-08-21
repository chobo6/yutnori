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
