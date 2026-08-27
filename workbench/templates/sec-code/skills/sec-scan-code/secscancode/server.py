"""MCP Server for sec-scan-code: exposes security scanning as MCP tools."""

import json
from pathlib import Path

from mcp.server import Server
from mcp.types import Tool, TextContent

from .rules_loader import (
    load_rules, detect_project_languages, load_taint_sources,
    load_constitution_owasp_brief, load_constitution_project_brief,
    format_brief_for_injection,
)
from .scanner import scan_incremental, scan_full, scan_quick
from .analyzer import update_constitution_project


app = Server("sec-scan-code")


@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="sec_scan_incremental",
            description="Incremental security scan: scan only specified files (default mode). "
                        "Provide file paths and project path.",
            inputSchema={
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of file paths to scan",
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Project root directory",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Project name for report",
                    },
                },
                "required": ["files", "project_path"],
            },
        ),
        Tool(
            name="sec_scan_full",
            description="Full security scan: scan all source files in the project.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_path": {
                        "type": "string",
                        "description": "Project root directory",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Project name for report",
                    },
                },
                "required": ["project_path"],
            },
        ),
        Tool(
            name="sec_scan_quick",
            description="Quick security scan: only constitutional rules on specified files.",
            inputSchema={
                "type": "object",
                "properties": {
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of file paths to scan",
                    },
                    "project_path": {
                        "type": "string",
                        "description": "Project root directory",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Project name for report",
                    },
                },
                "required": ["files", "project_path"],
            },
        ),
        Tool(
            name="sec_scan_analyze",
            description="Analyze historical scan results and update project constitution file.",
            inputSchema={
                "type": "object",
                "properties": {
                    "project_path": {
                        "type": "string",
                        "description": "Project root directory",
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Project name",
                    },
                    "top_n": {
                        "type": "integer",
                        "description": "Top N vulnerabilities to include in constitution (default: 5)",
                    },
                },
                "required": ["project_path"],
            },
        ),
        Tool(
            name="sec_scan_list_rules",
            description="List available security rules, optionally filtered by language.",
            inputSchema={
                "type": "object",
                "properties": {
                    "languages": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter rules by programming language",
                    },
                    "priority": {
                        "type": "string",
                        "enum": ["constitutional", "supplementary", "project-specific"],
                        "description": "Filter by priority level",
                    },
                },
            },
        ),
        Tool(
            name="sec_scan_get_constitution_brief",
            description="Get constitution brief for context injection (OWASP + project-specific).",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]


def _do_scan(scan_func, project_path: str, project_name: str,
             **scan_kwargs):
    """Shared scan pipeline: detect languages → load rules → scan.

    与 CLI 流程一致：MCP 只负责扫描并返回发现。生成含修复建议的最终报告需在
    补全 vuln_code/fix_code/exploit_scenario 后通过 CLI `report` 命令完成
    （合规门强制校验这三字段，引擎刚扫完时字段为空，立即生成必被拒）。
    """
    import inspect

    languages = detect_project_languages(project_path)
    rules = load_rules(languages=languages, project_path=project_path)
    taint_sources = load_taint_sources(languages)
    call = dict(rules=rules, project_name=project_name, languages=languages,
                taint_sources=taint_sources, workers=0)
    call.update(scan_kwargs)
    # scan_full 需要 project_path 参数（incremental/quick 不需要）
    if "project_path" in inspect.signature(scan_func).parameters \
            and "project_path" not in call:
        call["project_path"] = project_path
    return scan_func(**call)


@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "sec_scan_incremental":
        files = arguments["files"]
        project_path = arguments["project_path"]
        project_name = arguments.get("project_name", "")

        result = _do_scan(
            scan_incremental, project_path, project_name,
            files=files,
        )

        return [TextContent(
            type="text",
            text=json.dumps({
                "findings_count": len(result.findings),
                "totals": result.totals,
                "files_scanned": len(files),
                "lines_scanned": result.scan_scope.get("lines_scanned", 0),
                "note": "原始扫描完成；生成含修复建议的报告需补全发现字段后通过 CLI report 命令执行",
                "findings": [f.to_dict() for f in result.findings[:50]],
            }, indent=2, ensure_ascii=False),
        )]

    elif name == "sec_scan_full":
        project_path = arguments["project_path"]
        project_name = arguments.get("project_name", "")

        result = _do_scan(
            scan_full, project_path, project_name,
        )

        return [TextContent(
            type="text",
            text=json.dumps({
                "findings_count": len(result.findings),
                "totals": result.totals,
                "files_scanned": result.scan_scope.get("files_count", 0),
                "lines_scanned": result.scan_scope.get("lines_scanned", 0),
                "note": "原始扫描完成；生成含修复建议的报告需补全发现字段后通过 CLI report 命令执行",
                "findings": [f.to_dict() for f in result.findings[:50]],
            }, indent=2, ensure_ascii=False),
        )]

    elif name == "sec_scan_quick":
        files = arguments["files"]
        project_path = arguments["project_path"]
        project_name = arguments.get("project_name", "")

        result = _do_scan(
            scan_quick, project_path, project_name,
            files=files,
        )

        return [TextContent(
            type="text",
            text=json.dumps({
                "findings_count": len(result.findings),
                "totals": result.totals,
                "files_scanned": len(files),
                "lines_scanned": result.scan_scope.get("lines_scanned", 0),
                "note": "原始扫描完成；生成含修复建议的报告需补全发现字段后通过 CLI report 命令执行",
                "findings": [f.to_dict() for f in result.findings[:50]],
            }, indent=2, ensure_ascii=False),
        )]

    elif name == "sec_scan_analyze":
        project_path = arguments["project_path"]
        project_name = arguments.get("project_name", "")
        top_n = arguments.get("top_n", 5)

        result = update_constitution_project(project_path, project_name, top_n)
        return [TextContent(
            type="text",
            text=json.dumps(result, indent=2, ensure_ascii=False),
        )]

    elif name == "sec_scan_list_rules":
        languages = arguments.get("languages")
        priority = arguments.get("priority")
        rules = load_rules(languages=languages, priority=priority)

        rule_list = [{
            "rule_id": r.rule_id,
            "name": r.name,
            "severity": r.severity,
            "priority": r.priority,
            "categories": r.categories,
            "languages": list(r.languages.keys()),
        } for r in rules]

        return [TextContent(
            type="text",
            text=json.dumps(rule_list, indent=2, ensure_ascii=False),
        )]

    elif name == "sec_scan_get_constitution_brief":
        owasp = load_constitution_owasp_brief()
        project = load_constitution_project_brief()
        owasp_text = format_brief_for_injection(owasp, "宪法文件1 (OWASP 必加载)")
        project_text = format_brief_for_injection(project, "宪法文件2 (项目常见漏洞)")
        combined = "\n\n".join(filter(None, [owasp_text, project_text]))
        return [TextContent(type="text", text=combined)]

    else:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]


def main():
    """Entry point for the MCP server."""
    import asyncio
    from mcp.server.stdio import stdio_server

    async def run():
        async with stdio_server() as (read_stream, write_stream):
            await app.run(read_stream, write_stream, app.create_initialization_options())

    asyncio.run(run())


if __name__ == "__main__":
    main()
