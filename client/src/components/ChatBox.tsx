import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { useChatLog } from "../game/useChatLog";
import styles from "./ChatBox.module.css";

const MAX_CHAT_LENGTH = 200; // server/src/rooms/MatchRoom.ts의 MAX_CHAT_LENGTH와 동일.

/**
 * songpyeon처럼 계속 떠 있는 채팅창(2026-08-29~) — 대기실/플레이 중 화면과 무관하게 항상 같은
 * 자리(화면 우하단)에 떠서 지금까지 온 채팅을 스크롤해서 볼 수 있다. 예전엔 아바타 위에 3초간
 * 뜨고 사라지는 말풍선(useChatBubbles)이었는데, "토스트 말고 진짜 채팅창"이라는 요청으로
 * 교체했다 — REQUIREMENTS.md §8도 이에 맞춰 갱신할 것.
 */
export function ChatBox({ room }: { room: Room<MatchState> }) {
  const messages = useChatLog(room);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  // 새 메시지가 쌓이면 항상 맨 아래로 스크롤해서 최신 메시지가 보이게 한다.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    room.send("sendChat", { text: trimmed });
    setText("");
  }

  return (
    <div className={styles.box}>
      <div className={styles.header}>채팅</div>
      <ul className={styles.list} ref={listRef}>
        {messages.length === 0 && <li className={styles.empty}>아직 채팅이 없습니다</li>}
        {messages.map((m) => (
          <li key={m.key} className={styles.message}>
            <span className={styles.author}>{playerLabel(m.sessionId, room)}</span>
            <span className={styles.text}>{m.text}</span>
          </li>
        ))}
      </ul>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          type="text"
          className={styles.input}
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="채팅을 입력하세요"
        />
        <button type="submit" className={styles.sendButton}>
          전송
        </button>
      </form>
    </div>
  );
}
