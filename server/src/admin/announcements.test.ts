import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { broadcast, subscribe, _resetForTest, _subscriberCountForTest } from "./announcements";

function makeMockRes() {
  const written: string[] = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: (chunk: string) => written.push(chunk),
    on: vi.fn(),
    written,
  } as unknown as Response & { written: string[] };
}

describe("announcements", () => {
  beforeEach(() => _resetForTest());

  it("구독자가 등록되고 broadcast하면 메시지를 받는다", () => {
    const req = { on: vi.fn() } as unknown as Request;
    const res = makeMockRes();
    subscribe(req, res);
    expect(_subscriberCountForTest()).toBe(1);
    broadcast("안녕하세요");
    expect(res.written.some((chunk) => chunk.includes("안녕하세요"))).toBe(true);
  });
});
