"""Scanner engine: applies rules to source files and produces findings."""

import re
import os
import logging
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone

from .rules_loader import Rule, LanguageRule, Pattern

logger = logging.getLogger(__name__)


@dataclass
class Finding:
    id: int
    rule_id: str
    rule_name: str
    severity: str
    confidence: int  # 1-10
    category: str
    language: str
    file: str
    line: int
    code_snippet: str
    description: str
    recommendation: str = ""     # 修复原则（一句话，可选）
    exploit_scenario: str = ""   # 攻击场景（必填）
    vuln_code: str = ""          # 原漏洞代码（逐字复制自源码，保持变量名，必填）
    fix_code: str = ""           # 修复后代码（保持变量名，可直接替换，必填）
    source: str = "constitutional"  # constitutional | supplementary | project-specific
    risk_score: int = 0          # 风险打分（0-100+），供 Top-K 排序用；越高越优先送 LLM 验证

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}

# 风险打分权重：severity 越严重基数越高
_SEVERITY_WEIGHT = {"CRITICAL": 100, "HIGH": 70, "MEDIUM": 40, "LOW": 15}


def _is_test_file(filepath: str) -> bool:
    """判断文件是否属于测试文件/测试目录（低优先级候选的强信号）。"""
    p = Path(filepath)
    name = p.name.lower()
    if (name.startswith("test_") or name.endswith("_test.py")
            or name.endswith("_test.go") or name.endswith(".test.js")
            or name.endswith(".test.ts") or name.endswith(".spec.js")
            or name.endswith(".spec.ts") or name.endswith("_test.java")):
        return True
    return any(part.lower() in {"test", "tests", "__tests__", "spec", "specs"}
               for part in p.parts[:-1])


def compute_risk_score(severity: str, confidence: int, code_snippet: str,
                       filepath: str,
                       taint_patterns: Optional[list[str]] = None) -> int:
    """候选风险打分：severity 权重 + confidence + 污点源信号 − 测试文件罚分。

    供 Top-K 排序使用：分数高 → 送 LLM 深度验证；分数低 → 低优先级候选。
    """
    score = _SEVERITY_WEIGHT.get(severity.upper(), 30)
    score += max(0, min(10, confidence)) * 3
    if taint_patterns:
        for p in taint_patterns:
            try:
                hit = re.search(p, code_snippet)
            except re.error:
                # taint_sources 多为字面子串（如 "Query("、路径片段），非法正则回退为字面匹配
                hit = re.search(re.escape(p), code_snippet)
            if hit:
                score += 20
                break
    if _is_test_file(filepath):
        score -= 35
    return max(0, score)


def select_review_set(findings: list[Finding], top_k: int = 0,
                      per_category: int = 0) -> list[Finding]:
    """按风险分选取送审候选集。

    Args:
        findings: 全部候选（已含 risk_score）。
        top_k: >0 时只取前 top_k 条；0 = 不限制。
        per_category: >0 时每类别**硬上限** per_category 条（合流后按风险排取前 top_k）。
            **注意**：类别少时返回条数可能少于 top_k——这是有意的「宁缺毋滥」：
            用多样性换数量，防止单条噪声规则占满送审预算。若希望严格取满 top_k，
            不要设置 per_category（默认 0 = 纯风险排序，无截断）。

    Returns:
        选取后的候选（按 risk_score 降序）。
    """
    ranked = sorted(findings, key=lambda f: f.risk_score, reverse=True)

    # 不限制数量 → 返回全部（无论是否设置了每类别限额）
    if top_k <= 0:
        return ranked

    # 无类别限额 → 全局取前 top_k
    if not per_category or per_category <= 0:
        return ranked[:top_k]

    # 有类别限额（硬上限）：每类别最多 per_category 条，合流后按风险排，取前 top_k。
    from collections import defaultdict
    by_cat: dict[str, list[Finding]] = defaultdict(list)
    for f in ranked:
        by_cat[f.category].append(f)

    pooled: list[Finding] = []
    for items in by_cat.values():
        pooled.extend(items[:per_category])
    pooled.sort(key=lambda f: f.risk_score, reverse=True)
    return pooled[:top_k]


def _sort_findings(findings: list[Finding]) -> list[Finding]:
    """Sort findings by severity (high→low), then by category (alphabetical)."""
    return sorted(findings, key=lambda f: (SEVERITY_ORDER.get(f.severity.upper(), 9), f.category))


def _deduplicate_findings(findings: list[Finding]) -> list[Finding]:
    """Deduplicate findings: same vulnerability + same location → keep one."""
    seen: set[tuple[str, str, int, str]] = set()
    result: list[Finding] = []
    for f in findings:
        key = (f.rule_id, f.file, f.line, f.category)
        if key not in seen:
            seen.add(key)
            result.append(f)
    return result


@dataclass
class ScanResult:
    version: str = "2.0.0"
    timestamp: str = ""
    scan_date: str = ""       # Human-readable scan date, e.g. "2026-06-16 08:24:35"
    scan_duration: str = ""   # Elapsed time, e.g. "2m 35s"
    project: str = ""
    project_path: str = ""    # Absolute project root path for generating file:/// links
    scan_mode: str = "incremental"  # incremental | full | quick
    languages_detected: list[str] = field(default_factory=list)
    rules_loaded: list[str] = field(default_factory=list)
    scan_scope: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)
    ai_limitations_notice: str = ""
    totals: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
        if not self.scan_date:
            self.scan_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.ai_limitations_notice = (
            "AI扫描存在不完善风险：可能遗漏复杂漏洞链、跨文件数据流漏洞、"
            "运行时才触发的漏洞。建议结合专业安全审计工具使用。"
        )

    def compute_totals(self):
        severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        category_counts: dict[str, int] = {}
        language_counts: dict[str, int] = {}

        for f in self.findings:
            sev = f.severity.lower()
            if sev in severity_counts:
                severity_counts[sev] += 1
            category_counts[f.category] = category_counts.get(f.category, 0) + 1
            language_counts[f.language] = language_counts.get(f.language, 0) + 1

        self.totals = {
            **severity_counts,
            "by_category": category_counts,
            "by_language": language_counts,
        }

    def sort_findings(self):
        """Sort findings by severity (high→low), then by category."""
        self.findings = _sort_findings(self.findings)

    def deduplicate_findings(self):
        """Deduplicate findings before reporting."""
        self.findings = _deduplicate_findings(self.findings)

    def validate(self) -> list[str]:
        """校验报告合规性：每个发现必须包含原漏洞代码、修复后代码、攻击场景。

        Returns:
            list[str]: 不合规项描述；空列表表示全部合规。
        """
        errors: list[str] = []
        for f in self.findings:
            loc = f"{f.file}:{f.line}"
            if not (f.vuln_code or "").strip():
                errors.append(f"#{f.id} {loc} 缺少原漏洞代码(vuln_code)")
            if not (f.fix_code or "").strip():
                errors.append(f"#{f.id} {loc} 缺少修复后代码(fix_code)")
            if not (f.exploit_scenario or "").strip():
                errors.append(f"#{f.id} {loc} 缺少攻击场景(exploit_scenario)")
        return errors

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "timestamp": self.timestamp,
            "scan_date": self.scan_date,
            "scan_duration": self.scan_duration,
            "project": self.project,
            "project_path": self.project_path,
            "scan_mode": self.scan_mode,
            "languages_detected": self.languages_detected,
            "rules_loaded": self.rules_loaded,
            "scan_scope": self.scan_scope,
            "findings": [f.to_dict() for f in self.findings],
            "ai_limitations_notice": self.ai_limitations_notice,
            "totals": self.totals,
        }


def _read_file_lines(filepath: str) -> list[str]:
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        if "\ufffd" in content:
            logger.warning("Encoding replacement characters in: %s", filepath)
        return content.splitlines(True)
    except (OSError, IOError):
        return []


def _get_file_extension(filepath: str) -> str:
    return Path(filepath).suffix


def _detect_language_for_file(filepath: str, rules: list[Rule]) -> Optional[str]:
    """Detect which language a file belongs to based on rule definitions."""
    ext = _get_file_extension(filepath)
    for rule in rules:
        for lang, lang_rule in rule.languages.items():
            if ext in lang_rule.file_extensions:
                return lang
    return None


def _match_pattern(line: str, pattern: str) -> bool:
    try:
        return bool(re.search(pattern, line))
    except re.error as e:
        logger.warning("Invalid regex pattern '%s': %s", pattern, e)
        return False


def _is_safe(line: str, safe_patterns: list[str]) -> bool:
    """Check if a line matches any safe pattern (indicating mitigated code)."""
    for sp in safe_patterns:
        if _match_pattern(line, sp):
            return True
    return False


def _get_code_snippet(lines: list[str], line_num: int, context: int = 2) -> str:
    """Get code snippet around a line number (1-indexed)."""
    start = max(0, line_num - 1 - context)
    end = min(len(lines), line_num + context)
    snippet_lines = lines[start:end]
    return "".join(snippet_lines).strip()


# ─── 注释/字符串行过滤 ───
# 哪些类别"故意"检查注释内容（例如 A09 sensitive-comment 检测注释里的密码），
# 这些类别的匹配行即使位于注释/文档字符串内也应保留；其余类别的注释行匹配视为误报直接跳过。
_COMMENT_TARGETING_CATEGORIES = {"sensitive-comment"}


def _mark_non_code_lines_python(lines: list[str]) -> set[int]:
    """Python：用 tokenize 标记不含可执行代码的行（纯注释/文档字符串/纯字符串行）。

    规则：一行只要含任一 NAME/NUMBER/OP/KEYWORD 代码 token 即视为代码行；
    否则（只有注释/字符串/空白）视为非代码行。文档字符串与多行字符串的续行
    因此被正确标记为非代码，而 `x = "SELECT ..." + uid` 这类赋值仍保留为代码行。
    """
    import io
    import tokenize as _tokenize

    text = "".join(lines)
    lines_with_code: set[int] = set()
    # 关键字 token 在旧版本为 KEYWORD、3.12+ 并入 NAME（tokenize.KEYWORD 已移除）
    keyword_type = getattr(_tokenize, "KEYWORD", _tokenize.NAME)
    try:
        for tok in _tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type in (_tokenize.NAME, _tokenize.NUMBER, _tokenize.OP, keyword_type):
                lines_with_code.add(tok.start[0] - 1)
    except Exception:
        # 语法错误等 → 保守回退到通用过滤（几乎不滤，宁漏勿误）
        return _mark_non_code_lines_generic(lines)

    non_code: set[int] = set()
    for idx, line in enumerate(lines):
        if line.strip() and idx not in lines_with_code:
            non_code.add(idx)
    return non_code


def _mark_non_code_lines_config(lines: list[str]) -> set[int]:
    """配置文件（yml/yaml/properties/env）：`#` 是注释到行尾，整行注释标记为非代码。"""
    non_code: set[int] = set()
    for idx, line in enumerate(lines):
        if not line.strip() or line.lstrip().startswith("#"):
            non_code.add(idx)
    return non_code


def _mark_non_code_lines_generic(lines: list[str]) -> set[int]:
    """通用语言（JS/Go/Java/C）：保守的注释行过滤。

    仅处理 /* */ 块注释与整行 // 注释，不处理字符串字面量（跨语言有正则字面量、
    模板字符串、预处理器等，过滤字符串风险过高）。若块注释未闭合（解析出错），
    保守返回空集——宁保留噪声，也不因误判把真实代码行整片过滤掉。
    """
    non_code: set[int] = set()
    in_block = False
    for idx, line in enumerate(lines):
        i, n = 0, len(line)
        has_code = False
        while i < n:
            if in_block:
                if line[i] == "*" and i + 1 < n and line[i + 1] == "/":
                    in_block = False
                    i += 2
                    continue
                i += 1
                continue
            if line[i] == "/" and i + 1 < n:
                if line[i + 1] == "/":
                    break  # 剩余行是注释
                if line[i + 1] == "*":
                    in_block = True
                    i += 2
                    continue
            if not line[i].isspace():
                has_code = True
            i += 1
        if not has_code and line.strip():
            non_code.add(idx)
    if in_block:
        return set()
    return non_code


def _mark_non_code_lines(lines: list[str], language: str) -> set[int]:
    """返回 0-indexed 的非代码行集合（纯注释/文档字符串/纯字符串行）。"""
    if language == "python":
        return _mark_non_code_lines_python(lines)
    if language == "config":
        return _mark_non_code_lines_config(lines)
    return _mark_non_code_lines_generic(lines)


def scan_file(filepath: str, rules: list[Rule], finding_id_start: int = 1,
              lines: Optional[list[str]] = None,
              non_code_lines: Optional[set[int]] = None,
              taint_patterns: Optional[list[str]] = None) -> list[Finding]:
    """Scan a single file against applicable rules. Returns list of findings.

    Args:
        lines: 预读的行内容（避免 scan_incremental/scan_full 重复读文件）。
        non_code_lines: 预计算的非代码行集合（避免重复标记）。
        taint_patterns: 该语言的全局污点源模式，用于风险打分。
    """
    if lines is None:
        lines = _read_file_lines(filepath)
    if not lines:
        return []

    lang = _detect_language_for_file(filepath, rules)
    if not lang:
        return []
    if non_code_lines is None:
        non_code_lines = _mark_non_code_lines(lines, lang)

    findings: list[Finding] = []
    finding_id = finding_id_start

    for rule in rules:
        if lang not in rule.languages:
            continue

        lang_rule = rule.languages[lang]

        for category, patterns in lang_rule.patterns.items():
            # 该类别是否故意扫描注释内容（如 sensitive-comment）
            scans_comments = category in _COMMENT_TARGETING_CATEGORIES
            for pat in patterns:
                for line_idx, line in enumerate(lines):
                    # 跳过非代码行（注释/文档字符串）上的匹配，除非规则专门检查注释
                    if line_idx in non_code_lines and not scans_comments:
                        continue
                    # 先匹配检测模式，命中后再查 safe_patterns（避免对每行空跑安全模式）
                    if _match_pattern(line, pat.pattern) and not _is_safe(line, pat.safe_patterns):
                        snippet = _get_code_snippet(lines, line_idx + 1)
                        findings.append(Finding(
                            id=finding_id,
                            rule_id=rule.rule_id,
                            rule_name=rule.name,
                            severity=rule.severity,
                            confidence=pat.confidence,
                            category=category,
                            language=lang,
                            file=filepath,
                            line=line_idx + 1,
                            code_snippet=snippet,
                            description=pat.description,
                            source=rule.priority,
                            risk_score=compute_risk_score(
                                rule.severity, pat.confidence, snippet, filepath, taint_patterns),
                        ))
                        finding_id += 1

    return findings


# ─── 并行扫描 ───
# 文件之间无依赖，scan_file 是纯函数 → 用 ProcessPoolExecutor 按文件并行，
# 大项目可利用多核加速。正则扫描是 CPU 密集，需多进程（GIL 让线程不加速）。

_worker_state: dict = {}


def _init_worker(rules, taint_sources) -> None:
    """每个 worker 进程初始化一次：规则与污点源只传一份。"""
    _worker_state["rules"] = rules
    _worker_state["taint_sources"] = taint_sources


def _scan_file_task(filepath: str) -> tuple:
    """单文件扫描任务（多进程 worker 或顺序模式共用）。

    Returns:
        (filepath, lang_or_None, line_count_or_0, findings, skip_reason_or_None)
    """
    rules = _worker_state["rules"]
    taint_sources = _worker_state["taint_sources"]
    lines = _read_file_lines(filepath)
    if not lines:
        return filepath, None, 0, [], "unreadable_or_empty"
    lang = _detect_language_for_file(filepath, rules)
    if not lang:
        return filepath, None, 0, [], "language_not_detected"
    non_code_lines = _mark_non_code_lines(lines, lang)
    taint = (taint_sources or {}).get(lang)
    findings = scan_file(filepath, rules, 1, lines=lines,
                         non_code_lines=non_code_lines, taint_patterns=taint)
    return filepath, lang, len(lines), findings, None


def _scan_files(files: list[str], rules: list[Rule],
                taint_sources: Optional[dict[str, list[str]]] = None,
                workers: int = 0) -> tuple:
    """扫描文件列表（自动并行或顺序）。

    Args:
        workers: 0=自动（≥30 文件时用 min(cpu,8) 并行，否则顺序）；1=强制顺序；
            >1=指定并行进程数。

    Returns:
        (scanned_files, skipped_list, file_line_counts, all_findings, total_lines)
    """
    import os as _os

    if workers == 0:
        workers = min(_os.cpu_count() or 1, 8) if len(files) >= 30 else 1

    scanned: list[str] = []
    skipped: list[dict] = []
    file_line_counts: dict[str, int] = {}
    all_findings: list[Finding] = []
    total_lines = 0

    def _collect(r) -> None:
        nonlocal total_lines
        filepath, lang, nlines, findings, reason = r
        if reason:
            skipped.append({"file": filepath, "reason": reason})
            return
        scanned.append(filepath)
        file_line_counts[filepath] = nlines
        total_lines += nlines
        all_findings.extend(findings)

    if workers <= 1:
        _worker_state["rules"] = rules
        _worker_state["taint_sources"] = taint_sources
        for fp in files:
            _collect(_scan_file_task(fp))
        return scanned, skipped, file_line_counts, all_findings, total_lines

    from concurrent.futures import ProcessPoolExecutor
    try:
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker,
                                 initargs=(rules, taint_sources)) as ex:
            results = list(ex.map(_scan_file_task, files))
    except Exception:
        # 并行初始化/执行失败（如 Windows 下 `python -c` spawn 不可用）→ 顺序回退
        _worker_state["rules"] = rules
        _worker_state["taint_sources"] = taint_sources
        results = [_scan_file_task(fp) for fp in files]
    for r in results:
        _collect(r)
    return scanned, skipped, file_line_counts, all_findings, total_lines


def scan_incremental(files: list[str], rules: list[Rule],
                     project_name: str = "",
                     languages: Optional[list[str]] = None,
                     taint_sources: Optional[dict[str, list[str]]] = None,
                     workers: int = 0) -> ScanResult:
    """Incremental scan: only scan specified files.

    Args:
        taint_sources: language → 污点源模式列表，用于风险打分（可选）。
        workers: 并行进程数（0=自动，见 _scan_files）。
    """
    result = ScanResult(
        project=project_name,
        scan_mode="incremental",
        languages_detected=languages or [],
        rules_loaded=[r.rule_id for r in rules],
        scan_scope={
            "files_scanned": [],
            "files_count": 0,
            "lines_scanned": 0,
            "source": "session_changes",
            "file_line_counts": {},
            "files_skipped": [],
            "dirs_skipped": [],
        },
    )

    scanned, skipped, file_line_counts, all_findings, total_lines = _scan_files(
        files, rules, taint_sources, workers=workers)

    result.scan_scope["files_skipped"] = skipped
    result.scan_scope["file_line_counts"] = file_line_counts
    result.scan_scope["files_scanned"] = scanned
    result.scan_scope["files_count"] = len(scanned)
    result.scan_scope["lines_scanned"] = total_lines
    result.findings = _deduplicate_findings(all_findings)
    # 去重后重排 id 为连续序号（并行下各文件 id 从 1 起，需全局重排）
    for i, f in enumerate(result.findings, start=1):
        f.id = i
    result.sort_findings()
    result.compute_totals()
    return result


def scan_full(project_path: str, rules: list[Rule],
              project_name: str = "",
              languages: Optional[list[str]] = None,
              taint_sources: Optional[dict[str, list[str]]] = None,
              workers: int = 0) -> ScanResult:
    """Full scan: scan all source files in the project.

    Args:
        taint_sources: language → 污点源模式列表，用于风险打分（可选）。
        workers: 并行进程数（0=自动，见 _scan_files）。
    """
    if not languages:
        languages = []

    # Collect all relevant source files.
    # 规则扩展名（5 语言 + config）∪ detect-changes 的源文件扩展名（xml/sql/yml/json/sh 等）。
    # 这样 scan-files.list 能展示项目完整源码清单；无规则语言的文件在下方记录为 skipped。
    all_extensions: set[str] = set()
    for rule in rules:
        for lang, lang_rule in rule.languages.items():
            all_extensions.update(lang_rule.file_extensions)
    from .git_changes import SOURCE_EXTENSIONS
    all_extensions.update("." + ext for ext in SOURCE_EXTENSIONS)

    SKIPPED_DIRS = {
        ".git", "node_modules", "__pycache__", ".venv", "venv",
        "dist", "build", ".tox", ".mypy_cache", ".pytest_cache",
        ".sec-scan-code",
        # 构建输出目录（target/out 含编译复制的配置，扫了会重复计）
        "target", "out", ".gradle",
        # skill 自身安装目录（.codebuddy/.trae/.qoder 下有自己的 rules，扫了会误报）
        ".codebuddy", ".trae", ".qoder",
    }

    source_files: list[str] = []
    dirs_skipped: list[str] = []
    for root, dirs, files in os.walk(project_path):
        # Track skipped directories
        for d in dirs:
            if d in SKIPPED_DIRS:
                dirs_skipped.append(os.path.join(root, d))
        # Skip common non-source directories
        dirs[:] = [d for d in dirs if d not in SKIPPED_DIRS]
        for f in files:
            if Path(f).suffix in all_extensions:
                source_files.append(os.path.join(root, f))

    result = ScanResult(
        project=project_name,
        scan_mode="full",
        languages_detected=languages,
        rules_loaded=[r.rule_id for r in rules],
        scan_scope={
            "files_scanned": [],
            "files_count": 0,
            "lines_scanned": 0,
            "source": "full_project",
            "file_line_counts": {},
            "files_skipped": [],
            "dirs_skipped": dirs_skipped,
        },
    )

    scanned, skipped, file_line_counts, all_findings, total_lines = _scan_files(
        source_files, rules, taint_sources, workers=workers)

    result.scan_scope["files_skipped"] = skipped
    result.scan_scope["file_line_counts"] = file_line_counts
    result.scan_scope["files_scanned"] = scanned
    result.scan_scope["files_count"] = len(scanned)
    result.scan_scope["lines_scanned"] = total_lines
    result.findings = _deduplicate_findings(all_findings)
    # 去重后重排 id 为连续序号（并行下各文件 id 从 1 起，需全局重排）
    for i, f in enumerate(result.findings, start=1):
        f.id = i
    result.sort_findings()
    result.compute_totals()
    return result


def scan_quick(files: list[str], rules: list[Rule],
               project_name: str = "",
               languages: Optional[list[str]] = None,
               taint_sources: Optional[dict[str, list[str]]] = None,
               workers: int = 0) -> ScanResult:
    """Quick scan: only constitutional rules on specified files.

    Args:
        workers: 并行进程数（0=自动），透传给 scan_incremental。
    """
    constitutional = [r for r in rules if r.priority == "constitutional"]
    result = scan_incremental(files, constitutional, project_name, languages,
                              taint_sources=taint_sources, workers=workers)
    result.scan_mode = "quick"
    return result
