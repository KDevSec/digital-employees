# 安装注记（sec-scan-code）

## 不进包的物料

下列物料在源 zip 中存在但**不进模板包**，原因与去向如下：

| 物料 | 大小 | 不进包原因 | 去向 |
|------|------|-----------|------|
| `.venv.rar` | ~40MB | Python 虚拟环境二进制；按 D-044 / Q3 决策，员工 home 安装语义归 L2 运行时（运行时按需装员工 home，不进模板分发） | L2 运行时由安装脚本装员工 home |
| `bin/__pycache__/*.pyc` | 缓存 | Python 字节码缓存（平台/版本相关），分发无意义 | 运行时按需重建 |
| `secscancode/__pycache__/*.pyc` | 缓存 | 同上 | 同上 |
| `install.ps1` / `install.sh` | 安装脚本 | 安装语义归 L2 运行时（员工 home 安装流程），模板包不承载安装动作 | L2 运行时安装流程 |
| `.codebuddy.zip` / `.trae.zip` | 平台重打包 | 平台特定的 skill 重打包（codebuddy / trae 平台），与 DevZero 适配层无关；且为二进制 zip，gen:templates 拒二进制内联 | 不进包（DevZero 走自己的四层适配） |

## 运行时依赖

- Python ≥ 3.10（pyproject.toml 声明）
- 依赖：`mcp>=1.0.0`、`pyyaml>=6.0`、`jinja2>=3.1`（pyproject.toml 声明）
- 员工 home 安装时由 L2 运行时流程装 .venv 并装上述依赖
