/** bun --compile 内联非 JS 资产（与 main.ts 的 web-dist html 同款 with {type:'text'} 机制） */
declare module '*.node-table.yml' {
  const content: string
  export default content
}
