#!/usr/bin/env bash
# 安装包冒烟（设计 §6）——真 setup.exe 全链真机验证：
#   S1 静默首装 / S2 覆盖升级（中断窗口 ≤20s 硬断言）/ S3 卸载保留数据 / S4 卸载清除数据
#
# 环境事实（沿 tray-smoke.sh 教训 + 安装器特有；setup/unins000 三坑 2026-08-25 判别实验实测）：
#   - 安装器固定路径真实落盘（%LOCALAPPDATA%\Programs\devzero）——不可 mktemp 隔离，
#     前置检查「已装即中止」保干净前提；cleanup 兜底静默卸载清场（红绿循环反复跑的前提）
#   - WORKBENCH_HOME 隔离服务/托盘 profile（安装器卸载数据删除尊重同一变量——S3/S4 安全性依赖）
#   - 计划任务 DevZeroDaemon 必须全程 DISABLE：daemon 经任务计划触发无环境继承，
#     会用真实 ~/.devzero 抢 19980 端口干扰断言
#   - Run 键真实写注册表（托盘 applyAutostart）——备份恢复原值，不留痕
#   - WORKBENCH_NO_BROWSER=1 抑制开真浏览器；Inno /LOG 留安装日志供断言
#   - setup/unins000 调用三坑（实测）：
#     ① MSYS 把 /VERYSILENT 等单斜杠参数当 POSIX 路径转换（Task 1 的 iscc /D 同源坑，
#        判别实验：cmd //c echo /VERYSILENT → "C:/Program Files/Git/VERYSILENT"）——
#        本次调用用 MSYS2_ARG_CONV_EXCL="*" 关掉参数转换，参数原样直达 exe
#     ② /LOG= 必须传 Windows 路径（cygpath -w）——$WORKBENCH_HOME 是 MSYS /tmp 形态，
#        setup.exe 是 Windows 程序解析不了
#     ③ unins000.exe 自复制到临时目录异步执行——返回 ≠ 完成（实测返回时目录仍在删），
#        cleanup 必须轮询目录消失
#   - bash 会阻塞等 setup.exe（GUI 子系统 exe）退出——实测首装 18s（lzma2 解压三制品）
#   - Inno 覆盖安装保留源文件时间戳（2026-08-25 判别实验：日志 "Time stamp of our file" 与
#     "Time stamp of existing file" 相同，落盘 mtime 不变）——S2「文件已更新」断言用文件 ID
#     （stat %i：Inno 经临时文件+重命名落盘，每次覆盖必变）而非 mtime；另实测服务恢复可晚于
#     setup 退出 ~2s（托盘→服务启动链）——S2 窗口测量不能绑 setup 存活期
# 冒烟输出存 scripts/installer-smoke.log（gitignore，不提交）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" # workbench/workbench-installer/scripts
cd "$SCRIPT_DIR/../../workbench-service"    # 借 service 目录锚定 dist 与 package.json（版本号来源）

SMOKE_LOG="$SCRIPT_DIR/installer-smoke.log"
: > "$SMOKE_LOG"
exec > >(tee -a "$SMOKE_LOG") 2>&1

BASE="http://127.0.0.1:19980"
RUN_KEY='HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
RUN_KEY_NAME="DevZeroTray" # 镜像 brand.RunKeyName（Go 侧唯一来源，脚本手写同步）
TASK_NAME="DevZeroDaemon"  # 计划任务名（brand 重命名 Task R 定稿）
INSTALL_DIR="$(cygpath -u "$LOCALAPPDATA")/Programs/devzero"
UNINSTALLER="$INSTALL_DIR/unins000.exe"
SETUP_VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
SETUP_EXE="$PWD/dist/devzero-setup-$SETUP_VERSION-x64.exe"
START_MENU_LNK="$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/DevZero.lnk"

export WORKBENCH_HOME="$(mktemp -d)"
export WORKBENCH_NO_BROWSER=1
# S4 的 Inno 日志隔离目录（不能放 $WORKBENCH_HOME）：/DELETEDATA=1 会删数据目录——日志放
# 里面会随数据一起消失（失败无诊断）；卸载日志更糟：unins000 的日志句柄开着，DelTree 删
# 到该文件时被句柄挡住 → 数据目录删不净 → S4 假红
S4_LOG_DIR="$(mktemp -d)"

# ---- 前置防护 ----
[ -f "$SETUP_EXE" ] || { echo "ABORT: $SETUP_EXE 不存在——先跑 build-installer.sh"; exit 1; }
if [ -d "$INSTALL_DIR" ]; then
  echo "ABORT: $INSTALL_DIR 已存在（已安装？）——先卸载再跑冒烟"; exit 1
fi
for proc in devzero.exe devzero-daemon.exe devzero-tray.exe; do
  if tasklist //FI "IMAGENAME eq $proc" 2>/dev/null | grep -i "$proc" >/dev/null; then
    echo "ABORT: 已有 $proc 在跑——请先关闭（冒烟会真实装/卸载同名安装，taskkill //IM 按进程名全局匹配会误杀）"
    exit 1
  fi
done
# Run 键原值备份（冒烟会真实写入 HKCU——托盘 applyAutostart 必须验真注册；清理时恢复原状，不留痕）
PREV_RUN_VALUE="$(reg query "$RUN_KEY" //v "$RUN_KEY_NAME" 2>/dev/null | sed -n 's/.*REG_SZ[[:space:]]*//p' || true)"

cleanup() {
  # 1) 杀进程（解文件锁——静默卸载要删这些 exe；红阶段无进程，|| true 幂等）
  taskkill //F //IM devzero-tray.exe >/dev/null 2>&1 || true
  taskkill //F //IM devzero.exe >/dev/null 2>&1 || true
  taskkill //F //IM devzero-daemon.exe >/dev/null 2>&1 || true
  # 2) 删计划任务（红阶段任务不存在，|| true 幂等无害）
  schtasks //Change //TN "$TASK_NAME" //DISABLE >/dev/null 2>&1 || true
  schtasks //Delete //TN "$TASK_NAME" //F >/dev/null 2>&1 || true
  # 3) 兜底静默卸载（执行期修订：红绿循环要反复跑冒烟，INSTALL_DIR 必须清干净——
  #    前置检查「已装即 ABORT」下一轮才过）
  if [ -f "$UNINSTALLER" ]; then
    sleep 1 # taskkill //F 后进程退出与句柄释放有瞬时窗口
    MSYS2_ARG_CONV_EXCL="*" "$UNINSTALLER" /VERYSILENT /SUPPRESSMSGBOXES >/dev/null 2>&1 || true
    # unins000.exe 自复制到临时目录异步删（见头部坑③）：轮询目录消失，60s 预算
    local deadline=$((SECONDS + 60))
    while [ -d "$INSTALL_DIR" ] && [ "$SECONDS" -lt "$deadline" ]; do
      sleep 1
    done
  fi
  if [ -d "$INSTALL_DIR" ]; then
    # 不 rm -rf 兜底：目录残留但卸载注册表条目（Uninstall 键/计划任务）仍在的话，
    # rm -rf 会造出「目录没了、系统仍认为已装」的更糟状态；WARN + 下轮前置 ABORT
    # 是干净的失败模式——fail-safe，勿「顺手」加 rm -rf（Task 2 review Minor 1）
    echo "WARN: cleanup 静默卸载 60s 未清掉 $INSTALL_DIR——下轮冒烟前置检查会 ABORT，需人工排查"
  else
    echo "(cleanup: 安装已清场——机器无 devzero 安装残留)"
  fi
  # 4) 陈旧快捷方式是下轮 S1 断言的假 PASS 源——卸载器正常会删，此处兜底（幂等）
  rm -f "$START_MENU_LNK" || true
  # 5) Run 键恢复原值（备份为空则删除本键值——不留痕）
  if [ -n "$PREV_RUN_VALUE" ]; then
    reg add "$RUN_KEY" //v "$RUN_KEY_NAME" //t REG_SZ //d "$PREV_RUN_VALUE" //f >/dev/null 2>&1 || true
  else
    reg delete "$RUN_KEY" //v "$RUN_KEY_NAME" //f >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKBENCH_HOME"
  rm -rf "$S4_LOG_DIR"
}
trap cleanup EXIT INT TERM # INT/TERM 加固：HKCU/计划任务真实副作用下 Ctrl+C 也走清场；
                          # cleanup 全程幂等（|| true），与 EXIT 重复触发无害

wait_healthz() { # 最多 Ns（默认 30）
  local deadline=$((SECONDS + ${1:-30}))
  until curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then return 1; fi
    sleep 0.5
  done
}

# ---- S1: 静默首装 ----
echo "=== S1: setup /VERYSILENT 静默首装 ==="
S1_LOG="$WORKBENCH_HOME/innosetup-s1.log"
S1_LOG_WIN="$(cygpath -w "$S1_LOG")" # /LOG= 须 Windows 路径（坑②）
if ! MSYS2_ARG_CONV_EXCL="*" "$SETUP_EXE" /VERYSILENT /SUPPRESSMSGBOXES "/LOG=$S1_LOG_WIN"; then
  echo "FAIL: S1 setup.exe 退出码非 0（安装未完成——诊断：$S1_LOG）"
  exit 1
fi
[ -f "$INSTALL_DIR/devzero.exe" ] && [ -f "$INSTALL_DIR/devzero-daemon.exe" ] && [ -f "$INSTALL_DIR/devzero-tray.exe" ] \
  || { echo "FAIL: S1 三制品未落盘（$INSTALL_DIR）"; exit 1; }
schtasks //Query //TN "$TASK_NAME" >/dev/null 2>&1 || {
  echo "FAIL: S1 计划任务 $TASK_NAME 未注册（iss 尚无 [Code] 系统集成语义——TDD 红预期点）"
  exit 1
}
[ -f "$START_MENU_LNK" ] || { echo "FAIL: S1 开始菜单快捷方式缺失（$START_MENU_LNK）"; exit 1; }
wait_healthz || { echo "FAIL: S1 服务 30s 内未就绪（ssPostInstall 未恢复？）"; exit 1; }
# 版本护栏（final review Major 2）：healthz 上报版本必须 == setup 文件名版本——版本线半改
# 事故在本分支已翻车两次（数值块漏改/syso 未入库），五处源头手工同改是发布常态，此断言闭环
S1_VER="$(curl -sf --max-time 2 "$BASE/healthz" | grep -o '"version":"[^"]*"' | head -1 | sed 's/"version":"\([^"]*\)"/\1/')" || true
[ "$S1_VER" = "$SETUP_VERSION" ] || {
  echo "FAIL: S1 版本护栏——healthz 上报 $S1_VER != setup 版本 $SETUP_VERSION（版本线半改？查六源头：service/web package.json、brand.ts version、trayVersion、versioninfo.json 双维度、build.sh 兜底、resource.syso 是否随附提交）"
  exit 1
}
tasklist //FI "IMAGENAME eq devzero-tray.exe" 2>/dev/null | grep -i devzero-tray >/dev/null \
  || { echo "FAIL: S1 托盘进程未起"; exit 1; }
[ -f "$S1_LOG" ] || { echo "FAIL: S1 Inno 日志未生成（/LOG 参数未生效？）"; exit 1; }
if grep -i "error\|exception" "$S1_LOG" >/dev/null; then
  echo "FAIL: S1 Inno 日志含 error/exception："
  grep -in "error\|exception" "$S1_LOG"
  exit 1
fi
# 任务存在即禁用：daemon 经任务计划触发无环境继承，会用真实 ~/.devzero 抢 19980 端口，干扰后续场景
if ! schtasks //Change //TN "$TASK_NAME" //DISABLE >/dev/null; then
  echo "FAIL: S1 计划任务 $TASK_NAME 禁用失败（后续场景会被无环境继承的 daemon 抢 19980 端口）"
  exit 1
fi
echo "PASS S1 静默首装（三制品 + 任务 + 快捷方式 + healthz + 托盘 + 日志无 error）"

# ---- S2: 覆盖升级（S1 末态 = 服务+托盘在跑 + 任务已禁用 = 「旧版在跑」前提天然成立） ----
echo ""
echo "=== S2: 覆盖升级——旧版在跑时再执行 setup，中断窗口 ≤20s ==="
S2_LOG="$WORKBENCH_HOME/innosetup-s2.log"
S2_LOG_WIN="$(cygpath -w "$S2_LOG")" # /LOG= 须 Windows 路径（坑②，同 S1）
s2_fail() { # S2 专用 FAIL：cleanup 会删 $WORKBENCH_HOME——Inno 日志先全文摘录到冒烟日志留痕（诊断耗时大头/文件锁）
  echo "FAIL: $1"
  if [ -f "$S2_LOG" ]; then
    echo "---- Inno 日志全文摘录（$S2_LOG，原文件即将随 cleanup 删除）----"
    cat "$S2_LOG"
  fi
  exit 1
}
# 前提校验 = 窗口测量 down 基线：S1 末态服务必须可达，否则首个不可达会被误记到 setup 之前
curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1 || { echo "FAIL: S2 前提破坏——S1 末态服务应可达"; exit 1; }
# 覆盖证据采样：Inno 保留源文件时间戳（见头部环境事实）→ mtime 断言不可用，采文件 ID（stat %i）
S2_INODE_BEFORE="$(stat -c %i "$INSTALL_DIR/devzero.exe" 2>/dev/null)" || { echo "FAIL: S2 前置——$INSTALL_DIR/devzero.exe stat 失败"; exit 1; }
S2_T0=$SECONDS
S2_DOWN_AT="" # 首个不可达时刻即锁定，不可达期间不覆盖——计划稿此处逐次覆盖，任意长窗口都会被测成 ≈1 个轮询间隔（假 PASS）
S2_UP_AT=""   # 恢复点 = down 后首个可达时刻。测量误差双向 ±1 个观测粒度（down 迟观测缩窗、up 迟观测扩窗），非单向保守；20s 线 vs 实测 11-18s 下误差 ≤1s 无实质影响（Task 4 review Minor 2 修正原「过估保守侧」不变式表述）
S2_RECOVERED=0
S2_DEADLINE_AT=$(( S2_T0 + 60 )) # 首装实测 ~14s、恢复链实测可晚于 setup 退出 ~2s；60s 只兜异常慢机
( MSYS2_ARG_CONV_EXCL="*" "$SETUP_EXE" /VERYSILENT /SUPPRESSMSGBOXES "/LOG=$S2_LOG_WIN" ) & # 坑①：后台调用尤其必坑——无 EXCL 则 /VERYSILENT 被 MSYS 转 POSIX 路径，setup 收不到静默参数弹向导，后台挂死
S2_SETUP_PID=$!
while [ "$SECONDS" -le "$S2_DEADLINE_AT" ]; do
  if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
    if [ -n "$S2_DOWN_AT" ] && [ "$S2_RECOVERED" -eq 0 ]; then
      S2_UP_AT=$SECONDS
      S2_RECOVERED=1
      break # 恢复点已捕获——窗口测量完成（setup 可能仍在收尾，退出码稍后 wait 收）
    fi
  elif [ -z "$S2_DOWN_AT" ]; then
    S2_DOWN_AT=$SECONDS
  fi
  kill -0 "$S2_SETUP_PID" 2>/dev/null || break # setup 已退出：中断只可能源于它——恢复续等交 wait_healthz
  sleep 0.5
done
# setup 已退出（或 deadline 截断）仍不可达：wait_healthz 续等，恢复点补记（bash SECONDS 为整数秒，测量粒度 ~1s）
if [ -n "$S2_DOWN_AT" ] && [ "$S2_RECOVERED" -eq 0 ]; then
  wait_healthz 30 || s2_fail "S2 覆盖后服务 30s 未恢复（中断起点 t+$((S2_DOWN_AT - S2_T0))s）"
  S2_UP_AT=$SECONDS
  S2_RECOVERED=1
fi
wait "$S2_SETUP_PID" || s2_fail "S2 setup 退出码非 0（文件锁失败？）"
[ -f "$S2_LOG" ] || { echo "FAIL: S2 Inno 日志未生成（/LOG 参数未生效？——坑①/坑② 检查）"; exit 1; } # 同 S1：验 /LOG 管道（后台+EXCL 形态下尤其易碎）
if grep -i "error\|exception" "$S2_LOG" >/dev/null; then # 同 S1 断言形态（内容检查），FAIL 走 s2_fail 顺带全文摘录
  s2_fail "S2 Inno 日志含 error/exception"
fi
[ -n "$S2_DOWN_AT" ] || echo "（注：轮询粒度内未见中断——窗口极短，视为通过）"
if [ -n "$S2_DOWN_AT" ]; then
  S2_WINDOW=$(( S2_UP_AT - S2_DOWN_AT ))
  [ "$S2_WINDOW" -le 20 ] || s2_fail "S2 中断窗口 ${S2_WINDOW}s > 20s（用户裁决 C 2026-08-25：lzma2 降档+线放宽双保险）——down t+$((S2_DOWN_AT - S2_T0))s / up t+$((S2_UP_AT - S2_T0))s；耗时大头看日志时间戳（判别实验：解压落盘 ~7s 为大头，ssPostInstall 任务注册仅 ~0.4s——ewWaitUntilTerminated 嫌疑在暖缓存下不成立）"
fi
[ "$(stat -c %i "$INSTALL_DIR/devzero.exe")" != "$S2_INODE_BEFORE" ] || s2_fail "S2 落盘文件未更新（devzero.exe 文件 ID 未变——覆盖空转？）"
tasklist //FI "IMAGENAME eq devzero-tray.exe" 2>/dev/null | grep -i devzero-tray >/dev/null || s2_fail "S2 覆盖后托盘未恢复"
# S2 尾禁用任务（坑③）：ssPostInstall 的 Register-ScheduledTask -Force 重建后任务回到启用态且
# +30s 首触发——daemon 无环境继承会用真实 ~/.devzero 抢 19980 端口干扰 S3/S4；沿 S1 尾模式再禁用
if ! schtasks //Change //TN "$TASK_NAME" //DISABLE >/dev/null; then
  s2_fail "S2 尾计划任务 $TASK_NAME 禁用失败（后续场景会被无环境继承的 daemon 抢 19980 端口）" # 走 s2_fail：iss 任务注册失败的 Log 留痕行恰在此日志里（Task 4 review Minor 1——丢日志与 s2_fail 设计理由自相矛盾）
fi
S2_WINDOW_TXT=""
[ -n "$S2_DOWN_AT" ] && S2_WINDOW_TXT="实测 $((S2_UP_AT - S2_DOWN_AT))s / "
echo "PASS S2 覆盖升级（中断窗口 ${S2_WINDOW_TXT}≤20s + 文件已更新 + 服务托盘已恢复）"

# ---- S3: 卸载·保留数据（默认，裁决 2） ----
echo ""
echo "=== S3: 静默卸载——数据默认保留 ==="
printf 'keep-marker\n' > "$WORKBENCH_HOME/keep-marker" # 标记文件（计划稿 mkdir 建目录却用 -f 断言——永假，改为建文件）
S3_LOG="$WORKBENCH_HOME/innosetup-s3.log"
S3_LOG_WIN="$(cygpath -w "$S3_LOG")" # /LOG= 须 Windows 路径（坑②，同 S1/S2）
s34_fail() { # S3/S4 专用 FAIL：Inno 日志先全文摘录（沿 s2_fail 设计——cleanup 会删 $WORKBENCH_HOME
  # 与 $S4_LOG_DIR，FAIL 后现场即失）；日志路径可选，由调用方给最相关那份
  echo "FAIL: $1"
  if [ -n "${2:-}" ] && [ -f "$2" ]; then
    echo "---- Inno 日志全文摘录（$2，原文件即将随 cleanup 删除）----"
    cat "$2"
  fi
  exit 1
}
# 坑①：unins000 的 /VERYSILENT /LOG= 与 setup 同坑——EXCL 全参数原样直达
if ! MSYS2_ARG_CONV_EXCL="*" "$UNINSTALLER" /VERYSILENT "/LOG=$S3_LOG_WIN"; then
  s34_fail "S3 unins000 退出码非 0" "$S3_LOG"
fi
# 杀壳竞态兜底（预警 4）：iss usUninstall 前置清理自己会杀壳，此处立即补刀——赶在 unins000
# 文件删除阶段前释放 devzero-tray.exe 锁；服务（devzero.exe）故意不杀：S3 的语义就是
# 「服务在跑时卸载」，优雅停服必须由卸载器前置清理完成
taskkill //F //IM devzero-tray.exe >/dev/null 2>&1 || true
# 坑③：unins000 自复制到临时目录异步执行——返回 ≠ 完成。「任务/Run 键/安装目录/快捷方式」
# 四断言物全部消失才算卸载完成，轮询 30s（计划稿 sleep 2 慢机必假红）
s3_done=0
s3_deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$s3_deadline" ]; do
  if ! schtasks //Query //TN "$TASK_NAME" >/dev/null 2>&1 \
     && ! reg query "$RUN_KEY" //v "$RUN_KEY_NAME" >/dev/null 2>&1 \
     && [ ! -d "$INSTALL_DIR" ] \
     && [ ! -f "$START_MENU_LNK" ]; then
    s3_done=1
    break
  fi
  sleep 1
done
# 超时归因链（顺序即报错优先级）：系统侧先行（任务/Run 键——[Code] 卸载语义的直接证据），
# 文件侧殿后
if [ "$s3_done" -ne 1 ]; then
  schtasks //Query //TN "$TASK_NAME" >/dev/null 2>&1 && s34_fail "S3 计划任务 $TASK_NAME 未删（卸载语义缺失/前置清理未跑）" "$S3_LOG"
  reg query "$RUN_KEY" //v "$RUN_KEY_NAME" >/dev/null 2>&1 && s34_fail "S3 Run 键 $RUN_KEY_NAME 未删" "$S3_LOG"
  [ -d "$INSTALL_DIR" ] && s34_fail "S3 安装目录 30s 内未删（unins000 异步未完成或文件锁未释放）" "$S3_LOG"
  [ -f "$START_MENU_LNK" ] && s34_fail "S3 快捷方式 DevZero.lnk 未删" "$S3_LOG"
fi
[ -d "$WORKBENCH_HOME" ] || s34_fail "S3 数据目录被误删（应默认保留）" "$S3_LOG"
[ -f "$WORKBENCH_HOME/keep-marker" ] || s34_fail "S3 数据目录内容被误删（keep-marker 丢失）" "$S3_LOG"
# 日志内容断言（同 S1/S2 形态；Task 5 review Minor 2 补强）：error/exception 零容忍；
# 定向 grep「优雅停服」——该词只出现在 iss 前置清理的失败留痕行（未执行/退出码非 0），
# S3 场景服务在跑（S2 末态），stop 应成功零留痕；命中 = 停服链路异常靠 taskkill 兜底救场
if grep -i "error\|exception" "$S3_LOG" >/dev/null || grep "优雅停服" "$S3_LOG" >/dev/null; then
  s34_fail "S3 Inno 日志含 error/exception 或优雅停服失败留痕" "$S3_LOG"
fi
echo "PASS S3 静默卸载默认保留数据（安装目录/计划任务/Run 键/快捷方式已清，数据完整）"

# ---- S4: 卸载·清除数据（/DELETEDATA=1 显式通道，裁决 2） ----
echo ""
echo "=== S4: /DELETEDATA=1 卸载清除数据 ==="
S4_INSTALL_LOG="$S4_LOG_DIR/innosetup-s4-install.log"
S4_INSTALL_LOG_WIN="$(cygpath -w "$S4_INSTALL_LOG")" # 坑②：/LOG= 须 Windows 路径
# 重装走完整安装语义（ssPostInstall 重建任务+起托盘）；坑①：EXCL 沿 S1/S2 模式
if ! MSYS2_ARG_CONV_EXCL="*" "$SETUP_EXE" /VERYSILENT /SUPPRESSMSGBOXES "/LOG=$S4_INSTALL_LOG_WIN"; then
  s34_fail "S4 重装 setup 退出码非 0（文件锁？）" "$S4_INSTALL_LOG"
fi
# 任务重建后立即禁用（预警 5）：先于 wait_healthz——首触发 +30s，若等 healthz 再禁，起服
# 慢时可能已被无环境继承的 daemon 抢 19980 端口（沿 S1/S2 尾禁用模式，时机更早一档）
schtasks //Change //TN "$TASK_NAME" //DISABLE >/dev/null 2>&1 || true
# 预警 3：服务恢复链可晚于 setup 退出 ~2s（头部环境事实）——wait_healthz 30 覆盖；
# || true：S4 测的是 DELETEDATA 语义，安装健康度 S1/S2 已验，不为它红
wait_healthz 30 || true
# 三进程全停（计划语义）：DelTree 前不能有进程往 $WORKBENCH_HOME 写文件（服务日志/句柄
# 会让「目录已删」断言假红）——S3 已验卸载器自停能力，此处直接杀干净
taskkill //F //IM devzero-tray.exe >/dev/null 2>&1 || true
taskkill //F //IM devzero.exe >/dev/null 2>&1 || true
taskkill //F //IM devzero-daemon.exe >/dev/null 2>&1 || true
sleep 1 # taskkill //F 后句柄释放有瞬时窗口（沿 cleanup 模式）
S4_UNINST_LOG="$S4_LOG_DIR/innosetup-s4-uninst.log"
S4_UNINST_LOG_WIN="$(cygpath -w "$S4_UNINST_LOG")" # 坑②
# 坑①：/DELETEDATA=1 与 /VERYSILENT 同样被 MSYS 当 POSIX 路径转换——EXCL 全参数原样直达。
# /DELETEDATA=1 放末位（Task 5 review Minor 1）：ParamStr 差一边界正是计划稿 0..ParamCount-1
# 循环漏扫的位置（参数恰在末位时静默失效）——放末位让断言覆盖该修复针对的场景
if ! MSYS2_ARG_CONV_EXCL="*" "$UNINSTALLER" /VERYSILENT "/LOG=$S4_UNINST_LOG_WIN" /DELETEDATA=1; then
  s34_fail "S4 unins000 退出码非 0" "$S4_UNINST_LOG"
fi
# 坑③：unins000 异步——轮询「安装目录+数据目录」都消失（30s 预算）；断言分开报，失败模式
# 可区分（卸载没完成 vs /DELETEDATA=1 没生效）
s4_deadline=$((SECONDS + 30))
while [ "$SECONDS" -lt "$s4_deadline" ]; do
  if [ ! -d "$INSTALL_DIR" ] && [ ! -d "$WORKBENCH_HOME" ]; then
    break
  fi
  sleep 1
done
[ ! -d "$INSTALL_DIR" ] || s34_fail "S4 安装目录 30s 内未删（unins000 异步未完成）" "$S4_UNINST_LOG"
[ ! -d "$WORKBENCH_HOME" ] || s34_fail "S4 数据目录未删（/DELETEDATA=1 未生效？）" "$S4_UNINST_LOG"
# 日志内容断言（同 S1/S2/S3 形态；Task 5 review Minor 2）：两份日志 error/exception 零容忍
if grep -i "error\|exception" "$S4_UNINST_LOG" >/dev/null || grep -i "error\|exception" "$S4_INSTALL_LOG" >/dev/null; then
  s34_fail "S4 Inno 日志含 error/exception" "$S4_UNINST_LOG"
fi
echo "PASS S4 /DELETEDATA=1 卸载清除数据（安装目录+数据目录均删）"
