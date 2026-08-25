#!/usr/bin/env bash
# 托盘配真服务冒烟（Task 16 / Wave 5）——真 GUI 托盘 exe + 真编译服务全链：
#   S0   构建双制品（TR-09 同目录）+ 体量 < 8MB + VersionInfo 四字段（TR-08）
#   S1   起服务 → healthz 就绪
#   S2   起托盘 → tray.log 30s 内 GREEN 探活 + menu.build 构建日志
#   S3   TR-06 自启：HKCU Run 键写入（值 = 托盘 exe 绝对路径）+ 哨兵文件出现
#   S4   TR-02/TR-05 四态流转：taskkill 服务 → YELLOW → RED（双条件）→
#        recover 恰好一次（黄态 skip 零 recover）→ GREEN 回归（总预算 90s）
#   S4b  TR-03 CLI 动作面：外部 stop → 托盘 GRAY（优雅停止识别）；外部 start →
#        GREEN 回归；activity / __health-wait 退出码（菜单执行层同款命令）
#   S5   TR-01/W-2：杀壳 → 服务同 pid 存活（healthz 200）
# 图标四色与菜单点击链路是人眼项（GUI 无法脚本化）——留用户醒后验收。
#
# 环境事实（沿 service smoke.sh + M0 spike 实测）：
#   - git-bash 下硬杀用 taskkill //F //IM（双斜杠防 MSYS 路径转换）
#   - WORKBENCH_NO_BROWSER=1 抑制开真浏览器（托盘/服务两侧都尊重该位）
#   - GUI exe 用 (exe &) 子壳后台形态（M0 手法）
#   - 注册表操作 reg query/add/delete //v（同双斜杠理由）
# 冒烟输出存 scripts/tray-smoke.log（gitignore，不提交）。
set -euo pipefail

cd "$(dirname "$0")/.." # workbench/workbench-tray

SMOKE_LOG="scripts/tray-smoke.log"
: > "$SMOKE_LOG"
exec > >(tee -a "$SMOKE_LOG") 2>&1

BASE="http://127.0.0.1:19980"
RUN_KEY='HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
RUN_KEY_NAME="WorkbenchTray" # 镜像 brand.RunKeyName（Go 侧唯一来源，脚本手写同步）
DIST="../workbench-service/dist"
SERVICE_EXE="$DIST/workbench.exe"
TRAY_EXE="$DIST/workbench-tray.exe"

export WORKBENCH_HOME="$(mktemp -d)"
export WORKBENCH_NO_BROWSER=1
TRAY_LOG="$WORKBENCH_HOME/logs/tray.log"

# 冒烟前已存在的同名进程 = 用户自己的实例，taskkill //IM 会误杀——直接中止让操作者处理
for proc in workbench.exe workbench-daemon.exe workbench-tray.exe; do
  if tasklist //FI "IMAGENAME eq $proc" 2>/dev/null | grep -i "$proc" >/dev/null; then
    echo "ABORT: 已有 $proc 在跑（taskkill //IM 按进程名全局匹配会误杀），请先关闭再跑冒烟"
    exit 1
  fi
done

# Run 键原值备份（冒烟会真实写入 HKCU——TR-06 必须验真注册；清理时恢复原状，不留痕）
PREV_RUN_VALUE="$(reg query "$RUN_KEY" //v "$RUN_KEY_NAME" 2>/dev/null | sed -n 's/.*REG_SZ[[:space:]]*//p' || true)"

cleanup() {
  taskkill //F //IM workbench-tray.exe >/dev/null 2>&1 || true
  taskkill //F //IM workbench.exe >/dev/null 2>&1 || true
  taskkill //F //IM workbench-daemon.exe >/dev/null 2>&1 || true
  if [ -n "$PREV_RUN_VALUE" ]; then
    reg add "$RUN_KEY" //v "$RUN_KEY_NAME" //t REG_SZ //d "$PREV_RUN_VALUE" //f >/dev/null 2>&1 || true
  else
    reg delete "$RUN_KEY" //v "$RUN_KEY_NAME" //f >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKBENCH_HOME"
}
trap cleanup EXIT INT TERM # INT/TERM 加固：HKCU 真实副作用下 Ctrl+C 也走恢复原值；
                            # cleanup 全程幂等（|| true），与 EXIT 重复触发无害

# ---------- 工具 ----------

wait_healthz() { # 最多 15s
  local deadline=$((SECONDS + 15))
  until curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL: healthz 在 15s 内未就绪"
      return 1
    fi
    sleep 0.5
  done
}

log_line_count() {
  if [ -f "$TRAY_LOG" ]; then wc -l < "$TRAY_LOG"; else echo 0; fi
}

# wait_log <pattern> <timeout_s> <desc> [baseline_line]：轮询 tray.log 出现 pattern。
# baseline 后的行才算（区分历史事件与新增事件，如 GREEN 回归 vs 首次 GREEN）。
# 注：管道 grep 不用 -q（早退 SIGPIPE 叠加 pipefail 会误判，见 service smoke.sh 教训）
wait_log() {
  local pattern="$1" timeout="$2" desc="$3" baseline="${4:-0}"
  local deadline=$((SECONDS + timeout))
  while :; do
    if [ -f "$TRAY_LOG" ] && tail -n +"$((baseline + 1))" "$TRAY_LOG" 2>/dev/null | grep "$pattern" >/dev/null; then
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL: $desc（${timeout}s 内 tray.log 未出现：$pattern）"
      echo "--- tray.log 尾部（诊断） ---"
      tail -n 20 "$TRAY_LOG" 2>/dev/null || echo "(tray.log 不存在)"
      echo "--- 托盘 stderr（诊断） ---"
      tail -n 10 "$WORKBENCH_HOME/tray-stderr.log" 2>/dev/null || true
      return 1
    fi
    sleep 0.5
  done
}

healthz_pid() {
  curl -sf --max-time 2 "$BASE/healthz" | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2
}

norm_path() { # 反斜杠归一 + 小写（注册表值与 cygpath 产物形态对齐比较）
  printf '%s' "$1" | tr '\\' '/' | tr '[:upper:]' '[:lower:]'
}

# ---------- S0: 构建 + 体量 + 版本资源 ----------

echo "=== S0: 构建双制品（TR-09 同目录）+ 体量 < 8MB（TR-08 验收线） ==="
bash scripts/build-tray.sh
[ -f "$SERVICE_EXE" ] || { echo "FAIL: $SERVICE_EXE 缺失"; exit 1; }
[ -f "$TRAY_EXE" ] || { echo "FAIL: $TRAY_EXE 缺失"; exit 1; }
SIZE="$(stat -c%s "$TRAY_EXE")"
[ "$SIZE" -lt 8388608 ] || { echo "FAIL: 托盘体量 $SIZE ≥ 8388608（8MB）"; exit 1; }
echo "PASS S0a 双制品同目录 + 体量 $SIZE bytes < 8MB（$((SIZE / 1024 / 1024))MB）"

echo "--- S0b: VersionInfo 四字段（TR-08，resource.syso 嵌入） ---"
TRAY_WIN="$(cygpath -w "$(cd "$DIST" && pwd)/workbench-tray.exe")"
VI_OUT="$(powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Item -LiteralPath '$TRAY_WIN').VersionInfo | fl CompanyName,ProductName,FileDescription,LegalCopyright,FileVersion | Out-String")"
echo "$VI_OUT"
for f in CompanyName ProductName FileDescription LegalCopyright FileVersion; do
  v="$(printf '%s' "$VI_OUT" | sed -n "s/^${f}[[:space:]]*:[[:space:]]*//p" | head -1)"
  [ -n "$v" ] || { echo "FAIL: VersionInfo.$f 为空（TR-08）"; exit 1; }
done
echo "PASS S0b VersionInfo 四字段非空"

# ---------- S1: 起服务 ----------

echo "=== S1: 起服务 → healthz 就绪 ==="
"$SERVICE_EXE" start >"$WORKBENCH_HOME/svc-s1.log" 2>&1 &
wait_healthz
echo "PASS S1 healthz 就绪（pid=$(healthz_pid)）"

# ---------- S2: 起托盘 → GREEN ----------

echo "=== S2: 起托盘 → 30s 内 GREEN 探活（tray.log） ==="
( "$TRAY_EXE" >"$WORKBENCH_HOME/tray-stderr.log" 2>&1 & )
sleep 2
tasklist //FI "IMAGENAME eq workbench-tray.exe" 2>/dev/null | grep -i "workbench-tray.exe" >/dev/null || {
  echo "FAIL: 托盘进程未存活（GUI 初始化失败？）"
  cat "$WORKBENCH_HOME/tray-stderr.log" 2>/dev/null || true
  exit 1
}
wait_log '"state":"Green"' 30 "托盘 GREEN 探活"
wait_log '"event":"menu.build"' 10 "菜单构建日志"
grep '"event":"tray.start"' "$TRAY_LOG" >/dev/null || { echo "FAIL: tray.log 缺 tray.start"; exit 1; }
grep '"serviceExe"' "$TRAY_LOG" >/dev/null || { echo "FAIL: tray.start 未记 serviceExe 解析结果"; exit 1; }
echo "PASS S2 托盘存活 + GREEN 探活 + menu.build + tray.start"

# ---------- S3: TR-06 自启注册 ----------

echo "=== S3: TR-06 自启注册（HKCU Run 键 + 哨兵文件） ==="
RUN_VAL="$(reg query "$RUN_KEY" //v "$RUN_KEY_NAME" 2>/dev/null | sed -n 's/.*REG_SZ[[:space:]]*//p' || true)"
[ -n "$RUN_VAL" ] || { echo "FAIL: HKCU Run 键 $RUN_KEY_NAME 未写入"; exit 1; }
[ "$(norm_path "$RUN_VAL")" = "$(norm_path "$TRAY_WIN")" ] || {
  echo "FAIL: Run 键值 [$RUN_VAL] != 托盘 exe 路径 [$TRAY_WIN]"; exit 1
}
[ -f "$WORKBENCH_HOME/run/sentinels/tray-autostart-defaulted" ] || {
  echo "FAIL: 哨兵文件未出现（$WORKBENCH_HOME/run/sentinels/tray-autostart-defaulted）"
  exit 1
}
grep '"event":"autostart.registered"' "$TRAY_LOG" >/dev/null || { echo "FAIL: tray.log 缺 autostart.registered"; exit 1; }
grep '"event":"autostart.sentinel_written"' "$TRAY_LOG" >/dev/null || { echo "FAIL: tray.log 缺 autostart.sentinel_written"; exit 1; }
echo "PASS S3 Run 键已注册（值 = $RUN_VAL）+ 哨兵已写"

# ---------- S4: 四态流转 + 红态自愈恰一次 ----------

echo "=== S4: TR-02/TR-05 四态流转（杀服务 → YELLOW → RED → recover 恰一次 → GREEN 回归） ==="
S4_T0=$SECONDS
SVC_PID="$(curl -sf --max-time 2 "$BASE/healthz" | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2)"
[ -n "$SVC_PID" ] || { echo "FAIL: S4 拿不到服务 pid"; exit 1; }
taskkill //F //PID "$SVC_PID" >/dev/null
BASE_LINE="$(log_line_count)"
wait_log '"to":"Yellow"' 15 "YELLOW 出现" "$BASE_LINE"
wait_log '"to":"Red"' 50 "RED 出现（双条件：连续 3 失败 + 30s 冷启动预算）" "$BASE_LINE"
RECOVER_COUNT="$(grep -c '"event":"recover.start_spawned"' "$TRAY_LOG" || true)"
[ "$RECOVER_COUNT" -eq 1 ] || {
  echo "FAIL: recover 次数 = $RECOVER_COUNT（TR-05：红态恰好一次，黄态全程 skip）"
  exit 1
}
# 次序：recover 晚于 RED 迁移（黄态期间零 recover 已由 count==1 保证，此处再验次序）
RED_LINE="$(grep -n '"to":"Red"' "$TRAY_LOG" | head -1 | cut -d: -f1)"
REC_LINE="$(grep -n '"event":"recover.start_spawned"' "$TRAY_LOG" | head -1 | cut -d: -f1)"
[ "$REC_LINE" -gt "$RED_LINE" ] || { echo "FAIL: recover（行 $REC_LINE）先于 RED 迁移（行 $RED_LINE）"; exit 1; }
wait_log '"to":"Green"' 25 "GREEN 回归（自愈后）" "$RED_LINE"
wait_healthz
S4_ELAPSED=$((SECONDS - S4_T0))
echo "PASS S4 四态流转 + 自愈恰一次（耗时 ${S4_ELAPSED}s）"
[ "$S4_ELAPSED" -le 90 ] || { echo "FAIL: S4 总耗时 ${S4_ELAPSED}s 超 90s 预算"; exit 1; }

# ---------- S4b: TR-03 CLI 动作面 ----------

echo "=== S4b: TR-03 CLI 动作面（外部 stop → GRAY；外部 start → GREEN；activity/health-wait） ==="
"$SERVICE_EXE" stop >/dev/null
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
  echo "FAIL: 外部 stop 后 healthz 仍可达"
  exit 1
fi
GRAY_BASE="$(log_line_count)"
wait_log '"to":"Gray"' 15 "外部 stop → 托盘 GRAY（优雅停止识别：service.json 消失）" "$GRAY_BASE"
ACT_OUT="$("$SERVICE_EXE" activity)"
echo "  activity → $ACT_OUT"
echo "$ACT_OUT" | grep '"conversationTasks"' >/dev/null || { echo "FAIL: activity 输出缺 conversationTasks"; exit 1; }
"$SERVICE_EXE" start >"$WORKBENCH_HOME/svc-s4b.log" 2>&1 &
wait_healthz
set +e
"$SERVICE_EXE" __health-wait 15000 >/dev/null 2>&1
HW_RC=$?
set -e
[ "$HW_RC" -eq 0 ] || { echo "FAIL: __health-wait 退出码 $HW_RC（期望 0）"; exit 1; }
wait_log '"to":"Green"' 15 "外部 start → 托盘 GREEN 回归" "$GRAY_BASE"
echo "PASS S4b 外部 stop→GRAY / start→GREEN / activity / __health-wait"

# ---------- S5: W-2 杀壳服务活 ----------

echo "=== S5: TR-01/W-2 杀壳 → 服务同 pid 存活 ==="
PID_BEFORE="$(healthz_pid)"
taskkill //F //IM workbench-tray.exe >/dev/null
sleep 3
PID_AFTER="$(healthz_pid)"
[ -n "$PID_AFTER" ] || { echo "FAIL: 杀壳后 healthz 不可达（W-2 违反：壳死了服务也死）"; exit 1; }
[ "$PID_BEFORE" = "$PID_AFTER" ] || {
  echo "FAIL: 杀壳后服务 pid 变化 $PID_BEFORE → $PID_AFTER（服务不应受壳生死影响）"
  exit 1
}
echo "PASS S5 W-2：杀壳后服务同 pid 存活（pid=$PID_AFTER，healthz 200）"

echo ""
echo "=== S6: 启动即活——服务已停（哨兵在）时启动托盘，应立即拉起服务（launch_revive） ==="
"$SERVICE_EXE" stop >/dev/null 2>&1
sleep 1
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then echo "FAIL: S6 前置——stop 后服务仍在跑"; exit 1; fi
taskkill //F //IM workbench-tray.exe >/dev/null 2>&1 || true  # S5 已杀壳——不在场是常态（taskkill 未找到返回 128，set -e 会误杀）
sleep 1
("$DIST/workbench-tray.exe" &)
REVIVED=0
for i in $(seq 1 20); do
  sleep 1
  if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then REVIVED=1; break; fi
done
[ "$REVIVED" -eq 1 ] || { echo "FAIL: 托盘启动后 20s 内服务未复活（launch_revive）"; tail -5 "$TRAY_LOG"; exit 1; }
grep -q 'tray.launch_revive' "$TRAY_LOG" || { echo "FAIL: tray.log 无 tray.launch_revive 事件"; exit 1; }
sleep 6
grep -q '"state":"Green"' <(tail -3 "$TRAY_LOG") || { echo "FAIL: 复活后未回 GREEN"; tail -3 "$HOME/.workbench/logs/tray.log"; exit 1; }
echo "PASS S6 (launch_revive: 托盘独立启动 -> 服务 ${i}s 内复活 -> GREEN)"

# ---------- S7: 单实例 + 唤醒重定向（方案 B，2026-08-25 用户裁决） ----------

echo ""
echo "=== S7: 单实例——已有壳在跑时再起一个，第二壳秒退并唤醒首壳打开工作台 ==="
tray_count() { tasklist //FI "IMAGENAME eq workbench-tray.exe" 2>/dev/null | grep -ci "workbench-tray.exe" || true; }
[ "$(tray_count)" -eq 1 ] || { echo "FAIL: S7 前置——期望恰 1 个托盘在跑（实际 $(tray_count) 个）"; exit 1; }
S7_BASE="$(log_line_count)"
( "$DIST/workbench-tray.exe" >"$WORKBENCH_HOME/tray2-stderr.log" 2>&1 & ) # 模拟用户点开始菜单快捷方式
sleep 3
[ "$(tray_count)" -eq 1 ] || {
  echo "FAIL: 第二实例 3s 内未退出（进程数 $(tray_count)）——双开防线失效（双图标 bug 复发）"
  cat "$WORKBENCH_HOME/tray2-stderr.log" 2>/dev/null || true
  exit 1
}
wait_log '"event":"tray.duplicate_exit"' 10 "第二实例留痕 tray.duplicate_exit" "$S7_BASE"
if tail -n +"$((S7_BASE + 1))" "$TRAY_LOG" 2>/dev/null | grep '"notify_error"' >/dev/null; then
  echo "FAIL: 第二实例唤醒通知失败（payload 含 notify_error）"; exit 1
fi
wait_log '"event":"tray.wakeup"' 10 "首实例收到唤醒" "$S7_BASE"
wait_log '"event":"open.browser_suppressed"' 10 "唤醒重定向走通 openWorkbench（NO_BROWSER=1 抑制位生效）" "$S7_BASE"
echo "PASS S7 双开秒退（进程恒为 1）+ duplicate_exit 留痕 + 唤醒重定向（tray.wakeup → openWorkbench）"

TRAY_SMOKE_EXIT=0
