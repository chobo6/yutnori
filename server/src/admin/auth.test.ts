import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, createSession, destroySession, isValidSession, requireAdmin, _resetForTest } from "./auth";

describe("admin/auth", () => {
  beforeEach(() => {
    _resetForTest();
    process.env.ADMIN_PASSWORD = "correct-password";
  });

  it("맞는 비밀번호만 통과한다", () => {
    expect(checkPassword("correct-password")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
  });

  it("발급한 세션은 유효하고, 만든 적 없는 토큰은 무효다", () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
    expect(isValidSession("no-such-token")).toBe(false);
  });

  it("destroySession 이후엔 무효해진다", () => {
    const token = createSession();
    destroySession(token);
    expect(isValidSession(token)).toBe(false);
  });

  it("requireAdmin은 유효한 세션 쿠키가 없으면 401을 반환한다", () => {
    const req = { cookies: {} } as unknown as Parameters<typeof requireAdmin>[0];
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Parameters<typeof requireAdmin>[1];
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAdmin은 유효한 세션 쿠키가 있으면 next를 호출한다", () => {
    const token = createSession();
    const req = { cookies: { admin_session: token } } as unknown as Parameters<typeof requireAdmin>[0];
    const res = {} as Parameters<typeof requireAdmin>[1];
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
