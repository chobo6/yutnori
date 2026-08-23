const STORAGE_KEY = "yutnori:nickname";

export function getStoredNickname(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredNickname(value: string): void {
  localStorage.setItem(STORAGE_KEY, value);
}
