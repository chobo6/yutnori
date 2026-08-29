import { useEffect, useState } from "react";
import styles from "./AnnouncementBanner.module.css";

type Announcement = { message: string; timestamp: number };

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/announcements/stream");
    source.onmessage = (event) => {
      try {
        setAnnouncement(JSON.parse(event.data));
      } catch {
        // 파싱 실패한 메시지는 무시
      }
    };
    return () => source.close();
  }, []);

  if (!announcement) return null;

  return (
    <div className={styles.banner}>
      <span>{announcement.message}</span>
      <button type="button" className={styles.close} onClick={() => setAnnouncement(null)}>
        ×
      </button>
    </div>
  );
}
