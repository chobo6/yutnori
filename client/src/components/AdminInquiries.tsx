import { useEffect, useState } from "react";
import styles from "./AdminInquiries.module.css";

type Inquiry = { id: number; userId: number; nickname: string; title: string; content: string; createdAt: number };

export function AdminInquiries({ onUnauthorized, onBack }: { onUnauthorized: () => void; onBack: () => void }) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);

  useEffect(() => {
    fetch("/api/admin/inquiries", { credentials: "same-origin" }).then(async (res) => {
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        console.error("문의 목록 조회 실패", res.status);
        return;
      }
      setInquiries(await res.json());
    });
  }, [onUnauthorized]);

  return (
    <div className={styles.wrap}>
      <button onClick={onBack}>← 대시보드</button>
      <h1>문의함 ({inquiries.length})</h1>
      <ul>
        {inquiries.map((i) => (
          <li key={i.id} className={styles.item}>
            <strong>{i.title}</strong> — {i.nickname} ({new Date(i.createdAt).toLocaleString()})
            <p>{i.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
