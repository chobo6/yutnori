import { beforeEach, describe, expect, it } from "vitest";
import { getEvents, recordEvent, searchEventsByNickname, _resetForTest } from "./eventLog";

describe("eventLog", () => {
  beforeEach(() => _resetForTest());

  it("기록한 이벤트를 오래된 순서로 반환한다", () => {
    recordEvent({ type: "join", timestamp: 1, nickname: "A", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    recordEvent({ type: "leave", timestamp: 2, nickname: "A", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    const events = getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("join");
    expect(events[1].type).toBe("leave");
  });

  it("닉네임 부분일치로 검색된다", () => {
    recordEvent({ type: "join", timestamp: 1, nickname: "홍길동", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    recordEvent({ type: "join", timestamp: 2, nickname: "다른사람", roomId: "r1", roomTitle: "방1", ip: "2.2.2.2", sessionId: "s2" });
    const results = searchEventsByNickname("길동");
    expect(results).toHaveLength(1);
    expect(results[0].nickname).toBe("홍길동");
  });
});
