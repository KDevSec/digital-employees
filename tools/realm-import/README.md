# 导入组织结构与用户

`up.sh` 启动后 Keycloak 中没有任何组织结构和用户（方案 B）。使用本工具按需导入。

## 前置条件

- `./tools/up.sh` 已成功运行，Keycloak 在 `http://localhost:18080` 可用
- Keycloak bootstrap admin 凭据（默认 `admin` / `Horse~test@2026`，定义在 `tools/compose.yml`）

## 快速开始

```bash
# 导入组织结构 + 用户（使用默认文件）
python3 tools/realm-import/import.py

# 指定自定义文件
python3 tools/realm-import/import.py my-org.json my-users.json

# 仅导入组织结构
python3 tools/realm-import/import.py my-org.json /dev/null
```

## 文件说明

### org-structure.json

组织树定义，与 Keycloak realm JSON 中的 groups 格式完全一致：

```json
{
  "realm": "digital-employees",
  "groups": [
    {
      "name": "ieisystem",
      "attributes": {"domain_id": ["domain-ieisystem"]},
      "subGroups": [
        {
          "name": "总经理室",
          "attributes": {"department_id": ["dept-gm-office"]},
          "subGroups": []
        }
      ]
    }
  ]
}
```

- `domain_id` -> DOMAIN（根域）
- `department_id` -> DEPARTMENT
- `team_id` -> TEAM
- 脚本递归创建父节点后创建子节点，幂等

### users.json

用户定义，导入时密码默认为临时密码（首次登录必须修改）：

```json
{
  "realm": "digital-employees",
  "defaultPassword": "Horse~test@2026",
  "temporaryPassword": true,
  "users": [
    {
      "username": "system.admin",
      "email": "system.admin@example.test",
      "firstName": "System",
      "lastName": "Admin",
      "groups": ["/ieisystem/总经理室"]
    }
  ]
}
```

- `defaultPassword`: 全局默认密码
- `temporaryPassword`: `true` 表示首次登录必须修改
- 单个用户可用 `password` / `temporaryPassword` 字段覆盖
- `groups`: Keycloak 组路径，自动解析并关联
- 脚本幂等：已存在的用户跳过创建

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KEYCLOAK_URL` | `http://localhost:18080` | Keycloak 地址 |
| `ADMIN_USER` | `admin` | Keycloak bootstrap admin |
| `ADMIN_PASSWORD` | `Horse~test@2026` | Keycloak bootstrap admin 密码 |
| `REALM` | `digital-employees` | 目标 realm |

## 初始管理员自举

导入 `system.admin` 后，用该账号登录管理平台（`http://<PUBLIC_HOST>:18000`），
首次登录需修改密码，修改后平台自动授予 `SYSTEM_ADMIN` 全局角色。
