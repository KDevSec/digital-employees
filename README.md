# Digital Employees V0.1

管理平台、Keycloak、PostgreSQL 和最小工作台认证 Demo。

## 编译

需要已启动的 Docker Engine：

```bash
./tools/compose.sh build
```

### 国内/受限网络首次拉取基础镜像

`up.sh`/`compose.sh build` 首次构建需从镜像仓库拉取基础镜像（python/node/nginx/postgres/keycloak）。若拉取超时（`context deadline exceeded`），在部署机执行一次加速器配置脚本：

```bash
sudo ./tools/configure-mirrors.sh   # 写入 /etc/docker/daemon.json 镜像加速器并预拉取基础镜像
```

镜像版本钉死（非 latest），拉取一次缓存后后续 `up.sh --build` 命中本地缓存、不再联网。完全离线环境改用 `docker save`/`docker load` 离线导入。

## 部署

`PUBLIC_HOST` 填写浏览器能访问的虚拟机 IP 或 DNS 名：

```bash
PUBLIC_HOST=192.168.153.128 ./tools/up.sh
```

也可复制 `tools/.env.example` 为 `tools/.env` 并修改 `PUBLIC_HOST`。

## 使用

- 管理平台：`http://<PUBLIC_HOST>:18000`，账号 `system.admin`
- 工作台：`http://<PUBLIC_HOST>:19820`，账号 `employee`
- Keycloak：`http://<PUBLIC_HOST>:18080`，管理账号 `admin`
- 默认密码：`Horse~test@2026`

公开安装包可匿名下载；其他管理操作需登录并具有相应权限。

## 测试与停止

```bash
./tools/test-unit.sh
./tools/test-e2e.sh  # 会重建本项目测试数据卷
./tools/down.sh
```

架构说明见 [docs/design/管理平台V0.1当前实现架构.md](docs/design/管理平台V0.1当前实现架构.md)。
