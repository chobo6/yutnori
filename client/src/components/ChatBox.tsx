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
 *
 * 열고 닫을 수 있게(2026-08-29 추가) — 모바일 화면에서 항상 펼쳐져 있으면 화면 대부분을
 * 가려버린다는 신고로, 기본은 접힌 상태(헤더만 보임)로 바꾸고 헤더를 눌러 펼친다. 접혀
 * 있는 동안 온 메시지는 안 읽음 배지로 개수를 보여준다.
 */
export function ChatBox({ room }: { room: Room<MatchState> }) {
  const messages = useChatLog(room);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const openRef = useRef(open);

  // 펼쳐지면 안 읽음 배지를 지운다. ref에도 항상 최신값을 반영해서, 아래 메시지-누적 effect가
  // (messages만 의존성으로 두고도) 지금 열려있는지를 오래된 값 없이 정확히 읽을 수 있게 한다.
  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  // 새로 도착한 메시지 수만큼 안 읽음 배지를 올린다 — 닫혀 있을 때만.
  const prevCountRef = useRef(messages.length);
  useEffect(() => {
    const added = messages.length - prevCountRef.current;
    prevCountRef.current = messages.length;
    if (added > 0 && !openRef.current) {
      setUnread((u) => u + added);
    }
  }, [messages]);

  // 새 메시지가 쌓이면(펼쳐진 상태일 때만 목록이 존재) 항상 맨 아래로 스크롤한다.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    room.send("sendChat", { text: trimmed });
    setText("");
  }

  return (
    <div className={`${styles.box} ${open ? styles.open : styles.closed}`}>
      <button type="button" className={styles.header} onClick={() => setOpen((prev) => !prev)}>
        <span>채팅</span>
        {!open && unread > 0 && <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>}
        <span className={styles.chevron}>{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <>
          <ul className={styles.list} ref={listRef}>
            {messages.length === 0 && <li className={styles.empty}>아직 채팅이 없습니다</li>}
            {messages.map((m) => {
              // 관전자 채팅은 닉네임 뒤에 "(관전)"을 붙인다(songpyeon과 동일 관례) — 채팅
              // 로그(관리자 대시보드)에도 같은 접미사가 남아 플레이어 채팅과 구분된다
              // (server/src/rooms/MatchRoom.ts의 sendChat 핸들러 참고). playerLabel처럼
              // "지금" 방 상태 기준으로 판단하므로, 관전자가 이미 나갔다면(다른 곳과 동일한
              // 한계) 이 접미사도 더 이상 안 붙는다.
              const isSpectator = room.state.spectators.has(m.sessionId);
              const author = playerLabel(m.sessionId, room);
              return (
                <li key={m.key} className={styles.message}>
                  <span className={styles.author}>{isSpectator ? `${author} (관전)` : author}</span>
                  <span className={styles.text}>{m.text}</span>
                </li>
              );
            })}
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
        </>
      )}
    </div>
  );
}
