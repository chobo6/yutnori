import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    // 여러 테스트 파일이 각각 @colyseus/testing의 boot()로 동일한 고정 포트(2568)에
    // 서버를 띄우므로, 파일을 병렬로 실행하면 EADDRINUSE로 충돌한다. 파일 단위로는
    // 순차 실행하도록 강제한다 (파일 내부 테스트 동시성에는 영향 없음).
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
