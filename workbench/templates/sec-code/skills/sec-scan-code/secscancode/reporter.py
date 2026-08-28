"""Report generator: outputs scan results in JSON and HTML formats."""

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from html import escape as _html_escape
from typing import Optional

from .scanner import ScanResult, Finding, _deduplicate_findings, _sort_findings


REPORTS_DIR_NAME = ".sec-scan-code"


def _ensure_reports_dir(project_path: str) -> Path:
    """Ensure the reports directory exists and return its path."""
    reports_dir = Path(project_path) / REPORTS_DIR_NAME / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    return reports_dir


def generate_json(result: ScanResult, output_path: Optional[str] = None) -> str:
    """Generate JSON report. Returns JSON string, optionally writes to file."""
    data = result.to_dict()
    json_str = json.dumps(data, indent=2, ensure_ascii=False)
    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(json_str)
    return json_str


def generate_html(result: ScanResult, output_path: Optional[str] = None) -> str:
    """Generate HTML report."""
    severity_colors = {
        "CRITICAL": "#dc3545",
        "HIGH": "#fd7e14",
        "MEDIUM": "#ffc107",
        "LOW": "#28a745",
    }

    # Build clickable file:/// link for a finding
    def _file_link(f_file: str, f_line: int, project_path: str) -> str:
        """Generate clickable file:/// link with line anchor."""
        abs_path = f_file if os.path.isabs(f_file) else os.path.join(project_path, f_file)
        # Use forward slashes for file:/// URL (works on all platforms)
        url_path = abs_path.replace("\\", "/")
        if not url_path.startswith("/"):
            url_path = "/" + url_path
        # Compute relative path for display text
        try:
            rel_path = os.path.relpath(f_file, project_path) if project_path else f_file
        except ValueError:
            rel_path = f_file
        anchor = f"#L{f_line}" if f_line else ""
        return f'<a href="file://{url_path}{anchor}">{_html_escape(rel_path)}</a>'

    findings_rows = []
    for f in result.findings:
        color = severity_colors.get(f.severity.upper(), "#6c757d")
        file_link_html = _file_link(f.file, f.line, result.project_path)
        vuln_html = ""
        if f.vuln_code:
            vuln_html = f"""<div class="vuln-code">
            <strong>原漏洞代码：</strong>
            <pre class="vuln-code-block">{_html_escape(f.vuln_code)}</pre>
        </div>"""
        fix_html = ""
        if f.fix_code:
            fix_html = f"""<div class="fix-code-box">
            <strong>修复后代码：</strong>
            <pre class="fix-code-block">{_html_escape(f.fix_code)}</pre>
        </div>"""
        recommendation_html = ""
        if f.recommendation:
            recommendation_html = f"""<div class="recommendation">
            <strong>修复原则：</strong><br>
            <pre class="fix-code">{_html_escape(f.recommendation)}</pre>
        </div>"""
        exploit_html = ""
        if f.exploit_scenario:
            exploit_html = f"""<div class="exploit">
            <strong>攻击场景：</strong> {_html_escape(f.exploit_scenario)}
        </div>"""
        findings_rows.append(f"""<div class="finding-card" style="border-left-color: {color}">
        <div class="finding-header">
            <span class="badge" style="background:{color}">{f.severity}</span>
            <span class="finding-id">#{f.id}</span>
            <span class="finding-category">{_html_escape(f.category)}</span>
            <span class="finding-lang">[{f.language}]</span>
        </div>
        <div class="finding-meta">
            <span class="file-path">{file_link_html}</span>
            <span class="finding-line">行 {f.line if f.line else 'N/A'}</span>
        </div>
        <div class="finding-code"><code>{_html_escape(f.code_snippet)}</code></div>
        <div class="finding-desc">{_html_escape(f.description)}</div>
        {vuln_html}
        {fix_html}
        {recommendation_html}
        {exploit_html}
    </div>""")

    totals_rows = ""
    for k, v in result.totals.items():
        if isinstance(v, dict):
            for sk, sv in v.items():
                totals_rows += f"<tr><td>{k}.{sk}</td><td>{sv}</td></tr>"
        else:
            totals_rows += f"<tr><td>{k}</td><td>{v}</td></tr>"

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>安全扫描报告 - {_html_escape(result.project)}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f8f9fa; color: #212529; }}
h1 {{ color: #343a40; border-bottom: 2px solid #dee2e6; padding-bottom: 10px; }}
.summary {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }}
.card {{ background: white; border-radius: 8px; padding: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
.card h3 {{ margin: 0 0 10px 0; color: #495057; font-size: 14px; text-transform: uppercase; }}
.card .value {{ font-size: 24px; font-weight: bold; color: #212529; }}
.badge {{ color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }}
table {{ width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }}
th {{ background: #343a40; color: white; padding: 12px; text-align: left; font-size: 13px; }}
td {{ padding: 10px 12px; border-bottom: 1px solid #dee2e6; font-size: 13px; }}
tr:hover {{ background: #f1f3f5; }}
.file-path {{ font-family: monospace; font-size: 12px; }}
.file-path a {{ color: #3b82f6; text-decoration: none; }}
.file-path a:hover {{ text-decoration: underline; }}
.warning {{ background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 15px; margin: 20px 0; }}
.warning strong {{ color: #856404; }}
.findings-container {{ display: flex; flex-direction: column; gap: 12px; }}
.finding-card {{ background: white; border-left: 4px solid #6c757d; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
.finding-header {{ display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }}
.finding-id {{ font-weight: bold; color: #495057; }}
.finding-category {{ font-weight: 600; color: #212529; }}
.finding-lang {{ color: #6c757d; font-size: 13px; }}
.finding-meta {{ font-size: 13px; color: #6c757d; margin-bottom: 8px; }}
.finding-line {{ margin-left: 8px; }}
.finding-code {{ background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; margin-bottom: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }}
.finding-code code {{ font-size: 12px; }}
.finding-desc {{ font-size: 13px; color: #495057; margin-bottom: 8px; }}
.recommendation {{ background: #d4edda; border: 1px solid #28a745; border-radius: 6px; padding: 12px; margin: 8px 0 4px 0; }}
.recommendation strong {{ color: #155724; }}
.fix-code {{ background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; margin-top: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }}
.exploit {{ background: #f8d7da; border: 1px solid #dc3545; border-radius: 6px; padding: 12px; margin: 4px 0 12px 0; }}
.exploit strong {{ color: #721c24; }}
.vuln-code {{ background: #fff3f3; border: 1px solid #dc3545; border-radius: 6px; padding: 12px; margin: 8px 0 4px 0; }}
.vuln-code strong {{ color: #721c24; }}
.vuln-code-block {{ background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; margin-top: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }}
.fix-code-box {{ background: #d4edda; border: 1px solid #28a745; border-radius: 6px; padding: 12px; margin: 8px 0 4px 0; }}
.fix-code-box strong {{ color: #155724; }}
.fix-code-block {{ background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 10px; margin-top: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }}
</style>
</head>
<body>
<h1>安全扫描报告</h1>

<div class="summary">
    <div class="card"><h3>项目</h3><div class="value">{_html_escape(result.project)}</div></div>
    <div class="card"><h3>扫描模式</h3><div class="value">{result.scan_mode}</div></div>
    <div class="card"><h3>扫描时间</h3><div class="value">{_html_escape(result.scan_date)}</div></div>
    <div class="card"><h3>扫描耗时</h3><div class="value">{_html_escape(result.scan_duration) if result.scan_duration else 'N/A'}</div></div>
    <div class="card"><h3>扫描文件数</h3><div class="value">{result.scan_scope.get('files_count', 0)}</div></div>
    <div class="card"><h3>扫描行数</h3><div class="value">{result.scan_scope.get('lines_scanned', 0)}</div></div>
    <div class="card"><h3>检测语言</h3><div class="value">{', '.join(result.languages_detected)}</div></div>
    <div class="card"><h3>发现数</h3><div class="value">{len(result.findings)}</div></div>
</div>

<div class="warning">
    <strong>AI扫描局限性：</strong> {_html_escape(result.ai_limitations_notice)}
</div>

<h2>漏洞发现</h2>
<div class="findings-container">
{''.join(findings_rows)}
</div>

<h2>统计</h2>
<table>
<thead><tr><th>指标</th><th>值</th></tr></thead>
<tbody>{totals_rows}</tbody>
</table>

<p style="color: #6c757d; font-size: 12px; margin-top: 30px;">
由 sec-scan-code v{result.version} 于 {result.scan_date} 生成
</p>
</body>
</html>"""

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html)
    return html



def validate_report_schema(json_path: str) -> list[str]:
    """校验一份 JSON 报告是否为引擎 generate_report() 产出的标准 schema。

    用于 Phase Gate 6 强制校验：若 agent 绕过引擎手写了非标准报告
    （如把元数据包在 report_metadata 里、findings 用非标准字段名、
    缺少 scan_scope.files_scanned 真实文件列表），本函数返回非空错误列表，
    迫使 agent 重走 generate_report_from_json() 流程。

    Args:
        json_path: 生成的 JSON 报告路径。

    Returns:
        list[str]: 不合规项描述；空列表表示通过（是引擎标准产物）。
    """
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    errors: list[str] = []

    # 必须是引擎顶层 schema，不能是 report_metadata 包裹的非标准结构
    if "report_metadata" in data and "scan_scope" not in data:
        errors.append(
            "报告使用了非标准 report_metadata 包裹结构，未走引擎 generate_report()。"
            "必须用 generate_report_from_json() 重新生成。"
        )
        return errors  # schema 完全不对，后续检查无意义

    if data.get("version") != "2.0.0":
        errors.append(f"version 应为 '2.0.0'（引擎版本），实际为 {data.get('version')!r}")

    # scan_scope 必须存在（引擎标准产物必有此字段）
    scope = data.get("scan_scope")
    if not isinstance(scope, dict):
        errors.append("缺少顶层 scan_scope 字段（引擎标准产物必有）")
    # 注意：扫描文件清单记录在独立的 .sec-scan-code/scan-files.list 中，
    # 不再要求 JSON 报告的 scan_scope.files_scanned 非空。

    # findings 必须用引擎标准字段名 + 合规三件套
    findings = data.get("findings", [])
    for i, f in enumerate(findings):
        if not isinstance(f, dict):
            continue
        if "rule_id" not in f and "rule" in f:
            errors.append(f"findings[{i}] 用了非标准字段 'rule'，应为 'rule_id'")
        if "vuln_code" not in f or not str(f.get("vuln_code", "")).strip():
            errors.append(f"findings[{i}] 缺少 vuln_code（合规三件套）")
            break  # 同类错误报一条即可，避免刷屏
        if "fix_code" not in f or not str(f.get("fix_code", "")).strip():
            errors.append(f"findings[{i}] 缺少 fix_code（合规三件套）")
            break
        if "exploit_scenario" not in f or not str(f.get("exploit_scenario", "")).strip():
            errors.append(f"findings[{i}] 缺少 exploit_scenario（合规三件套）")
            break

    return errors


def generate_report(result: ScanResult, project_path: str,
                    formats: Optional[list[str]] = None,
                    output_dir: Optional[str] = None) -> dict[str, str]:
    """Generate reports in specified formats. Returns dict of format -> file path.

    Args:
        output_dir: 报告输出目录。默认 <project_path>/.sec-scan-code/reports/；
            指定后（如每次扫描独立的时间戳目录）报告写入该目录。
    """
    if formats is None:
        formats = ["html", "json"]

    reports_dir = Path(output_dir) if output_dir else _ensure_reports_dir(project_path)
    reports_dir.mkdir(parents=True, exist_ok=True)

    # Phase Gate: 每个发现必须含有原漏洞代码(vuln_code)、修复后代码(fix_code)、
    # 攻击场景(exploit_scenario)。缺失则拒绝生成报告，强制代理补齐后再生成，
    # 避免产出不含代码级修复建议的不合规报告。
    if any(fmt in {"html", "json"} for fmt in formats):
        _compliance_errors = result.validate()
        if _compliance_errors:
            raise ValueError(
                "报告生成被拒绝：以下发现缺少必填修复字段（vuln_code / fix_code / exploit_scenario）：\n"
                + "\n".join(_compliance_errors)
            )

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    generated: dict[str, str] = {}

    generators = {
        "json": (generate_json, "json"),
        "html": (generate_html, "html"),
    }

    for fmt in formats:
        if fmt not in generators:
            continue
        gen_func, ext = generators[fmt]
        filename = f"scan_{result.scan_mode}_{ts}.{ext}"
        output_path = str(reports_dir / filename)
        gen_func(result, output_path)
        generated[fmt] = output_path

    return generated


def merge_findings_parts(parts_dir: str, metadata: dict) -> str:
    """合并 subagent 产出的 parts 文件为一份 findings.json。

    解决全量扫描时多个 subagent 返回值灌爆主 agent 上下文的问题：每个 subagent
    把自己的 findings 直接 Write 到 .sec-scan-code/parts/*.json（不作为文本返回），
    本函数读取所有 parts → 逐条构造 Finding → 跨任务去重（rule_id+file+line+category）
    → 排序 → 写入 findings.json。

    主 agent 调用本函数后，上下文里只有函数返回的「合并了 N 条」摘要，
    不携带任何原始 finding 文本。

    Args:
        parts_dir: parts 目录路径（含若干 task-*.json）。
        metadata: findings.json 的元数据（project/project_path/scan_mode/
                  scan_date/languages_detected/rules_loaded/scan_scope）。

    Returns:
        合并后的 findings.json 路径。
    """
    parts_path = Path(parts_dir)
    all_findings: list[Finding] = []
    for part_file in sorted(parts_path.glob("*.json")):
        with open(part_file, "r", encoding="utf-8") as f:
            part_data = json.load(f)
        findings_raw = part_data.get("findings", [])
        for i, fdata in enumerate(findings_raw):
            finding = Finding(
                id=fdata.get("id", i + 1),
                rule_id=fdata.get("rule_id", ""),
                rule_name=fdata.get("rule_name", ""),
                severity=fdata.get("severity", ""),
                confidence=fdata.get("confidence", 5),
                category=fdata.get("category", ""),
                language=fdata.get("language", ""),
                file=fdata.get("file", ""),
                line=fdata.get("line", 0),
                code_snippet=fdata.get("code_snippet", ""),
                description=fdata.get("description", ""),
                recommendation=fdata.get("recommendation", ""),
                exploit_scenario=fdata.get("exploit_scenario", ""),
                vuln_code=fdata.get("vuln_code", ""),
                fix_code=fdata.get("fix_code", ""),
                source=fdata.get("source", "constitutional"),
                risk_score=fdata.get("risk_score", 0),
            )
            all_findings.append(finding)

    # 跨任务去重 + 排序（与引擎内部一致）
    all_findings = _deduplicate_findings(all_findings)
    all_findings = _sort_findings(all_findings)

    # 重排 id 为连续序号
    for i, f in enumerate(all_findings, start=1):
        f.id = i

    findings_json = {
        "project": metadata.get("project", ""),
        "project_path": metadata.get("project_path", ""),
        "scan_mode": metadata.get("scan_mode", "full"),
        "scan_date": metadata.get("scan_date", ""),
        "scan_duration": metadata.get("scan_duration", ""),
        "languages_detected": metadata.get("languages_detected", []),
        "rules_loaded": metadata.get("rules_loaded", []),
        "scan_scope": metadata.get("scan_scope", {}),
        "findings": [f.to_dict() for f in all_findings],
    }

    out_path = str(parts_path.parent / "findings.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(findings_json, f, ensure_ascii=False, indent=2)
    return out_path


def generate_report_from_json(findings_path: str,
                              project_path: Optional[str] = None,
                              formats: Optional[list[str]] = None,
                              output_dir: Optional[str] = None) -> dict[str, str]:
    """从 findings.json 数据文件构造 ScanResult 并生成报告。

    findings.json 由 agent 在 Phase 5 末尾用 Write 工具产出（纯数据），
    字段与 ScanResult/Finding dataclass 对齐。本函数读 JSON → 逐条
    Finding() → ScanResult → deduplicate/sort/compute_totals →
    generate_report()。合规校验（vuln_code/fix_code/exploit_scenario）
    仍由 generate_report() 强制。

    Args:
        findings_path: findings.json 文件路径。
        project_path: 报告输出根目录。默认取 JSON 里的 project_path。
        formats: 输出格式，默认 None（html+json）。
        output_dir: 报告输出目录。默认 <project_path>/.sec-scan-code/reports/。

    Returns:
        dict[str, str]: 格式名 → 报告文件路径。
    """
    with open(findings_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    findings_raw = data.get("findings", [])
    findings: list[Finding] = []
    for i, fdata in enumerate(findings_raw):
        # Finding dataclass 字段全集，缺失则用默认值
        finding = Finding(
            id=fdata.get("id", i + 1),
            rule_id=fdata.get("rule_id", ""),
            rule_name=fdata.get("rule_name", ""),
            severity=fdata.get("severity", ""),
            confidence=fdata.get("confidence", 5),
            category=fdata.get("category", ""),
            language=fdata.get("language", ""),
            file=fdata.get("file", ""),
            line=fdata.get("line", 0),
            code_snippet=fdata.get("code_snippet", ""),
            description=fdata.get("description", ""),
            recommendation=fdata.get("recommendation", ""),
            exploit_scenario=fdata.get("exploit_scenario", ""),
            vuln_code=fdata.get("vuln_code", ""),
            fix_code=fdata.get("fix_code", ""),
            source=fdata.get("source", "constitutional"),
            risk_score=fdata.get("risk_score", 0),
        )
        findings.append(finding)

    scan_scope = data.get("scan_scope", {})
    # 兜底：若 findings.json 未提供 file_line_counts/fields_skipped 等新字段
    scan_scope.setdefault("file_line_counts", {})
    scan_scope.setdefault("files_skipped", [])
    scan_scope.setdefault("dirs_skipped", [])
    scan_scope.setdefault("files_scanned", [])
    scan_scope.setdefault("files_count", len(scan_scope["files_scanned"]))
    scan_scope.setdefault("lines_scanned", 0)
    scan_scope.setdefault("source", "full_project" if data.get("scan_mode") == "full" else "session_changes")

    # 尽力而为：若 languages_detected 漏填，从 findings.language 反推（仅当 findings 填了 language）
    if not data.get("languages_detected"):
        langs = sorted({f.language for f in findings if f.language})
        if langs:
            data["languages_detected"] = langs

    result = ScanResult(
        project=data.get("project", ""),
        project_path=data.get("project_path", project_path or ""),
        scan_mode=data.get("scan_mode", "incremental"),
        scan_date=data.get("scan_date", ""),
        scan_duration=data.get("scan_duration", ""),
        languages_detected=data.get("languages_detected", []),
        rules_loaded=data.get("rules_loaded", []),
        scan_scope=scan_scope,
        findings=findings,
    )
    result.deduplicate_findings()
    result.sort_findings()
    result.compute_totals()

    out_project_path = project_path or data.get("project_path", "")
    if not out_project_path:
        raise ValueError("project_path 未指定：findings.json 缺少 project_path 且未传参")

    return generate_report(result, out_project_path, formats, output_dir=output_dir)


