---
name: "sec-scan-design"
description: "对设计文档（.md/.txt/.docx）进行安全合规审核，基于内置12模块133条规则逐条检查，输出含修改建议的Markdown报告。当用户要求对'设计文档'/'详细设计'/'概要设计'/'技术方案'做安全审核/安全审计/安全合规检查时触发。注意：本技能仅针对设计文档，不适用于源代码安全审计（源代码审计请使用sec-scan-code）。"
---

# 设计文档安全审核 (sec-scan-design)

基于大模型语义分析，对设计文档进行安全合规审核。内置 12 个安全模块共 133 条规则，按需加载，零脚本依赖。

## 触发条件（何时使用本技能）

**必须触发**：

- 用户要求对"设计文档"/"详细设计"/"概要设计"/"技术方案"/"架构设计"做安全审核/审计/合规检查
- 用户说："审一下这份设计文档的安全性"
- 用户说："检查设计文档是否符合安全规范"
- 用户指定文件是 `.md`/`.txt`/`.docx` 格式的设计类文档

**不应触发**（交给其他技能）：

- 对源代码文件（.js/.py/.go/.java/.c 等）的安全审计 → 使用 `sec-scan-code`
- 对运行时系统进行渗透测试 → 使用其他安全工具
- 对已部署服务的漏洞扫描 → 不适用

## 核心能力

1. 自动识别设计文档涉及的12个安全模块（访问控制、加密规范、通讯安全、数据保护、数据库安全、会话管理、错误处理与日志、系统配置、文件管理、个人信息安全、内存管理、通用编码规范）
2. 按需加载命中模块的规则文件（未命中模块不加载，节省Token）
3. 逐条规则进行语义分析审核（PASS / FAIL / N/A）
4. 生成结构化Markdown报告：`<原文档名>.security-audit.md`

## 规则文件

规则位于 `references/` 目录，12个模块133条规则，文件命名格式：`<模块名>_安全合规检查规则.md`

查找优先级：

1. `<workspace>/references/<模块名>_安全合规检查规则.md`（用户自定义优先）
2. `<skill>/references/<模块名>_安全合规检查规则.md`（Skill内置回退）

## 执行流程

### 第0步：格式预处理（仅 .docx 文件）

若用户指定的设计文档为 `.docx` 格式，按以下优先级尝试转换为可读文本：

**方案 A（优先）：调用 `markitdown` 技能**

若当前环境已安装 `markitdown` 技能，直接调用它转换 `.docx` → Markdown，获得最佳转换质量（保留标题层级、表格、代码块等结构）。

**方案 B（降级）：Python 标准库提取文本**

若 `markitdown` 不可用，使用 Python 标准库（`zipfile` + `xml.etree.ElementTree`，无需 pip 安装）直接从 `.docx` 中提取文本内容。执行以下命令：

```powershell
python -c "
import zipfile, xml.etree.ElementTree as ET, sys, os

docx_path = r'<用户指定的docx文件绝对路径>'
out_path = docx_path.replace('.docx', '_extracted.md')

ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

with zipfile.ZipFile(docx_path, 'r') as z:
    xml_content = z.read('word/document.xml')

root = ET.fromstring(xml_content)
paragraphs = []
for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
    texts = []
    for t in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
        if t.text:
            texts.append(t.text)
    line = ''.join(texts).strip()
    if line:
        # 检测标题样式（基于样式名）
        pPr = p.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr')
        if pPr is not None:
            pStyle = pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pStyle')
            if pStyle is not None:
                style = pStyle.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', '')
                if style.startswith('Heading') or style.startswith('heading') or style.startswith('标题') or style.startswith('目录'):
                    level = 1
                    for c in style:
                        if c.isdigit():
                            level = int(c)
                            break
                    paragraphs.append('#' * min(level, 6) + ' ' + line)
                    continue
        paragraphs.append(line)

with open(out_path, 'w', encoding='utf-8') as f:
    f.write('\n\n'.join(paragraphs))
print(f'OK:{out_path}')
"
```

> 注意：方案 B 会丢失表格、图片等复杂格式，但能保留段落文本和基本标题层级，足以支撑安全审计的语义分析。

**方案 C（最终兜底）：提示用户**

若方案 A 和方案 B 均失败，告知用户：".docx 格式需要 markitdown 技能或 Python 环境支持，请手动将文档转换为 .md 或 .txt 格式后重试。"

---

转换完成后，以转换后的文本内容作为审计输入。审计报告仍以原 `.docx` 文件名命名（如 `详细设计文档.docx` → 报告为 `详细设计文档.docx.security-audit.md`）。转换产生的中间文件在报告生成后必须清理。

### 第1步：读取设计文档

读取用户指定的设计文档全文（`.md`/`.txt` 直接读取，`.docx` 使用第0步转换后的内容）。若文档较大，按章节分段读取。

### 第2步：识别涉及模块

基于文档内容，判断涉及哪些安全模块（此步骤只做关键词扫描和判断，不加载任何规则文件）。判断依据：

| 文档内容关键词                         | 对应模块    |
| ------------------------------- | ------- |
| 权限/角色/访问控制/授权/RBAC/鉴权/越权        | 访问控制    |
| Session/Token/Cookie/会话/登录态/JWT | 会话管理    |
| 加密/密码/哈希/AES/RSA/密钥/签名          | 加密规范    |
| HTTPS/TLS/证书/传输信道/SSL           | 通讯安全    |
| 日志/错误处理/异常/堆栈/审计日志              | 错误处理和日志 |
| 敏感数据/脱敏/缓存/GET参数/数据删除           | 数据保护    |
| 服务器版本/补丁/HTTP方法/环境隔离/Header     | 系统配置    |
| 数据库/SQL/连接字符串/表/默认账号/MongoDB    | 数据库安全   |
| 文件上传/下载/路径/白名单                  | 文件管理    |
| 个人信息/隐私/PII/最小化/注销              | 个人信息安全  |
| 初始化/锁/竞态/动态执行/校验和               | 通用编码规范  |
| 内存/缓存溢出/字符串处理/strncpy           | 内存管理    |

### 第3步：加载命中模块的规则文件

仅读取第2步识别到的模块对应的规则文件。未命中的模块不读取。

### 第4步：逐条规则审核

基于设计文档内容和已加载的规则，逐条进行审核。对每条规则输出：

- **rule_id**: 规则编号（如 AC-14）
- **status**: PASS（文档已覆盖）/ FAIL（缺失或违规）/ N/A（不适用）
- **severity**: Critical / High / Medium / Low（仅FAIL时）
- **evidence**: 文档原文片段及章节位置
- **issue_description**: 问题描述（仅FAIL时）
- **fix_suggestion**: 具体修改建议（仅FAIL时）

审核标准：

- PASS：文档明确描述了符合规则要求的设计
- FAIL：文档缺少相关设计或存在与规则相悖的描述
- N/A：规则与当前文档业务场景确实无关（谨慎使用）

### 第5步：生成报告

**生成报告前，必须先读取 `<skill>/VERSION` 文件获取当前版本号**，并在报告的"文档信息"表格中填入该版本号。禁止在报告中硬编码版本号。

生成 Markdown 报告，保存为 `<原文档名>.security-audit.md`，结构如下：

```
# [文档名] — 安全合规审计报告

## 文档信息

| 属性 | 值 |
|------|-----|
| **被审核文档** | <原文档名> |
| **审核日期** | <当前日期 YYYY-MM-DD> |
| **审核工具** | sec-scan-design v<从VERSION文件读取的版本号> |
| **审核方式** | LLM 语义分析 |

---

## 一、审核概述
- 被审核文档、时间、涉及模块、使用规则清单

## 二、安全规则覆盖情况
- 表格：模块、规则总数、PASS、FAIL、N/A、覆盖率、符合率

## 三、发现的问题清单
- 按严重程度排序（Critical → High → Medium → Low）
- 每条含：规则编号、所属模块、严重程度、证据（原文片段）、问题描述、修改建议
- Critical/High 级别问题需额外包含：攻击场景分析、推荐方案（含架构建议）

## 四、总体结论与后续行动建议
- 总体评估表、核心结论、优先修复建议（P0/P1/P2/P3）
```

> **注意**：第三章中 Critical/High 问题的"攻击场景分析"和"推荐方案"应是对该问题"问题描述"和"修改建议"的深化和具体化，而非简单重复。应包含：具体的攻击路径描述、受影响资产、推荐的架构级解决方案（含技术选型建议）。避免与问题描述和修改建议出现大量文字重复。

## 质量要求

1. **按需加载**：未命中模块的规则文件不读取
2. **零脚本**：全程不编写/执行Python/Shell脚本（第0步docx转换除外）
3. **可追溯**：每条FAIL必须引用文档原文片段和章节位置
4. **建议可落地**：修改建议具体到应新增/修改的内容方向
5. **量化统计**：报告含每个模块的覆盖率与符合率
6. **中间文件清理**：`.docx` 转换产生的中间 `.md` 文件在报告生成后必须清理

## 报告示例

```markdown
## 二、安全规则覆盖情况

| 模块 | 规则总数 | PASS | FAIL | N/A | 覆盖率 | 符合率 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 访问控制 | 19 | 12 | 5 | 2 | 89.5% | 70.6% |
| 加密规范 | 6 | 3 | 2 | 1 | 83.3% | 60.0% |
| 通讯安全 | 6 | 1 | 4 | 1 | 83.3% | 20.0% |
```
