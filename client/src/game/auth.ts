const GIS_SRC = "https://accounts.google.com/gsi/client";

type GoogleAccountsId = {
  initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Google Identity Services script"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function renderGoogleButton(containerId: string, onCredential: (credential: string) => void): Promise<void> {
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  window.google!.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
  });
}

export type Profile = { id: number; nickname: string | null; bannedAt: string | null };

export async function loginWithGoogle(credential: string): Promise<Profile> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("로그인에 실패했습니다.");
  return res.json();
}

export async function fetchMe(): Promise<Profile | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) return null;
  return res.json();
}

// fetchMe()와 같은 라우트를 부르지만 응답을 안 쓰고 버린다 — 로그인 상태인 동안 주기적으로
// 호출해서 서버의 "접속 중" 판정(server/src/admin/presence.ts)을 갱신하기 위한 용도.
// 로비에만 머물러 어떤 매치 룸에도 안 들어간 유저는 이 핑이 유일한 실시간 흔적이다.
export async function ping(): Promise<void> {
  await fetch("/api/auth/me", { credentials: "same-origin" }).catch(() => {});
}

export async function submitNickname(nickname: string): Promise<Profile> {
  const res = await fetch("/api/auth/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "닉네임 설정에 실패했습니다.");
  }
  return res.json();
}
