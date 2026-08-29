import { beforeEach, describe, expect, it } from "vitest";
import { getIpsForUser, recordUserIp, _resetForTest } from "./userIps";

describe("userIps", () => {
  beforeEach(() => _resetForTest());

  it("같은 IP로 다시 기록하면 행이 늘지 않고 last_seen만 갱신된다", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "1.2.3.4");
    expect(getIpsForUser(1)).toHaveLength(1);
  });

  it("다른 IP면 새 행이 생긴다", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "5.6.7.8");
    expect(getIpsForUser(1)).toHaveLength(2);
  });

  it("unknown은 기록하지 않는다", () => {
    recordUserIp(1, "unknown");
    expect(getIpsForUser(1)).toHaveLength(0);
  });
});
