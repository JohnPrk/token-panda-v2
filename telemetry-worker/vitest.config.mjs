import { defineConfig } from "vitest/config";

// telemetry-worker 는 상위 앱 레포 안에 중첩돼 있어, 로컬 config 가 없으면
// vitest 가 부모(token-panda-v2)의 include(src/electron) 를 주워 테스트를 못 찾는다.
// 이 워커의 테스트만 잡도록 범위를 고정한다.
export default defineConfig({
  test: {
    include: ["**/*.test.mjs"],
    exclude: ["**/node_modules/**", "**/.wrangler/**"],
  },
});
