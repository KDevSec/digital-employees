"""Rule loader for sec-scan-code: loads OWASP metadata + language rules, merges them.

Architecture:
  OWASP YAML:  defines WHAT to check (rule_id, categories, severity)
  Language YAML: defines HOW to check (patterns, safe_patterns per category)
  Merge:       OWASP.category × Language.rule(category) → complete scan rule
"""

import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

import yaml


RULES_DIR = Path(__file__).parent.parent / "rules"


@dataclass
class Pattern:
    pattern: str
    description: str
    confidence: int = 7  # 1-10, default 7
    safe_patterns: list[str] = field(default_factory=list)


@dataclass
class LanguageRule:
    file_extensions: list[str] = field(default_factory=list)
    patterns: dict[str, list[Pattern]] = field(default_factory=dict)
    safe_patterns: list[str] = field(default_factory=list)


@dataclass
class Rule:
    rule_id: str
    name: str
    severity: str
    priority: str  # constitutional | supplementary | project-specific
    description: str = ""
    owasp: Optional[str] = None
    categories: list[str] = field(default_factory=list)
    languages: dict[str, LanguageRule] = field(default_factory=dict)


@dataclass
class ConstitutionBrief:
    rule_id: str
    severity: str
    brief: str


def load_yaml(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ─── OWASP / Supplementary metadata loading ───

def _parse_owasp_metadata(data: dict) -> dict:
    """Parse OWASP/supplementary YAML into a metadata dict.
    Returns {rule_id, name, severity, priority, description, owasp, categories}.
    """
    categories = []
    for cat in data.get("categories", []):
        if isinstance(cat, dict):
            categories.append(cat["id"])
        else:
            categories.append(cat)

    return {
        "rule_id": data["rule_id"],
        "name": data["name"],
        "severity": data["severity"],
        "priority": data.get("priority", "supplementary"),
        "description": data.get("description", ""),
        "owasp": data.get("owasp"),
        "categories": categories,
    }


def _load_owasp_metadata() -> list[dict]:
    """Load all OWASP rule metadata (no language patterns)."""
    metadata = []
    owasp_dir = RULES_DIR / "owasp"
    if owasp_dir.is_dir():
        for f in sorted(owasp_dir.glob("*.yaml")):
            data = load_yaml(f)
            if data:
                metadata.append(_parse_owasp_metadata(data))
    return metadata


def _load_supplementary_metadata() -> list[dict]:
    """Load all supplementary rule metadata (no language patterns)."""
    metadata = []
    supp_dir = RULES_DIR / "supplementary"
    if supp_dir.is_dir():
        for f in sorted(supp_dir.glob("*.yaml")):
            data = load_yaml(f)
            if data:
                metadata.append(_parse_owasp_metadata(data))
    return metadata


# ─── Language rule loading ───

@dataclass
class LanguageRuleEntry:
    """A single rule entry from a language YAML."""
    category: str
    owasp: str
    severity: str
    patterns: list[Pattern] = field(default_factory=list)
    safe_patterns: list[str] = field(default_factory=list)


@dataclass
class LanguageSpec:
    """Complete language specification loaded from languages/<lang>.yaml."""
    language: str
    file_extensions: list[str] = field(default_factory=list)
    rules: list[LanguageRuleEntry] = field(default_factory=list)
    taint_sources: list[str] = field(default_factory=list)  # 全局污点源模式（flattened）


def _parse_language_rule_entry(data: dict) -> LanguageRuleEntry:
    """Parse a single rule entry from language YAML."""
    patterns = [
        Pattern(
            p["pattern"],
            p["description"],
            p.get("confidence", 7),
            p.get("safe_patterns", []),
        )
        for p in data.get("patterns", [])
    ]
    return LanguageRuleEntry(
        category=data["category"],
        owasp=data["owasp"],
        severity=data.get("severity", "MEDIUM"),
        patterns=patterns,
        safe_patterns=data.get("safe_patterns", []),
    )


def load_language_spec(language: str) -> Optional[LanguageSpec]:
    """Load a language specification from languages/<language>.yaml."""
    path = RULES_DIR / "languages" / f"{language}.yaml"
    if not path.is_file():
        return None

    data = load_yaml(path)
    if not data:
        return None

    spec = LanguageSpec(
        language=data["language"],
        file_extensions=data.get("file_extensions", []),
    )

    # 解析顶层 taint_sources（用户输入源），flatten 成模式字符串列表供风险打分使用
    for ts in data.get("taint_sources", []):
        spec.taint_sources.extend(ts.get("patterns", []))

    for rule_data in data.get("rules", []):
        spec.rules.append(_parse_language_rule_entry(rule_data))

    return spec


# ─── Merge: OWASP metadata × Language rules ───

def _merge_owasp_with_languages(
    owasp_metadata: list[dict],
    language_specs: dict[str, LanguageSpec],
) -> list[Rule]:
    """Merge OWASP metadata with language rules to produce complete Rule objects.

    For each OWASP rule, find matching language rule entries by category
    and build the Rule.languages dict.
    """
    # Index language rules by (owasp_id, category) for fast lookup
    lang_rules_index: dict[str, dict[str, list[LanguageRuleEntry]]] = {}
    for lang_name, spec in language_specs.items():
        lang_rules_index[lang_name] = {}
        for entry in spec.rules:
            key = entry.owasp
            if key not in lang_rules_index[lang_name]:
                lang_rules_index[lang_name][key] = []
            lang_rules_index[lang_name][key].append(entry)

    rules = []
    for meta in owasp_metadata:
        rule = Rule(
            rule_id=meta["rule_id"],
            name=meta["name"],
            severity=meta["severity"],
            priority=meta["priority"],
            description=meta["description"],
            owasp=meta["owasp"],
            categories=meta["categories"],
        )

        # For each language, find rule entries that match this OWASP rule
        # Use meta["owasp"] (short id like "A01") to match language rule entry.owasp field
        lookup_key = meta["owasp"] or meta["rule_id"]
        for lang_name, spec in language_specs.items():
            entries = lang_rules_index.get(lang_name, {}).get(lookup_key, [])
            if not entries:
                continue

            # Build LanguageRule with patterns grouped by category
            lang_rule = LanguageRule(
                file_extensions=spec.file_extensions,
            )

            # Normalize categories to a set of id strings for matching
            cat_ids = set()
            for cat in meta["categories"]:
                cat_ids.add(cat["id"] if isinstance(cat, dict) else cat)

            for entry in entries:
                if entry.category in cat_ids:
                    # 继承类别级 safe_patterns 时复制 Pattern 而非就地变异共享对象
                    # （避免任何"缓存 spec / 复用对象"的改动触发跨规则污染）
                    copied: list[Pattern] = []
                    for p in entry.patterns:
                        if not p.safe_patterns:
                            copied.append(Pattern(
                                pattern=p.pattern, description=p.description,
                                confidence=p.confidence,
                                safe_patterns=list(entry.safe_patterns),
                            ))
                        else:
                            copied.append(p)
                    lang_rule.patterns[entry.category] = copied

            if lang_rule.patterns:
                rule.languages[lang_name] = lang_rule

        rules.append(rule)

    return rules


# ─── Public API ───

def load_rules(languages: Optional[list[str]] = None,
               priority: Optional[str] = None,
               project_path: Optional[str] = None) -> list[Rule]:
    """Load all rules by merging OWASP metadata with language specs.

    Args:
        languages: Only load rules for these languages.
        priority: Only return rules with this priority level.
        project_path: 项目根目录。若有，则额外从 <project>/.sec-scan-code/
            constitution-project.yaml 加载项目特定宪法（回退 skill rules/ 旧位置）。
    """
    # Load OWASP + supplementary metadata
    owasp_meta = _load_owasp_metadata()
    supp_meta = _load_supplementary_metadata()
    all_meta = owasp_meta + supp_meta

    # Load language specs. 配置文件规则（yml/yaml/properties/env）始终加载，
    # 不依赖语言检测结果——配置文件存在于任何项目。
    # 未指定 languages 时加载全部已装语言（供 rules-brief 展示全量规则，
    # 避免只加载 config 导致其余规则成空壳）。
    lang_specs: dict[str, LanguageSpec] = {}
    langs_to_load = list(languages) if languages else ["python", "javascript", "java", "go", "c"]
    if "config" not in langs_to_load:
        langs_to_load.append("config")
    for lang in langs_to_load:
        spec = load_language_spec(lang)
        if spec:
            lang_specs[lang] = spec

    # Merge
    rules = _merge_owasp_with_languages(all_meta, lang_specs)

    # Load constitution-project (宪法文件2)：优先项目目录 .sec-scan-code/（避免
    # 跨项目污染，--analyze 现写项目目录），回退 skill rules/ 旧位置。
    proj_const: Optional[Path] = None
    if project_path:
        _cand = Path(project_path) / ".sec-scan-code" / "constitution-project.yaml"
        if _cand.is_file():
            proj_const = _cand
    if proj_const is None:
        _cand = RULES_DIR / "constitution-project.yaml"
        if _cand.is_file():
            proj_const = _cand
    if proj_const is not None:
        data = load_yaml(proj_const)
        if data and "rules" in data:
            for entry in data["rules"]:
                rules.append(_parse_rule_legacy(entry))

    # Filter by priority
    if priority:
        rules = [r for r in rules if r.priority == priority]

    return rules


def _parse_rule_legacy(data: dict) -> Rule:
    """Parse a rule dict with embedded languages (for constitution-project)."""
    r = Rule(
        rule_id=data["rule_id"],
        name=data["name"],
        severity=data["severity"],
        priority=data.get("priority", "supplementary"),
        description=data.get("description", ""),
        owasp=data.get("owasp"),
        categories=data.get("categories", []),
    )
    for lang, lang_data in data.get("languages", {}).items():
        lr = LanguageRule()
        lr.file_extensions = lang_data.get("file_extensions", [])
        lang_safe = lang_data.get("safe_patterns", [])
        for category, patterns in lang_data.get("patterns", {}).items():
            parsed = []
            for p in patterns:
                sp = p.get("safe_patterns", [])
                if not sp:
                    sp = list(lang_safe)
                parsed.append(Pattern(
                    p["pattern"],
                    p["description"],
                    p.get("confidence", 7),
                    sp,
                ))
            lr.patterns[category] = parsed
        r.languages[lang] = lr
    return r


def load_taint_sources(languages: Optional[list[str]] = None) -> dict[str, list[str]]:
    """加载各语言的全局污点源模式（taint_sources），用于候选风险打分。

    Returns:
        dict[str, list[str]]: language → 污点源正则模式列表。
    """
    out: dict[str, list[str]] = {}
    langs = languages or ["python", "javascript", "java", "go", "c"]
    for lang in langs:
        spec = load_language_spec(lang)
        if spec and spec.taint_sources:
            out[lang] = spec.taint_sources
    return out


def load_constitution_owasp_brief() -> list[ConstitutionBrief]:
    """Load the OWASP constitution brief for context injection."""
    path = RULES_DIR / "constitution-owasp.yaml"
    if not path.is_file():
        return []
    data = load_yaml(path)
    if not data or "rules" not in data:
        return []
    return [
        ConstitutionBrief(
            rule_id=entry["rule_id"],
            severity=entry["severity"],
            brief=entry["brief"],
        )
        for entry in data["rules"]
    ]


def load_constitution_project_brief() -> list[ConstitutionBrief]:
    """Load the project-specific constitution brief for context injection."""
    path = RULES_DIR / "constitution-project.yaml"
    if not path.is_file():
        return []
    data = load_yaml(path)
    if not data or "rules" not in data:
        return []
    return [
        ConstitutionBrief(
            rule_id=entry["rule_id"],
            severity=entry["severity"],
            brief=entry.get("brief", entry.get("name", "")),
        )
        for entry in data["rules"]
    ]


def format_brief_for_injection(briefs: list[ConstitutionBrief], header: str) -> str:
    """Format constitution briefs as compact text for context injection."""
    if not briefs:
        return ""
    lines = [f"## {header}"]
    for b in briefs:
        lines.append(f"- {b.rule_id} [{b.severity}] {b.brief}")
    return "\n".join(lines)


# 与 bash detect-languages.sh 的排除目录保持一致：跳过依赖/生成/缓存目录，
# 避免 node_modules 里的 .js 或 .venv 里的 .py 被误判为项目语言。
_SKIPPED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", ".tox", ".mypy_cache", ".pytest_cache", ".sec-scan-code",
}


def _is_skipped_path(rel_parts) -> bool:
    """判断路径（相对 project root 的 parts）是否命中需要跳过的目录。

    命中条件：任一路径段以 "." 开头（点目录），或属于 _SKIPPED_DIRS。
    """
    return any(p.startswith(".") or p in _SKIPPED_DIRS for p in rel_parts)


def detect_project_languages(project_path: str) -> list[str]:
    """Detect programming languages used in a project by checking indicator files."""
    root = Path(project_path)
    lang_indicators: dict[str, list[str]] = {
        "python": ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile", "poetry.lock"],
        "javascript": ["package.json", "yarn.lock", "pnpm-lock.yaml", ".nvmrc"],
        "go": ["go.mod", "go.sum"],
        "java": ["pom.xml", "build.gradle", "build.gradle.kts"],
        "c": ["Makefile", "CMakeLists.txt", "configure.ac"],
    }
    detected = []
    for lang, indicators in lang_indicators.items():
        for ind in indicators:
            # Recursive lookup so nested-module indicators (e.g. a frontend
            # package.json under a subdirectory) are found. Skip dot-dirs and
            # dependency dirs (node_modules/.venv) to avoid matching things like
            # node_modules/pkg/package.json or .venv/package.json.
            if any(
                p.name == ind
                and not _is_skipped_path(p.relative_to(root).parts[:-1])
                for p in root.rglob(ind)
            ):
                detected.append(lang)
                break

    # Phase 2: scan file extensions to supplement / backfill Phase 1.
    # Always runs (no short-circuit) so multi-language projects whose Phase 1
    # only matched one indicator (e.g. java via pom.xml at root) still pick up
    # other languages present via their source extensions (e.g. .js/.vue in a
    # frontend subdir).
    ext_lang: dict[str, str] = {
        ".py": "python", ".pyw": "python",
        ".js": "javascript", ".ts": "javascript", ".jsx": "javascript",
        ".tsx": "javascript", ".mjs": "javascript", ".vue": "javascript",
        ".go": "go",
        ".java": "java", ".kt": "java", ".groovy": "java",
        ".jsp": "java", ".jspx": "java",
        ".c": "c", ".h": "c", ".cpp": "c", ".hpp": "c",
        ".cc": "c", ".cxx": "c", ".hxx": "c",
    }
    seen: set[str] = set(detected)
    for f in root.rglob("*"):
        if _is_skipped_path(f.relative_to(root).parts):
            continue
        if f.is_file() and f.suffix in ext_lang:
            lang = ext_lang[f.suffix]
            if lang not in seen:
                detected.append(lang)
                seen.add(lang)

    return detected
