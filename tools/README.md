# tools/ — 运维工具与配置

## 快速开始

```bash
# 1. 首次使用：复制环境配置（up.sh 也会自动创建）
cp tools/.env.example tools/.env
# 编辑 .env，修改 PUBLIC_HOST 和密钥

# 2. 启动全部服务
./tools/up.sh

# 3. 导入组织结构和用户
python3 tools/realm-import/import.py

# 4. 停止
./tools/down.sh

# 5. 停止并清理无用 Docker 层（防止 overlay2 膨胀）
./tools/down.sh --prune
```

## 环境配置

### .env（不提交 git）

所有密钥和运行时配置集中在此文件。首次 `up.sh` 时自动从 `.env.example` 创建。

### .env.example（提交 git）

模板文件，包含所有变量的样例值和注释。修改变量后复制到 `.env`。

### 密钥变量说明

| 变量 | 用途 | 被谁使用 | 更换后果 |
|------|------|---------|---------|
| `DB_PASSWORD` | PostgreSQL `keycloak` 和 `platform` 数据库用户的密码 | postgres init.sh、Keycloak DB 连接、平台 DB 连接 | 需 drop 数据卷重建 |
| `DB_PASSWORD_URL` | `DB_PASSWORD` 的 URL 编码版本（`@`→`%40` 等），用于 `PLATFORM_DATABASE_URL` 连接串 | platform-api | 与 `DB_PASSWORD` 同步更换 |
| `KC_ADMIN_PASSWORD` | Keycloak master realm 的 bootstrap admin 密码 | Keycloak 启动、sync-keycloak-urls.sh、import.py | Keycloak 需 drop 数据卷重建 |
| `OIDC_CLIENT_SECRET` | `platform-web` 客户端的 OIDC client secret，用户登录时代码交换 token | platform-api、Keycloak realm 导入 | `.env` 唯一来源；更换后需 drop 数据卷重新导入 |
| `IAM_SYNC_CLIENT_SECRET` | `platform-iam-sync` 服务账号的 client secret，后台目录同步拉取用户/组 | platform-api、Keycloak realm 导入 | `.env` 唯一来源；更换后需 drop 数据卷重新导入 |
| `SESSION_SECRET` | OIDC 登录流程 cookie 的签名密钥（≥32 字符） | platform-api `OidcFlowCodec` | 所有进行中的登录流程失效，用户需重新登录 |
| `MACHINE_SIGNING_SECRET` | 工作台机器令牌的签名密钥（≥32 字符） | platform-api enrollment 签发/验证 | 已注册的工作台机器令牌全部失效，需重新注册 |

**OIDC_CLIENT_SECRET 和 IAM_SYNC_CLIENT_SECRET 以 `.env` 为唯一来源。** realm JSON 中使用 `${OIDC_CLIENT_SECRET}` / `${IAM_SYNC_CLIENT_SECRET}` 占位符，Keycloak 导入时从容器环境变量替换，无需手动修改 realm JSON。更换后需 drop 数据卷重新导入。

## 工具清单

### 启停

| 脚本 | 作用 | 用法 |
|------|------|------|
| `up.sh` | 启动全部容器 + 健康检查 + Keycloak URL 同步 | `./tools/up.sh` |
| `down.sh` | 停止全部容器（保留数据） | `./tools/down.sh` |
| `down.sh -v` | 停止并删除全部数据卷 | `./tools/down.sh --volumes` |
| `down.sh -p` | 停止后自动清理悬空镜像和构建缓存（同 `--prune`） | `./tools/down.sh -p` |
| `down.sh -P` | 停止后清理所有未使用镜像（同 `--prune-all`，含基础镜像，需重新拉取） | `./tools/down.sh -P` |

### 构建与测试

| 脚本 | 作用 | 用法 |
|------|------|------|
| `test-unit.sh` | 运行后端 + 前端 + 工作台单元测试 | `./tools/test-unit.sh` |
| `test-e2e.sh` | 运行端到端测试（会重建数据卷） | `./tools/test-e2e.sh` |
| `test_external_access.py` | 验证外部访问配置正确性 | `python3 tools/test_external_access.py` |

### 基础设施

| 脚本 | 作用 | 用法 |
|------|------|------|
| `compose.sh` | docker-compose 封装，自动加载 `.env` | `./tools/compose.sh <command>` |
| `prune.sh` | 清理 Docker 悬空镜像、构建缓存和无用层 | `./tools/prune.sh [--all] [--containers] [--dry-run]` |
| `runtime-env.sh` | 可 source 的环境加载脚本，读取 `PUBLIC_HOST` | 由其他脚本自动 source |
| `sync-keycloak-urls.sh` | 根据 `PUBLIC_HOST` 更新 Keycloak client 重定向 URI + 同步 service account 角色 | `up.sh` 自动调用 |
| `wait-for-http.sh` | 轮询 HTTP 端点直到就绪或超时 | `./tools/wait-for-http.sh <url> <timeout>` |
| `configure-mirrors.sh` | 配置 Docker 镜像加速器（国内/受限网络） | `sudo ./tools/configure-mirrors.sh` |

### 子目录

| 目录 | 作用 |
|------|------|
| `realm-import/` | 组织结构与用户批量导入工具（详见 `realm-import/README.md`） |
| `.bin/` | docker-compose 独立二进制（不提交 git） |
| `e2e/` | Playwright 端到端测试 |

## 典型工作流

```bash
# 首次部署
cp tools/.env.example tools/.env    # 配置环境
./tools/up.sh                        # 启动服务
python3 tools/realm-import/import.py # 导入组织+用户

# 日常开发
./tools/down.sh                      # 停止（保留数据）
./tools/up.sh                         # 启动（数据保留）

# 完全重置
./tools/down.sh --volumes             # 删除数据卷
./tools/up.sh                         # 从零启动
python3 tools/realm-import/import.py  # 重新导入

# 日常开发：停止后清理旧构建层，防止 /var/lib/docker/overlay2 无限增长
./tools/down.sh -p

# 手动清理（不停止容器，只删悬空镜像和构建缓存，安全）
./tools/prune.sh

# 预览将回收多少空间而不实际删除
./tools/prune.sh --dry-run

# 测试
./tools/test-unit.sh                 # 单元测试
./tools/test-e2e.sh                  # 端到端测试
```
