"""CLI entry point for the sec-scan-code engine.

把引擎（语言检测 → 规则加载 → 穷尽扫描 → 候选落盘）暴露给智能体，让"穷尽规则
检查"由确定性代码完成，而不是让智能体在自己的上下文里逐行套正则。智能体随后只做
判断性工作（对候选做语义验证、补修复字段）。

Commands:
  scan          引擎扫描，把原始候选写入 .sec-scan-code/findings.json
                （可选同时写 scan-files.list 作为可审计的扫描范围记录）
  rules-brief   输出精简规则摘要（~3K tokens），供智能体加载规则理解而非读全量 YAML
  report        从 findings.json 生成 HTML/JSON 报告（等价于 reporter.generate_report_from_json）

用法示例:
  python -m secscancode.cli scan --mode full --path /path/to/proj
  python -m secscancode.cli scan --mode incremental --path /path/to/proj --files app/a.py app/b.py
  python -m secscancode.cli scan --mode quick --path /path/to/proj --files app/a.py
  python -m secscancode.cli rules-brief --lang python,c
  python -m secscancode.cli report --findings .sec-scan-code/findings.json --formats json,html
"""

import argparse
import json
import sys
import time
from pathlib import Path

from .rules_loader import load_rules, detect_project_languages, load_taint_sources
from .scanner import scan_incremental, scan_full, scan_quick
from .reporter import generate_report_from_json


def _resolve_files(project_path: Path, files: list[str]) -> list[str]:
    """把相对路径解析为基于 project_path 的绝对路径（保留已绝对化的路径）。"""
    resolved = []
    for f in files:
        p = Path(f)
        resolved.append(str(p if p.is_absolute() else project_path / p))
    return resolved


def _normalize_langs(langs: list[str] | None) -> list[str] | None:
    """规范化 --lang 参数：支持 'python,c' 逗号分隔与 'python c' 空格分隔。"""
    if not langs:
        return None
    out: list[str] = []
    for raw in langs:
        out.extend(x.strip() for x in raw.split(",") if x.strip())
    return out or None


def cmd_scan(args) -> int:
    project_path = Path(args.path).resolve()
    if not project_path.is_dir():
        print(f"错误：项目路径不存在：{project_path}", file=sys.stderr)
        return 2

    languages = _normalize_langs(args.langs) or detect_project_languages(str(project_path))
    # --owasp：仅加载 constitutional 优先级的规则（等价于 OWASP Top 10 + 供应链攻击）
    rules = load_rules(languages=languages, priority="constitutional" if args.owasp else None,
                       project_path=str(project_path))
    # 加载各语言全局污点源，用于候选风险打分（taint 信号）
    taint_sources = load_taint_sources(languages)

    project_name = args.project or project_path.name
    workers = getattr(args, "workers", 0) or 0
    start = time.time()

    if args.mode == "full":
        result = scan_full(
            str(project_path), rules,
            project_name=project_name, languages=languages,
            taint_sources=taint_sources, workers=workers,
        )
        scanned = result.scan_scope.get("files_scanned", [])
    else:
        if not args.files:
            print("incremental/quick 模式需要 --files 参数（或用 --mode full 全量扫描）",
                  file=sys.stderr)
            return 2
        files = _resolve_files(project_path, args.files)
        if args.mode == "quick":
            result = scan_quick(files, rules, project_name=project_name,
                                languages=languages, taint_sources=taint_sources,
                                workers=workers)
        else:
            result = scan_incremental(files, rules, project_name=project_name,
                                      languages=languages, taint_sources=taint_sources,
                                      workers=workers)
        scanned = result.scan_scope.get("files_scanned", [])

    result.scan_duration = f"{time.time() - start:.1f}s"
    # 引擎的 scan_full/scan_incremental 构造 ScanResult 时未设置 project_path，
    # 此处显式补上，供 generate_report_from_json 生成可点击 file:/// 链接。
    result.project_path = str(project_path)

    # 每次扫描在 .sec-scan-code/scans/<时间戳>/ 下建独立目录：
    # 扫描中间产物（findings.json / low-priority-candidates.json）与交付件
    # （scan-files.list / 最终报告）都放这里。报告生成后清理中间产物只留交付件。
    from datetime import datetime as _dt
    scans_root = project_path / ".sec-scan-code" / "scans"
    scans_root.mkdir(parents=True, exist_ok=True)
    scan_dir = scans_root / _dt.now().strftime("%Y%m%d_%H%M%S")
    scan_dir.mkdir(parents=True, exist_ok=True)
    out_dir = scan_dir

    # ─── 送审集选取：默认（--top-k 0）全部候选进 findings.json（Phase 5 决定
    #     是否全部分析）；显式 --top-k N 时只取前 N（支持 --per-category 每类别限额，
    #     防单条噪声规则占满预算），其余进 low-priority-candidates.json。
    from .scanner import select_review_set
    top_k = getattr(args, "top_k", 0) or 0
    per_category = getattr(args, "per_category", 0) or 0
    high = select_review_set(result.findings, top_k=top_k, per_category=per_category)
    high_keys = {(f.rule_id, f.file, f.line, f.category) for f in high}
    low = [f for f in result.findings
           if (f.rule_id, f.file, f.line, f.category) not in high_keys]

    result.scan_scope["candidate_tiers"] = {
        "top_k": top_k,
        "per_category": per_category,
        "high_priority": len(high),
        "low_priority": len(low),
    }
    result.findings = high  # findings.json 只含送审集

    # findings.json：高优先级候选（vuln_code/fix_code/exploit_scenario 为空，待 Phase 5 补齐）
    findings_path = out_dir / "findings.json"
    with open(findings_path, "w", encoding="utf-8") as f:
        json.dump(result.to_dict(), f, ensure_ascii=False, indent=2)

    # low-priority-candidates.json：低优先级候选（保留供审计/人工复核，不进入 Phase 5）
    low_path = out_dir / "low-priority-candidates.json"
    if low:
        with open(low_path, "w", encoding="utf-8") as f:
            json.dump({
                "note": "低优先级候选：未进入 LLM 深度验证（受 --top-k 限制）。"
                        "仍列在此供人工复核或作为未来全量分析素材。",
                "count": len(low),
                "findings": [fd.to_dict() for fd in low],
            }, f, ensure_ascii=False, indent=2)
    else:
        low_path.unlink(missing_ok=True)

    # scan-files.list：可审计的扫描范围记录（完整覆盖清单）。
    # 已扫描文件每行一个相对路径；未扫描（无规则语言）文件附带 "# SKIPPED: <原因>" 注释，
    # 便于核对"项目全部源码 → 扫了哪些、跳了哪些及原因"。
    def _rel(fp: str) -> str:
        p = Path(fp)
        return str(p.resolve().relative_to(project_path)) if p.is_absolute() else str(p)

    scan_files = out_dir / "scan-files.list"
    with open(scan_files, "w", encoding="utf-8") as f:
        for fp in scanned:
            f.write(_rel(fp) + "\n")
        for skip in result.scan_scope.get("files_skipped", []):
            f.write(f"{_rel(skip.get('file', ''))}  # SKIPPED: {skip.get('reason')}\n")

    skipped = result.scan_scope.get("files_skipped", [])
    print(f"=== scan summary ===")
    print(f"project: {project_name}")
    print(f"mode: {result.scan_mode}")
    print(f"languages: {', '.join(result.languages_detected) or 'none'}")
    print(f"rules applied: {len(result.rules_loaded)}  loaded: {', '.join(result.rules_loaded)}")
    print(f"files scanned: {len(scanned)}  files skipped: {len(skipped)}")
    if skipped:
        for s in skipped[:10]:
            print(f"  skip: {s.get('file')} ({s.get('reason')})")
    print(f"candidates: {len(high)} high-priority (top-k={top_k if top_k else 'all'})"
          f" + {len(low)} low-priority")
    # 类别/严重级别分解：供 Phase 5 判断是否需要让用户选择分析范围
    from collections import Counter
    _sev = Counter(f.severity.upper() for f in high)
    _cat = Counter(f.category for f in high)
    print(f"severity: {dict(sorted(_sev.items(), key=lambda kv: {'CRITICAL':0,'HIGH':1,'MEDIUM':2,'LOW':3}.get(kv[0],9)))}")
    print(f"categories (top 10): {_cat.most_common(10)}")
    print(f"duration: {result.scan_duration}")
    print(f"scan_dir: {scan_dir}")
    print(f"findings.json: {findings_path}")
    if low:
        print(f"low-priority-candidates.json: {low_path} ({len(low)} 条待人工复核)")
    print(f"scan-files.list: {scan_files}")
    return 0


def cmd_rules_brief(args) -> int:
    """输出精简规则摘要（约 2-4K tokens），替代加载全量 YAML。"""
    languages = _normalize_langs(args.langs)
    rules = load_rules(languages=languages)

    brief_rules = []
    for r in rules:
        # 聚合各语言该规则的类别 → pattern 数
        categories: dict[str, int] = {}
        for lang_rule in r.languages.values():
            for cat, pats in lang_rule.patterns.items():
                categories[cat] = categories.get(cat, 0) + len(pats)
        brief_rules.append({
            "rule_id": r.rule_id,
            "name": r.name,
            "severity": r.severity,
            "priority": r.priority,
            "owasp": r.owasp,
            "categories": categories,
            "pattern_total": sum(categories.values()),
            "languages": sorted(r.languages.keys()),
        })

    brief = {
        "languages": languages or "auto-detected",
        "rule_count": len(rules),
        "pattern_total": sum(r["pattern_total"] for r in brief_rules),
        "rules": brief_rules,
    }
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    return 0


def cmd_report(args) -> int:
    findings_path = Path(args.findings)
    if not findings_path.is_file():
        print(f"错误：findings.json 不存在：{findings_path}", file=sys.stderr)
        return 2
    # 未显式指定项目路径时，从 findings.json 位置推断：
    # 新布局 <project>/.sec-scan-code/scans/<ts>/findings.json
    # 旧布局 <project>/.sec-scan-code/findings.json
    if args.path:
        project_path = args.path
    elif (findings_path.parent.parent.name == ".sec-scan-code"
          and findings_path.parent.parent.parent.is_dir()):
        project_path = str(findings_path.parent.parent.parent)
    elif findings_path.parent.name == ".sec-scan-code":
        project_path = str(findings_path.parent.parent)
    else:
        project_path = None
    # 报告输出到 findings.json 所在目录（每次扫描独立目录），而非默认的 reports/
    output_dir = str(findings_path.parent)
    # 支持 --formats json,html（逗号分隔）与 --formats json html（空格分隔）
    formats = []
    for raw in (args.formats or ["json", "html"]):
        formats.extend(f.strip() for f in raw.split(",") if f.strip())
    try:
        generated = generate_report_from_json(
            str(findings_path),
            project_path=project_path,
            formats=formats,
            output_dir=output_dir,
        )
    except ValueError as e:
        # 合规校验失败（缺 vuln_code/fix_code/exploit_scenario）→ 提示补齐
        print(f"报告生成被拒绝：{e}", file=sys.stderr)
        return 3
    for fmt, path in generated.items():
        print(f"{fmt}: {path}")
    # --finalize：报告成功生成后，清理中间产物，只保留交付件（报告 + scan-files.list）
    if getattr(args, "finalize", False):
        for name in ("findings.json", "low-priority-candidates.json",
                     "deferred-candidates.json"):
            p = findings_path.parent / name
            p.unlink(missing_ok=True)
        print(f"已清理中间产物，扫描目录只保留交付件: {output_dir}", file=sys.stderr)
    return 0


def cmd_select(args) -> int:
    """从 findings.json（全部候选）按策略选取送审子集。

    用于"漏洞很多、让用户选择分析哪些"的场景：扫描默认把全部候选写入
    findings.json；此处按用户选择（全部/按严重级别/按类别/Top-N/特定文件）
    选取子集重写 findings.json，未选中的写入 deferred-candidates.json 保留。
    """
    from .scanner import Finding, select_review_set

    findings_path = Path(args.findings)
    if not findings_path.is_file():
        print(f"错误：findings.json 不存在：{findings_path}", file=sys.stderr)
        return 2

    with open(findings_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw = data.get("findings", [])
    findings = [
        Finding(
            id=x.get("id", i + 1), rule_id=x.get("rule_id", ""),
            rule_name=x.get("rule_name", ""), severity=x.get("severity", ""),
            confidence=x.get("confidence", 5), category=x.get("category", ""),
            language=x.get("language", ""), file=x.get("file", ""),
            line=x.get("line", 0), code_snippet=x.get("code_snippet", ""),
            description=x.get("description", ""), recommendation=x.get("recommendation", ""),
            exploit_scenario=x.get("exploit_scenario", ""), vuln_code=x.get("vuln_code", ""),
            fix_code=x.get("fix_code", ""), source=x.get("source", "constitutional"),
            risk_score=x.get("risk_score", 0),
        )
        for i, x in enumerate(raw)
    ]

    strategy = args.strategy or "all"
    if strategy == "top-k":
        chosen = select_review_set(findings, top_k=args.top_k or 0,
                                   per_category=args.per_category or 0)
    elif strategy == "severity":
        sevs = {s.strip().upper() for s in (args.severities or "CRITICAL,HIGH").split(",")
                if s.strip()}
        chosen = [f for f in findings if f.severity.upper() in sevs]
    elif strategy == "categories":
        cats = {c.strip() for c in (args.categories or "").split(",") if c.strip()}
        chosen = [f for f in findings if f.category in cats]
    elif strategy == "files":
        fset = {fp.strip() for fp in (args.files or "").split(",") if fp.strip()}
        chosen = [f for f in findings if f.file in fset]
    else:  # all
        chosen = findings

    chosen_keys = {(f.rule_id, f.file, f.line, f.category) for f in chosen}
    deferred = [f for f in findings
                if (f.rule_id, f.file, f.line, f.category) not in chosen_keys]

    data["findings"] = [f.to_dict() for f in chosen]
    with open(findings_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    if deferred:
        defer_path = findings_path.parent / "deferred-candidates.json"
        with open(defer_path, "w", encoding="utf-8") as f:
            json.dump({
                "note": "未选入本次送审，保留供后续分析或人工复核。",
                "count": len(deferred),
                "findings": [f.to_dict() for f in deferred],
            }, f, ensure_ascii=False, indent=2)
        print(f"未选中 {len(deferred)} 条 → {defer_path}", file=sys.stderr)

    print(f"送审子集: {len(chosen)} 条（策略={strategy}）→ {findings_path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="secscancode.cli",
                                     description="sec-scan-code engine CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="引擎扫描并写 findings.json")
    p_scan.add_argument("--mode", choices=["full", "incremental", "quick"],
                        default="incremental")
    p_scan.add_argument("--path", required=True, help="项目根目录")
    p_scan.add_argument("--owasp", action="store_true",
                        help="仅扫描 constitutional(OWASP) 规则")
    p_scan.add_argument("--top-k", type=int, default=0,
                        help="送审候选上限：按风险分取前 N 条进 findings.json，"
                             "其余进 low-priority-candidates.json（默认 0 = 全部进，"
                             "由 Phase 5 决定是否全部分析）")
    p_scan.add_argument("--per-category", type=int, default=0,
                        help="每类别硬上限（默认 0 = 不限额，纯风险排序；>0 时每类别最多 N 条，"
                             "防噪声规则占满预算，注意类别少时结果可能少于 top-k）")
    p_scan.add_argument("--workers", type=int, default=0,
                        help="并行扫描进程数（默认 0 = 自动：≥30 文件时用 min(cpu,8)，"
                             "否则顺序；1 = 强制顺序）")
    p_scan.add_argument("--lang", dest="langs", nargs="*",
                        help="限定语言（不传则自动检测）")
    p_scan.add_argument("--files", nargs="*", help="incremental/quick 模式的文件列表")
    p_scan.add_argument("--project", help="项目名（默认取目录名）")
    p_scan.set_defaults(func=cmd_scan)

    p_brief = sub.add_parser("rules-brief", help="输出精简规则摘要")
    p_brief.add_argument("--lang", dest="langs", nargs="*",
                         help="限定语言（不传则输出全部已装语言规则）")
    p_brief.set_defaults(func=cmd_rules_brief)

    p_report = sub.add_parser("report", help="从 findings.json 生成报告")
    p_report.add_argument("--findings", required=True, help="findings.json 路径")
    p_report.add_argument("--path", help="项目根目录（默认读 findings.json 的 project_path）")
    p_report.add_argument("--formats", nargs="*", default=["json", "html"],
                          help="输出格式（json/html）")
    p_report.add_argument("--finalize", action="store_true",
                          help="报告生成成功后清理中间产物（findings.json/low-priority），"
                               "只保留交付件（报告 + scan-files.list）")
    p_report.set_defaults(func=cmd_report)

    p_select = sub.add_parser("select", help="按策略从 findings.json 选取送审子集")
    p_select.add_argument("--findings", required=True, help="findings.json 路径")
    p_select.add_argument("--strategy",
                          choices=["all", "top-k", "severity", "categories", "files"],
                          default="all", help="选取策略")
    p_select.add_argument("--top-k", type=int, default=0,
                          help="top-k 策略：送审条数（0=不限制）")
    p_select.add_argument("--per-category", type=int, default=0,
                          help="top-k 策略的每类别硬上限（默认 0 = 不限额；>0 时每类别最多 N 条）")
    p_select.add_argument("--severities", help="severity 策略：CRITICAL,HIGH")
    p_select.add_argument("--categories", help="categories 策略：sql-injection,xss")
    p_select.add_argument("--files", help="files 策略：a.py,b.go（相对路径，逗号分隔）")
    p_select.set_defaults(func=cmd_select)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
