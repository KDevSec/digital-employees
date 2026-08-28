: << 'PYBLOCK'
@echo off
REM Cross-platform Python hook wrapper for devzero.
REM Windows cmd.exe runs this batch block; Unix and Git-Bash run the single bash line below.
REM This file MUST stay CRLF: cmd.exe needs CRLF to parse a batch file correctly (LF-only
REM makes cmd ignore @echo off / REM / exit /b and run every line as a command). The cmd
REM block MUST also stay ASCII-only. Chinese notes live only in the bash line (cmd never
REM reaches it). PYTHONUTF8=1 keeps Chinese and emoji hook output safe on GBK consoles.
REM Deviation from agents-team 1.0: probe --version first then run script ONCE (1.0 re-ran
REM on any non-zero exit, incorrectly re-running hook scripts that exit 2 to block).
set "SCRIPT=%~1"
if "%SCRIPT%"=="" exit /b 0
set "HOOK_DIR=%~dp0"
set "PYTHONUTF8=1"
py -3 --version >nul 2>&1
if errorlevel 1 goto :try_python
py -3 "%HOOK_DIR%%SCRIPT%" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:try_python
python --version >nul 2>&1
if errorlevel 1 goto :try_python3
python "%HOOK_DIR%%SCRIPT%" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:try_python3
python3 --version >nul 2>&1
if errorlevel 1 exit /b 127
python3 "%HOOK_DIR%%SCRIPT%" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
PYBLOCK
# Unix/macOS/Git-Bash 分支：写成单行，行尾 '#' 吃掉 CRLF 的 \r（CRLF 文件下多行 bash 会因每行
# 尾随 \r 而把路径/关键字带上 \r 弄坏；单行 + 尾 '#' 注释掉那个 \r 最稳）。逐个 --version 探测，
# 跳过 Windows Store 的 python3 死垫片，命中即 exec（单次执行）。PYTHONUTF8=1 保 GBK 下不崩。
S="$(cd "$(dirname "$0")" && pwd)/$1"; shift; export PYTHONUTF8=1; for p in python3 python "py -3"; do $p --version >/dev/null 2>&1 && exec $p "$S" "$@"; done #
