import { beforeEach, describe, expect, it } from "vitest";
import { getInquiries, recordInquiry, _resetForTest } from "./inquiries";

describe("inquiries", () => {
  beforeEach(() => _resetForTest());

  it("문의를 기록하고 최신순으로 조회한다", () => {
    recordInquiry(1, "유저A", "제목1", "내용1");
    recordInquiry(2, "유저B", "제목2", "내용2");
    const list = getInquiries();
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("제목2");
  });
});
