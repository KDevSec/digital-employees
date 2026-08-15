# Digital Employees V0.1

管理平台、Keycloak、PostgreSQL 和最小工作台认证 Demo。

## 编译

需要已启动的 Docker Engine：

```bash
./tools/build.sh
```

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
