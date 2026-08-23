import { describe, expect, it } from "vitest";
import { sanitizeNickname } from "./nickname";

describe("sanitizeNickname", () => {
  it("공백을 앞뒤로 정리한다", () => {
    expect(sanitizeNickname("  홍길동  ")).toBe("홍길동");
  });

  it("12자를 넘으면 잘라낸다", () => {
    expect(sanitizeNickname("가나다라마바사아자차카타파하")).toBe("가나다라마바사아자차카타");
  });

  it("문자열이 아니면 빈 문자열을 반환한다", () => {
    expect(sanitizeNickname(undefined)).toBe("");
    expect(sanitizeNickname(null)).toBe("");
    expect(sanitizeNickname(42)).toBe("");
  });

  it("공백만 있으면 빈 문자열이 된다", () => {
    expect(sanitizeNickname("   ")).toBe("");
  });
});
