import { useEffect, useState } from "react";
import { AdminEditNicknameModal } from "./AdminEditNicknameModal";
import styles from "./AdminUsers.module.css";

type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

const PAGE_SIZE = 20;

export function AdminUsers({ onUnauthorized, onBack }: { onUnauthorized: () => void; onBack: () => void }) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ id: number; nickname: string | null } | null>(null);
  const [ipsForUser, setIpsForUser] = useState<{ userId: number; entries: { ip: string; firstSeen: string; lastSeen: string }[] } | null>(
    null,
  );

  async function load() {
    const res = await fetch(`/api/admin/users?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, { credentials: "same-origin" });
    if (res.status === 401) {
      onUnauthorized();
      return;
    }
    if (!res.ok) {
      console.error("유저 목록 조회 실패", res.status);
      return;
    }
    const data = (await res.json()) as { rows: AdminUserRow[]; total: number };
    setRows(data.rows);
    setTotal(data.total);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function handleBanToggle(id: number, banned: boolean) {
    const res = await fetch(`/api/admin/users/${id}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ banned }),
    });
    if (res.status === 401) {
      onUnauthorized();
      return;
    }
    if (!res.ok) {
      console.error("밴 처리 실패", res.status);
      return;
    }
    load();
  }

  async function handleShowIps(id: number) {
    const res = await fetch(`/api/admin/users/${id}/ips`, { credentials: "same-origin" });
    if (res.status === 401) {
      onUnauthorized();
      return;
    }
    if (!res.ok) {
      console.error("IP 이력 조회 실패", res.status);
      return;
    }
    const entries = (await res.json()) as { ip: string; firstSeen: string; lastSeen: string }[];
    setIpsForUser({ userId: id, entries });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.wrap}>
      <button className={styles.backButton} onClick={onBack}>
        ← 대시보드
      </button>
      <h1>유저 관리 ({total}명)</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>닉네임</th>
            <th>이름</th>
            <th>이메일</th>
            <th>가입일</th>
            <th>최근 로그인</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.nickname ?? "(미설정)"}</td>
              <td>{u.name ?? "-"}</td>
              <td>{u.email ?? "-"}</td>
              <td>{u.createdAt}</td>
              <td>{u.lastLoginAt ?? "-"}</td>
              <td>
                <span className={`${styles.pill} ${u.bannedAt ? styles.pillBanned : styles.pillOk}`}>
                  {u.bannedAt ? "밴됨" : "정상"}
                </span>
              </td>
              <td>
                <div className={styles.actions}>
                  <button onClick={() => setEditing({ id: u.id, nickname: u.nickname })}>닉네임 수정</button>
                  <button onClick={() => handleBanToggle(u.id, !u.bannedAt)}>{u.bannedAt ? "밴 해제" : "밴"}</button>
                  <button onClick={() => handleShowIps(u.id)}>IP 이력</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          이전
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
          다음
        </button>
      </div>

      {editing && (
        <AdminEditNicknameModal
          userId={editing.id}
          currentNickname={editing.nickname}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onUnauthorized={onUnauthorized}
        />
      )}

      {ipsForUser && (
        <div className={styles.overlay} onClick={() => setIpsForUser(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>계정 #{ipsForUser.userId} IP 이력</h3>
            <ul>
              {ipsForUser.entries.map((e, i) => (
                <li key={i}>
                  {e.ip} (최초 {e.firstSeen}, 최근 {e.lastSeen})
                </li>
              ))}
            </ul>
            <button onClick={() => setIpsForUser(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
