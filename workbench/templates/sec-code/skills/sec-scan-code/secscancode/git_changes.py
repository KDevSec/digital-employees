"""Git change detection for incremental security scans.

Python port of `bin/detect-changes.sh`——用单一跨平台实现取代 bash + PowerShell
双版本。仅依赖标准库 + `git` 命令，不依赖 secscancode 其余模块（可独立使用）。

CLI 契约（与原 shell 脚本一致）：
  detect_changes(project_path=".", tracked_only=False) -> list[str]
    - 返回变更的源文件相对路径（有序去重）
    - 非 git 仓库或 git 不可用时抛 GitError
"""

import os
import subprocess

# 源码扩展名（与 rules/languages/*.yaml 对齐，并补充常见配置/脚本类型）
SOURCE_EXTENSIONS = {
    "py", "pyw", "js", "ts", "jsx", "tsx", "mjs", "vue",
    "go", "java", "kt", "groovy", "jsp", "jspx",
    "c", "h", "cpp", "hpp", "cc", "cxx", "hxx",
    "sql", "sh", "bash", "json", "yaml", "yml", "xml",
    "css", "scss", "less", "rb", "php", "rs", "swift",
}

# 无扩展名但视为源文件的 basename（Dockerfile、Makefile 等）
_EXTENSIONLESS_SOURCE_NAMES = {
    "dockerfile", "makefile", "jenkinsfile", "vagrantfile", "rakefile", "gemfile",
}


class GitError(Exception):
    """项目路径不是可用 git 仓库，或 git 命令不可用。"""


def _git(project_path: str, *args: str) -> bytes:
    """运行 git，成功返回 stdout 字节；失败抛 GitError。"""
    result = subprocess.run(
        ["git", "-C", project_path, *args],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise GitError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def _git_or_empty(project_path: str, *args: str) -> bytes:
    """运行 git，失败时返回空字节（对应 shell 的 `|| true`）。"""
    try:
        return _git(project_path, *args)
    except GitError:
        return b""


def _is_source_file(filepath: str) -> bool:
    """判断是否源文件：有扩展名看扩展名，无扩展名看 basename。"""
    lower = filepath.lower()
    if "." in lower:
        return lower.rsplit(".", 1)[-1] in SOURCE_EXTENSIONS
    return os.path.basename(lower) in _EXTENSIONLESS_SOURCE_NAMES


def _add_valid(changed: list[str], filepath: str, project_path: str) -> None:
    """把通过过滤的路径加入列表：存在磁盘、源文件、未重复。"""
    if not filepath:
        return
    # 跳过已删除文件（磁盘上已不存在）
    if not os.path.isfile(os.path.join(project_path, filepath)):
        return
    if not _is_source_file(filepath):
        return
    if filepath in changed:
        return
    changed.append(filepath)


def detect_changes(project_path: str = ".", tracked_only: bool = False) -> list[str]:
    """检测 git 工作区中变更的源文件。

    Args:
        project_path: 项目根目录。
        tracked_only: 仅扫描已跟踪文件的改动，排除未跟踪（新增）文件。

    Returns:
        list[str]: 变更源文件的相对路径（收集顺序去重）。

    Raises:
        GitError: 非 git 仓库或 git 不可用。
    """
    project_path = os.path.abspath(project_path)

    # 校验 git 仓库
    _git(project_path, "rev-parse", "--is-inside-work-tree")
    _git(project_path, "status", "--porcelain")

    changed: list[str] = []

    def _collect(*args: str) -> None:
        """把 git -z 输出的 NUL 分隔路径逐条加入（非 ASCII 文件名安全）。"""
        out = _git_or_empty(project_path, *args)
        for raw in out.split(b"\0"):
            if raw:
                _add_valid(changed, raw.decode("utf-8", errors="replace"), project_path)

    # 1. 未暂存改动（已跟踪文件的修改）
    _collect("diff", "-z", "--name-only", "--no-renames")
    # 2. 已暂存改动（索引中的增/改/删）
    _collect("diff", "-z", "--cached", "--name-only", "--no-renames")
    # 3. 重命名文件——`--no-renames` 下源与目标各出一份
    _collect("diff", "-z", "--name-only", "--diff-filter=R", "--no-renames")
    _collect("diff", "-z", "--cached", "--name-only", "--diff-filter=R", "--no-renames")
    # 4. 合并冲突文件（unmerged）
    _collect("diff", "-z", "--name-only", "--diff-filter=U")

    # 5. 已提交但未推送到上游
    tracking = _git_or_empty(project_path, "rev-parse", "--abbrev-ref", "@{upstream}")
    tracking = tracking.decode("utf-8", errors="replace").strip()
    if not tracking:
        # 未设上游——尝试常见默认分支
        for candidate in ("origin/main", "origin/master", "origin/develop"):
            if _git_or_empty(project_path, "rev-parse", "--verify", candidate):
                tracking = candidate
                break
    if tracking:
        _collect("diff", "-z", "--name-only", tracking, "HEAD")

    # 6. 未跟踪（新增）文件——默认包含，--tracked-only 排除
    if not tracked_only:
        _collect("ls-files", "-z", "--others", "--exclude-standard")

    return changed
