import { describe, expect, it } from "vitest";
import { sanitizeRoomTitle } from "./roomTitle";

describe("sanitizeRoomTitle", () => {
  it("공백을 앞뒤로 정리한다", () => {
    expect(sanitizeRoomTitle("  즐거운 한판  ")).toBe("즐거운 한판");
  });

  it("20자를 넘으면 잘라낸다", () => {
    const long = "가".repeat(25);
    expect(sanitizeRoomTitle(long)).toBe("가".repeat(20));
  });

  it("문자열이 아니거나 빈 값이면 빈 문자열을 반환한다", () => {
    expect(sanitizeRoomTitle(undefined)).toBe("");
    expect(sanitizeRoomTitle("   ")).toBe("");
  });
});
