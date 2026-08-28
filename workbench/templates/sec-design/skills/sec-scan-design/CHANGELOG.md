# CHANGELOG

本文件记录 `sec-scan-design` Skill 的版本变更。版本号遵循 [语义化版本 (SemVer)](https://semver.org/lang/zh-CN/) 规范。

## [1.0.0] — 2026-06-12

### 新增

- 首个正式版本 `v1.0.0` 发布。
- 内置 **12 个安全模块**，共 **133 条规则**（`references/` 目录）。
- 基于 LLM 语义分析的审核流程（5 步执行法 + 第0步 docx 预处理）。
- 支持 `.md` / `.txt` / `.docx` 三种格式设计文档，`.docx` 三级降级转换（markitdown → Python标准库 → 提示手动转换）。
- 支持两种规则查找路径：优先读取工作目录 `references/`，其次回退到 Skill 内置 `references/`。
- 报告输出：`<原文档>.security-audit.md`，包含审核概述、覆盖情况表、问题清单（含证据与修改建议）、重点缺陷分析、总体结论。
- 零脚本依赖，审核过程完全通过 LLM + 文件读取工具完成。
- description 明确区分设计文档与源代码，避免与 `sec-scan-code` 技能触发冲突。

---

> 版本发布流程：更新 `VERSION` + 在 `CHANGELOG.md` 顶部追加条目 + 压缩整个目录为 `sec-scan-design-vX.Y.Z.zip`。
