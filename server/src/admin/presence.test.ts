import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOnlineNicknames, touch, _resetForTest } from "./presence";

describe("presence", () => {
  beforeEach(() => {
    _resetForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("touch한 유저의 닉네임이 접속자 목록에 뜬다", () => {
    touch(1, "몽자");
    expect(getOnlineNicknames()).toEqual(["몽자"]);
  });

  it("같은 유저를 여러 번 touch해도 한 번만 뜬다", () => {
    touch(1, "몽자");
    touch(1, "몽자");
    expect(getOnlineNicknames()).toEqual(["몽자"]);
  });

  it("서로 다른 유저는 전부 뜬다", () => {
    touch(1, "몽자");
    touch(2, "나쁜사람");
    expect(getOnlineNicknames().sort()).toEqual(["나쁜사람", "몽자"].sort());
  });

  it("일정 시간(TTL) 안에 다시 touch가 없으면 목록에서 빠진다", () => {
    touch(1, "몽자");
    vi.advanceTimersByTime(31_000);
    expect(getOnlineNicknames()).toEqual([]);
  });

  it("TTL 안에 다시 touch하면 계속 접속 중으로 유지된다", () => {
    touch(1, "몽자");
    vi.advanceTimersByTime(20_000);
    touch(1, "몽자");
    vi.advanceTimersByTime(20_000);
    expect(getOnlineNicknames()).toEqual(["몽자"]);
  });

  it("닉네임이 바뀌면(관리자 강제변경 등) 최신 닉네임으로 갱신된다", () => {
    touch(1, "옛날닉네임");
    touch(1, "새닉네임");
    expect(getOnlineNicknames()).toEqual(["새닉네임"]);
  });
});
