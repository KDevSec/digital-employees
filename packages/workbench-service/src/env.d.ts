/**
 * 环境类型补充：Bun 的 text 导入属性（main.ts 嵌入 Web 壳用）。
 * vitest/esbuild 会剥离导入属性，仅 TS 语言服务需要此声明。
 */
declare module '*.html' {
  const content: string
  export default content
}
