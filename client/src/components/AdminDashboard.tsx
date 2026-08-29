import { useEffect, useState, type FormEvent } from "react";
import styles from "./AdminDashboard.module.css";

type RoomInfo = {
  roomId: string;
  metadata?: {
    title?: string;
    phase?: "waiting" | "playing" | "finished";
    playerCount?: number;
    playerCapacity?: number;
    nicknames?: string[];
  };
};

const PHASE_LABEL: Record<string, string> = {
  waiting: "대기중",
  playing: "진행중",
  finished: "종료",
};
const EVENT_TYPE_LABEL: Record<string, string> = {
  join: "입장",
  leave: "퇴장",
  spectate_join: "관전 입장",
  spectate_leave: "관전 퇴장",
};
type AdminEvent = { type: string; timestamp: number; nickname: string; roomId: string; roomTitle: string; ip: string; sessionId: string };
type ChatLogEntry = { nickname: string; text: string; createdAt: string };
type DailyVisitStats = { today: number; recent: { date: string; count: number }[] };

async function fetchJson<T>(url: string, onUnauthorized: () => void): Promise<T | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    onUnauthorized();
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

export function AdminDashboard({
  onUnauthorized,
  onOpenUsers,
  onOpenInquiries,
}: {
  onUnauthorized: () => void;
  onOpenUsers: () => void;
  onOpenInquiries: () => void;
}) {
  const [onlineNicknames, setOnlineNicknames] = useState<string[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [chatLogs, setChatLogs] = useState<ChatLogEntry[]>([]);
  const [visitStats, setVisitStats] = useState<DailyVisitStats | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [announceError, setAnnounceError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<AdminEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [o, r, e, c, v] = await Promise.all([
        fetchJson<string[]>("/api/admin/online-users", onUnauthorized),
        fetchJson<RoomInfo[]>("/api/admin/rooms", onUnauthorized),
        fetchJson<AdminEvent[]>("/api/admin/events", onUnauthorized),
        fetchJson<ChatLogEntry[]>("/api/admin/chat-logs", onUnauthorized),
        fetchJson<DailyVisitStats>("/api/admin/stats/daily-visitors", onUnauthorized),
      ]);
      if (cancelled) return;
      if (o) setOnlineNicknames(o);
      if (r) setRooms(r);
      if (e) setEvents(e);
      if (c) setChatLogs(c);
      if (v) setVisitStats(v);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onUnauthorized]);

  async function handleAnnounce(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setAnnounceError(null);
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) throw new Error("전송에 실패했습니다.");
      setMessage("");
    } catch (err) {
      setAnnounceError(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchInput.trim()) return;
    const results = await fetchJson<AdminEvent[]>(`/api/admin/events/search?nickname=${encodeURIComponent(searchInput)}`, onUnauthorized);
    setSearchResults(results ?? []);
  }

  return (
    <div className={styles.wrap}>
      <h1>관리자 대시보드</h1>
      <nav className={styles.nav}>
        <button onClick={onOpenUsers}>유저 관리</button>
        <button onClick={onOpenInquiries}>문의함</button>
      </nav>

      <section className={styles.section}>
        <h2>공지 배너 보내기</h2>
        <form onSubmit={handleAnnounce}>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="공지 내용" disabled={sending} />
          <button type="submit" disabled={sending}>
            보내기
          </button>
        </form>
        {announceError && <p className={styles.error}>{announceError}</p>}
      </section>

      <section className={styles.section}>
        <h2>현재 접속자 ({onlineNicknames.length})</h2>
        {onlineNicknames.length === 0 ? (
          <p className={styles.empty}>접속 중인 유저가 없습니다.</p>
        ) : (
          <ul className={styles.chipList}>
            {onlineNicknames.map((n) => (
              <li key={n} className={styles.chip}>
                {n}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2>활성 방 ({rooms.length})</h2>
        <ul>
          {rooms.map((r) => (
            <li key={r.roomId}>
              {r.metadata?.title ?? r.roomId} — {PHASE_LABEL[r.metadata?.phase ?? ""] ?? r.metadata?.phase} —{" "}
              {r.metadata?.playerCount ?? 0}/{r.metadata?.playerCapacity ?? "?"}
              {r.metadata?.nicknames && r.metadata.nicknames.length > 0 && (
                <> ({r.metadata.nicknames.join(", ")})</>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <h2>최근 입장/퇴장 (최대 100개)</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시각</th>
                <th>종류</th>
                <th>닉네임</th>
                <th>방</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(-100).reverse().map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td>{EVENT_TYPE_LABEL[e.type] ?? e.type}</td>
                  <td>{e.nickname}</td>
                  <td>{e.roomTitle}</td>
                  <td>{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2>최근 채팅 로그 (최대 200개)</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>시각</th>
                <th>닉네임</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {chatLogs.slice(0, 200).map((c, i) => (
                <tr key={i}>
                  <td>{c.createdAt}</td>
                  <td>{c.nickname}</td>
                  <td>{c.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <h2>닉네임으로 접속 기록 검색</h2>
        <form onSubmit={handleSearch}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="닉네임" />
          <button type="submit">검색</button>
        </form>
        {searchResults &&
          (searchResults.length === 0 ? (
            <p className={styles.empty}>일치하는 기록이 없습니다.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>종류</th>
                    <th>닉네임</th>
                    <th>방</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((e, i) => (
                    <tr key={i}>
                      <td>{new Date(e.timestamp).toLocaleString()}</td>
                      <td>{EVENT_TYPE_LABEL[e.type] ?? e.type}</td>
                      <td>{e.nickname}</td>
                      <td>{e.roomTitle}</td>
                      <td>{e.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className={styles.section}>
        <h2>오늘 방문 {visitStats?.today ?? 0}회</h2>
        <ul>
          {visitStats?.recent.map((r) => (
            <li key={r.date}>
              {r.date}: {r.count}회
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
