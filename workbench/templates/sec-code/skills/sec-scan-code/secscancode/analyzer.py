"""Big data analyzer: analyzes historical scan results and updates constitution-project.yaml."""

import json
import os
from pathlib import Path
from datetime import datetime
from typing import Optional
from collections import Counter

import yaml

from .rules_loader import load_rules, RULES_DIR


def _find_report_files(project_path: str) -> list[Path]:
    """Find all JSON scan report files.

    兼容两种布局：
      - 新：<project>/.sec-scan-code/scans/<时间戳>/scan_*.json（每次扫描独立目录）
      - 旧：<project>/.sec-scan-code/reports/scan_*.json（v2.2 前扁平 reports 目录）
    """
    files: list[Path] = []
    scans_dir = Path(project_path) / ".sec-scan-code" / "scans"
    if scans_dir.is_dir():
        files.extend(sorted(scans_dir.glob("*/scan_*.json")))
    reports_dir = Path(project_path) / ".sec-scan-code" / "reports"
    if reports_dir.is_dir():
        files.extend(sorted(reports_dir.glob("scan_*.json")))
    return sorted(files)


def _load_report(path: Path) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _collect_language_patterns(project_path: str, top_rules: list[tuple[str, int]]) -> dict[str, dict]:
    """Collect language patterns from existing rules for top rule_ids."""
    languages = _detect_project_languages_from_files(project_path)
    rules = load_rules(languages=languages, project_path=project_path)

    # 去掉 PROJ- 前缀再匹配基础规则：历史报告里由 constitution 规则产生的 rule_id
    # 带 PROJ- 前缀（如 PROJ-A05-INJECTION），否则第二次 --analyze 匹配不到 base rule
    # 导致新规则 languages 为空、空壳规则不断累积。
    top_rule_ids = {rid[5:] if rid.startswith("PROJ-") else rid for rid, _ in top_rules}

    rule_map: dict[str, dict] = {}
    for rule in rules:
        if rule.rule_id not in top_rule_ids:
            continue
        lang_patterns: dict[str, dict] = {}
        for lang, lang_rule in rule.languages.items():
            lang_patterns[lang] = {
                "file_extensions": lang_rule.file_extensions,
                "patterns": {cat: [{"pattern": p.pattern, "description": p.description, "confidence": p.confidence} for p in pats] for cat, pats in lang_rule.patterns.items()},
                "safe_patterns": [],
            }
        if lang_patterns:
            rule_map[rule.rule_id] = lang_patterns
    return rule_map


def _detect_project_languages_from_files(project_path: str) -> list[str]:
    """Detect languages used in project by scanning file extensions."""
    from .rules_loader import detect_project_languages
    return detect_project_languages(project_path)


def analyze_trends(project_path: str, project_name: str = "",
                   top_n: int = 10) -> dict:
    """Analyze historical scan results and return trend data.

    Returns dict with:
      - total_scans: number of scans analyzed
      - total_findings: total findings across all scans
      - top_categories: most common vulnerability categories
      - top_rules: most common rule violations
      - top_files: files with most findings
      - severity_distribution: findings by severity
      - language_distribution: findings by language
      - rule_severity_map: rule_id → most common severity from historical findings
    """
    report_files = _find_report_files(project_path)
    if not report_files:
        return {"total_scans": 0, "message": "No historical scan data found"}

    category_counter: Counter = Counter()
    rule_counter: Counter = Counter()
    file_counter: Counter = Counter()
    severity_counter: Counter = Counter()
    language_counter: Counter = Counter()
    rule_severity_tracker: dict[str, Counter] = {}  # rule_id → severity count
    total_findings = 0

    for rf in report_files:
        report = _load_report(rf)
        if not report:
            continue
        for finding in report.get("findings", []):
            total_findings += 1
            category_counter[finding.get("category", "unknown")] += 1
            rid = finding.get("rule_id", "unknown")
            rule_counter[rid] += 1
            file_counter[finding.get("file", "unknown")] += 1
            sev = finding.get("severity", "unknown").upper()
            severity_counter[sev] += 1
            language_counter[finding.get("language", "unknown")] += 1
            if rid not in rule_severity_tracker:
                rule_severity_tracker[rid] = Counter()
            rule_severity_tracker[rid][sev] += 1

    # Build rule_id → most common severity map
    rule_severity_map: dict[str, str] = {}
    SEVERITY_PRIORITY = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    for rid, sev_counter in rule_severity_tracker.items():
        best = max(sev_counter.items(), key=lambda kv: (
            kv[1],
            -SEVERITY_PRIORITY.index(kv[0]) if kv[0] in SEVERITY_PRIORITY else -999
        ))
        rule_severity_map[rid] = best[0]

    return {
        "total_scans": len(report_files),
        "total_findings": total_findings,
        "top_categories": category_counter.most_common(top_n),
        "top_rules": rule_counter.most_common(top_n),
        "top_files": file_counter.most_common(top_n),
        "severity_distribution": dict(severity_counter),
        "language_distribution": dict(language_counter),
        "rule_severity_map": rule_severity_map,
    }


def update_constitution_project(project_path: str, project_name: str = "",
                                top_n: int = 5) -> dict:
    """Analyze trends and update constitution-project.yaml (宪法文件2).

    The top N most common vulnerabilities become constitutional rules
    with the highest priority.
    """
    trends = analyze_trends(project_path, project_name, top_n=20)
    if trends["total_scans"] == 0:
        return {"status": "no_data", "message": "No historical data to analyze"}

    rule_severity_map = trends.get("rule_severity_map", {})
    language_patterns_map = _collect_language_patterns(project_path, trends["top_rules"])

    project_rules = []
    for rule_id, count in trends["top_rules"][:top_n]:
        if rule_id == "unknown":
            continue
        severity = rule_severity_map.get(rule_id, "HIGH")
        languages = language_patterns_map.get(rule_id, {})

        rule_entry = {
            "rule_id": f"PROJ-{rule_id}",
            "name": f"Project frequent: {rule_id}",
            "severity": severity,
            "priority": "project-specific",
            "description": f"This vulnerability appeared {count} times in project scans",
            "brief": f"项目高频漏洞: {rule_id} (出现{count}次)",
            "categories": [cat for cat, _ in trends["top_categories"]
                          if cat != "unknown"][:3],
            "languages": languages,
        }
        project_rules.append(rule_entry)

    # Write constitution-project.yaml to the PROJECT's .sec-scan-code/ directory
    # （不再写 skill 安装目录——否则项目 A 的分析结果污染所有后续项目）
    const_path = Path(project_path) / ".sec-scan-code" / "constitution-project.yaml"
    const_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "version": "1.0.0",
        "project": project_name,
        "last_analyzed": datetime.now().isoformat(),
        "rules": project_rules,
    }

    with open(const_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)

    return {
        "status": "updated",
        "rules_added": len(project_rules),
        "constitution_path": str(const_path),
        "trends_summary": {
            "total_scans": trends["total_scans"],
            "total_findings": trends["total_findings"],
            "top_categories": trends["top_categories"][:5],
        },
    }
