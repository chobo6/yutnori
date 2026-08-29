import { describe, expect, it } from "vitest";
import { getCookieValue, signSession, verifySession, SESSION_COOKIE_NAME } from "./session";

describe("session", () => {
  it("서명한 토큰을 검증하면 같은 userId가 나온다", () => {
    const token = signSession(42);
    expect(verifySession(token)).toBe(42);
  });

  it("잘못된 토큰은 null을 반환한다", () => {
    expect(verifySession("garbage")).toBeNull();
  });

  it("undefined 토큰은 null을 반환한다", () => {
    expect(verifySession(undefined)).toBeNull();
  });

  it("쿠키 헤더에서 이름으로 값을 뽑는다", () => {
    const token = signSession(7);
    const header = `other=1; ${SESSION_COOKIE_NAME}=${token}; another=2`;
    expect(getCookieValue(header, SESSION_COOKIE_NAME)).toBe(token);
  });

  it("쿠키 헤더가 없으면 undefined", () => {
    expect(getCookieValue(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
  });
});
