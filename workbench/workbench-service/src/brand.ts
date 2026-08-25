/**
 * 品牌唯一来源（换牌只改此文件）。
 * 其余模块只允许 import brand 取值，不得硬编码端口/目录名/应用名。
 */
export const brand = {
  /** service.json / healthz 的 app 标识 */
  app: 'workbench',
  displayName: '数字员工工作台',
  version: '0.1.0',
  /** 默认监听端口（D-022） */
  defaultPort: 19980,
  /** 用户目录下的 profile 目录名（品牌定后换） */
  profileName: '.workbench',
  /** 服务首页路径 */
  homepagePath: '/',
} as const
