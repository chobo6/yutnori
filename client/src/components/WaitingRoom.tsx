import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { CHARACTERS, type CharacterId, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./WaitingRoom.module.css";

export function WaitingRoom({ room }: { room: Room<MatchState> }) {
  const me = room.state.players.get(room.sessionId);
  const [pendingCharacters, setPendingCharacters] = useState<CharacterId[]>(
    (me?.characters ?? []) as CharacterId[],
  );
  const [slotCharacters, setSlotCharacters] = useState<CharacterId[]>(() => {
    const existing = (me?.characters ?? []) as CharacterId[];
    return existing.length === 4 ? existing : [CHARACTERS[0], CHARACTERS[0], CHARACTERS[0], CHARACTERS[0]];
  });

  const mode = room.state.mode;
  const requiredPerTeam = mode === "1v1" ? 1 : 2;
  const requiredCharacters = mode === "1v1" ? 4 : 2;
  const totalRequired = requiredPerTeam * 2;

  // 1v1 캐릭터 드롭다운은 이미 기본값(교주 4개)이 화면에 채워져 있어, 사용자가 직접 건드리지
  // 않으면 그 값이 서버로 전송된 적이 없다 — updateSlot(onChange)만이 유일한 송신 경로였기 때문.
  // 화면에 보이는 기본값과 서버 상태(캐릭터: 미정)가 어긋나는 걸 막기 위해, 1v1 모드이고 아직
  // 서버에 4개가 기록되지 않았다면 현재 슬롯 값을 자동으로 한 번 보낸다. 서버가 받아 반영하면
  // me.characters.length가 4가 되어 조건이 꺼지므로 반복 전송되지 않는다(자기 종료형).
  useEffect(() => {
    if (mode === "1v1" && (me?.characters.length ?? 0) !== 4) {
      room.send("pickCharacters", { characters: slotCharacters });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, me?.characters.length]);

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

  function updateSlot(index: number, character: CharacterId) {
    setSlotCharacters((prev) => {
      const next = [...prev];
      next[index] = character;
      room.send("pickCharacters", { characters: next });
      return next;
    });
  }

  function toggleReady() {
    room.send("ready", {});
  }

  const players = Array.from(room.state.players.values());

  // 서버 maybeStartGame은 팀이 모드에 맞는 인원으로 나뉘고 각자 캐릭터를 다 골라야만 시작한다.
  // 조건이 안 맞으면 아무 일도 없이 조용히 넘어가므로, 왜 안 시작하는지 여기서 알려준다.
  const teamACount = players.filter((p) => p.team === "A").length;
  const teamBCount = players.filter((p) => p.team === "B").length;
  const teamSplitOk = teamACount === requiredPerTeam && teamBCount === requiredPerTeam;
  const charactersMissing = players.filter((p) => p.characters.length !== requiredCharacters).length;

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

      {mode === "2v2" ? (
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
      ) : (
        <section>
          <h3>캐릭터 선택 (말 4개, 중복 가능)</h3>
          {slotCharacters.map((character, index) => (
            <label key={index}>
              말 {index + 1}:{" "}
              <select value={character} onChange={(e) => updateSlot(index, e.target.value as CharacterId)}>
                {CHARACTERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}

      <section>
        <button type="button" onClick={toggleReady}>
          {me?.ready ? "준비 취소" : "준비 완료"}
        </button>
      </section>

      <section>
        <h3>
          참가자 ({players.length}/{totalRequired})
        </h3>
        {players.length === totalRequired && !teamSplitOk && (
          <p>
            A팀 {requiredPerTeam}명 / B팀 {requiredPerTeam}명이 되어야 게임이 시작됩니다 (현재 A팀 {teamACount}명,
            B팀 {teamBCount}명)
          </p>
        )}
        {players.length === totalRequired && teamSplitOk && charactersMissing > 0 && (
          <p>
            모두 캐릭터를 {mode === "1v1" ? `${requiredCharacters}개` : `${requiredCharacters}종`} 골라야 게임이
            시작됩니다 (아직 {charactersMissing}명 미완료)
          </p>
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
