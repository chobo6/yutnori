import { useState, type FormEvent } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";

const MAX_CHAT_LENGTH = 200; // server/src/rooms/MatchRoom.ts의 MAX_CHAT_LENGTH와 동일.

export function ChatInput({ room }: { room: Room<MatchState> }) {
  const [text, setText] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    room.send("sendChat", { text: trimmed });
    setText("");
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={text}
        maxLength={MAX_CHAT_LENGTH}
        onChange={(e) => setText(e.target.value)}
        placeholder="채팅을 입력하세요"
      />
      <button type="submit">전송</button>
    </form>
  );
}
