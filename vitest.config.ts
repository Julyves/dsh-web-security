/**
 * vitest 配置：仅纳入本插件的测试目录。
 *
 * 必须显式排除 `.wiki/`（宿主源码快照，含大量 spec）与 `.npm-cache/`，
 * 否则默认 include 模式会扫到宿主测试并全量运行。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules/**', '.wiki/**', '.npm-cache/**', 'lib/**'],
  },
})