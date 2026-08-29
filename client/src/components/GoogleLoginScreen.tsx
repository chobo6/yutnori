import { useEffect, useState } from "react";
import { renderGoogleButton } from "../game/auth";
import styles from "./GoogleLoginScreen.module.css";

const BUTTON_CONTAINER_ID = "google-login-button";

export function GoogleLoginScreen({
  onCredential,
  error,
}: {
  onCredential: (credential: string) => void;
  error?: string | null;
}) {
  const [scriptError, setScriptError] = useState<string | null>(null);

  useEffect(() => {
    renderGoogleButton(BUTTON_CONTAINER_ID, onCredential).catch((err) => {
      console.error("Failed to render Google login button", err);
      setScriptError("로그인 버튼을 불러오지 못했어요. 새로고침해주세요.");
    });
  }, [onCredential]);

  const displayError = error ?? scriptError;

  return (
    <main className={styles.wrap}>
      <h1>윷놀이</h1>
      <p className={styles.hint}>플레이하려면 구글 로그인이 필요해요</p>
      {displayError && <p className={styles.error}>{displayError}</p>}
      <div id={BUTTON_CONTAINER_ID} />
    </main>
  );
}
