import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { getNicknameHistory, recordNicknameChange } from "./nicknameHistory";

describe("nicknameHistory", () => {
  beforeEach(() => {
    db.exec("DELETE FROM nickname_history");
  });

  it("변경 이력을 기록하고 최신순으로 조회한다", () => {
    recordNicknameChange(1, null, "첫닉네임", "initial");
    recordNicknameChange(1, "첫닉네임", "바뀐닉네임", "admin");
    const history = getNicknameHistory(1);
    expect(history).toHaveLength(2);
    expect(history[0].newNickname).toBe("바뀐닉네임");
    expect(history[0].source).toBe("admin");
    expect(history[1].newNickname).toBe("첫닉네임");
  });

  it("다른 유저의 이력은 섞이지 않는다", () => {
    recordNicknameChange(1, null, "유저1", "initial");
    recordNicknameChange(2, null, "유저2", "initial");
    expect(getNicknameHistory(1)).toHaveLength(1);
  });
});
