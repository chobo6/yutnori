import styles from "./BannedScreen.module.css";

/** profile.bannedAt이 있으면 로비(방 목록)로 넘어가지 않고 이 화면을 대신 보여준다 — 밴된
 * 계정은 방을 만들거나 들어갈 수 없을 뿐 아니라(MatchRoom.onAuth), 방 목록 자체를 볼 수도
 * 없어야 한다는 요청(2026-09-05)에 따른 화면. */
export function BannedScreen() {
  return (
    <main className={styles.wrap}>
      <h1>윷놀이</h1>
      <p className={styles.message}>이용이 제한된 계정입니다.</p>
      <p className={styles.hint}>문의사항이 있다면 관리자에게 연락해주세요.</p>
    </main>
  );
}
