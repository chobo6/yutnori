const MAX_NICKNAME_LENGTH = 12;

// 빈 문자열/유효하지 않은 입력은 "" 반환 — 호출부(MatchRoom.onJoin)가 문맥에 맞는
// 기본값("플레이어")을 채운다. songpyeon의 roomTitle.ts와 동일한 패턴.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_NICKNAME_LENGTH);
}
