/**
 * 品牌唯一来源（换牌只改此文件）。
 * 其余模块只允许 import brand 取值，不得硬编码端口/目录名/应用名。
 */
export const brand = {
  /** service.json / healthz 的 app 标识（内部契约值：Go 侧 brand.AppName 与 web 侧 APP_ID 同镜像；不在品牌重命名映射表内，改名需三方同步） */
  app: 'workbench',
  displayName: 'DevZero',
  version: '0.0.1',
  /** 默认监听端口（D-022） */
  defaultPort: 19980,
  /** 用户目录下的 profile 目录名 */
  profileName: '.devzero',
  /** 服务首页路径 */
  homepagePath: '/',
} as const
