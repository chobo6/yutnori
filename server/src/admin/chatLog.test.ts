import { beforeEach, describe, expect, it } from "vitest";
import { getChatLogs, recordChatLog, _resetForTest } from "./chatLog";

describe("chatLog", () => {
  beforeEach(() => _resetForTest());

  it("기록한 메시지를 최신순으로 반환한다", () => {
    recordChatLog("A", "안녕");
    recordChatLog("B", "반가워");
    const logs = getChatLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].text).toBe("반가워");
    expect(logs[1].text).toBe("안녕");
  });
});
