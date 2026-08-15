# Decisions: 管理平台 V0.1

**Feature Branch**: `001-management-platform-v0-1`
**Created**: 2026-08-15

## ADR-001: 采用模块化单体、BFF 与独立最小工作台客户端

**Status**: Accepted
**Date**: 2026-08-15

### Context

V0.1 需要同时覆盖真实人员 OIDC、细粒度服务端授权、工作台持钥证明、机器 Token、安装包和审计，但必须避免微服务、通用权限引擎和完整桌面业务带来的范围膨胀。现有架构约束推荐 FastAPI、Vue、PostgreSQL，并要求工作台是独立本地应用、Keycloak 是统一 IAM。

### Options Considered

1. FastAPI 模块化单体 + Vue SPA + PostgreSQL，Keycloak 独立部署，Node/TypeScript 最小工作台。
2. NestJS + Vue 的全 TypeScript 平台，Keycloak 独立部署。
3. FastAPI 服务端渲染页面与 Python 工作台，共享单一语言和进程模型。
4. 验收部署使用显式 `PUBLIC_HOST`，由 Compose 插值和 Keycloak Admin API 同步派生所有外部 URL。
5. 生产部署使用稳定域名、DNS、HTTPS 反向代理和固定 Keycloak hostname。

### Decision

We choose 方案 1 because 它遵循仓库既定技术方向，能用 BFF 隔离浏览器 Token，用独立工作台真实验证 Native App PKCE 和机器身份，同时保持一个平台后端和一个数据库的最小部署边界。平台内部按业务能力分模块，但不拆分为网络服务。

部署地址在 V0.1 选择方案 4：`PUBLIC_HOST` 由操作者显式提供，命令行环境变量优先于本地 `tools/.env`，缺省仅回退到 `127.0.0.1`。Compose、Keycloak Realm 初始导入、运行中 Client Redirect URI、平台、工作台和 E2E 必须共享该值。方案 5 记录为生产阶段目标，不在本次实现反向代理、DNS 或证书。

### Consequences

**Positive:**
- 认证、授权和事务边界集中，适合验证完整可信接入链。
- Vue SPA 能直接实现当前原型的八个页面和角色差异。
- 工作台与平台进程分离，E2E 可以证明真实跨应用协议而非内部函数调用。
- 无 Redis、MinIO、消息队列或通用策略引擎，限制设计和运维范围。

**Negative:**
- Python 与 TypeScript 双语言需要两套依赖和测试工具。
- BFF 会话、Keycloak Admin API 和平台自签机器 Token 形成三个身份相关边界，需要更多安全测试。
- 单机 Compose 仅作为 V0.1 开发和验收环境，生产高可用需后续单独设计。
- `PUBLIC_HOST` 变化后需要重建依赖公开 URL 的容器，并同步已有 Keycloak Client；启动工具自动完成同步。
- 生产阶段仍需迁移到稳定域名与 HTTPS，避免 DHCP 地址变化导致 issuer 改变和现有浏览器会话失效。
- 人员与 Keycloak 管理员统一使用用户指定的强默认密码；PostgreSQL 保持容器网络内不可外部访问。
