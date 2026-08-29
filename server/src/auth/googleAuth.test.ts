import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import {
  adminSetNickname,
  getOrCreateUser,
  getUserById,
  listUsers,
  setNickname,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
import { getNicknameHistory } from "./nicknameHistory";

describe("googleAuth", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM nickname_history");
  });

  it("처음 로그인하면 계정을 만들고 닉네임은 null이다", () => {
    const user = getOrCreateUser("sub-1", { email: "a@b.com", name: "홍길동" });
    expect(user.nickname).toBeNull();
    expect(user.bannedAt).toBeNull();
  });

  it("같은 google_sub로 다시 로그인하면 같은 계정을 재사용한다", () => {
    const first = getOrCreateUser("sub-1", {});
    const second = getOrCreateUser("sub-1", {});
    expect(second.id).toBe(first.id);
  });

  it("닉네임은 최초 1회만 설정 가능하다", () => {
    const user = getOrCreateUser("sub-1", {});
    expect(setNickname(user.id, "첫닉네임")).toBe("ok");
    expect(setNickname(user.id, "다른닉네임")).toBe("already_set");
    expect(getUserById(user.id)?.nickname).toBe("첫닉네임");
  });

  it("이미 다른 계정이 쓰는 닉네임은 거부된다", () => {
    const u1 = getOrCreateUser("sub-1", {});
    const u2 = getOrCreateUser("sub-2", {});
    setNickname(u1.id, "겹치는닉네임");
    expect(setNickname(u2.id, "겹치는닉네임")).toBe("taken");
  });

  it("관리자는 이미 설정된 닉네임도 강제로 바꿀 수 있고 이력이 남는다", () => {
    const user = getOrCreateUser("sub-1", {});
    setNickname(user.id, "원래닉네임");
    expect(adminSetNickname(user.id, "관리자가바꾼닉네임")).toBe("ok");
    expect(getUserById(user.id)?.nickname).toBe("관리자가바꾼닉네임");
    const history = getNicknameHistory(user.id);
    expect(history[0]).toMatchObject({ oldNickname: "원래닉네임", newNickname: "관리자가바꾼닉네임", source: "admin" });
  });

  it("밴 설정/해제가 반영된다", () => {
    const user = getOrCreateUser("sub-1", {});
    setUserBanned(user.id, true);
    expect(getUserById(user.id)?.bannedAt).not.toBeNull();
    setUserBanned(user.id, false);
    expect(getUserById(user.id)?.bannedAt).toBeNull();
  });

  it("touchLastLogin이 last_login_at을 채운다", () => {
    const user = getOrCreateUser("sub-1", {});
    touchLastLogin(user.id);
    const row = db.prepare(`SELECT last_login_at AS lastLoginAt FROM users WHERE id = ?`).get(user.id) as {
      lastLoginAt: string | null;
    };
    expect(row.lastLoginAt).not.toBeNull();
  });

  it("listUsers는 페이지네이션과 전체 개수를 반환한다", () => {
    for (let i = 0; i < 3; i++) getOrCreateUser(`sub-${i}`, {});
    const { rows, total } = listUsers(0, 2);
    expect(total).toBe(3);
    expect(rows).toHaveLength(2);
  });
});
