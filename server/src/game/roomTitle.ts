const MAX_ROOM_TITLE_LENGTH = 20;

// 빈 문자열/유효하지 않은 입력은 "" 반환 — 호출부(MatchRoom.onCreate)가 "이름 없는 방" 같은
// 기본값을 채운다.
export function sanitizeRoomTitle(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_ROOM_TITLE_LENGTH);
}
