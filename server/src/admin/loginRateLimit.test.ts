import { beforeEach, describe, expect, it } from "vitest";
import { isRateLimited, recordFailedAttempt, recordSuccessfulLogin, _resetForTest } from "./loginRateLimit";

describe("loginRateLimit", () => {
  beforeEach(() => _resetForTest());

  it("5회 미만 실패면 잠기지 않는다", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  it("5회 실패하면 잠긴다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(true);
  });

  it("다른 IP는 서로 영향을 안 준다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("5.6.7.8")).toBe(false);
  });

  it("성공하면 실패 기록이 지워진다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    recordSuccessfulLogin("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });
});
