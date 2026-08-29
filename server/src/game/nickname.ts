const MAX_NICKNAME_LENGTH = 12;

// 빈 문자열/유효하지 않은 입력은 "" 반환 — 호출부(server/src/auth/googleAuth.ts의
// setNickname/adminSetNickname)가 문맥에 맞게 처리한다(현재는 유효성 검사를 거쳐 이미 걸러진
// 문자열만 넘어오므로 실질적으로 트림/길이 제한 용도). MatchRoom.onJoin은 더 이상 이 함수를
// 호출하지 않는다 — 서버 검증된 닉네임(client.auth.nickname)을 그대로 쓴다.
// songpyeon의 roomTitle.ts와 동일한 패턴.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_NICKNAME_LENGTH);
}
