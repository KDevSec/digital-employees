#!/usr/bin/env bash
# 服务冒烟（Task 9 建 8 场景，Task 11 增编译版）——九场景全链验证：
#   1 起服务 healthz（app+uid 契约）
#   2 幂等：二次 start 退出码 0 且 pid 不变
#   3 Host 白名单 403
#   4 status JSON 含 port
#   5 stop：healthz 拒连 + service.json 删除 + cleanStop=true
#   5.5 坏 config：stop/status 仍可用，start 退出码 78（友好文案非裸堆栈）
#   6 干净 stop 后重启无 crash_detected（负向）；kill -9 后重启记 crash_detected（正向）
#   7 端口被第三方占用 → start 退出码 78（conflict 分支）
#   8 编译版全链（Task 11）：build.sh 单体编译 → exe start healthz → / 嵌入页
#     → buildCommitId 注入 → 二次 start 幂等 → stop 拒连（未装 Bun 语义下独立完成）
# 环境事实（Windows + git-bash 实测）：
#   - 跨进程信号不可投递：硬杀用 taskkill //F //PID（git-bash kill 不识别原生 pid）
#   - WORKBENCH_NO_BROWSER=1 抑制 rundll32 开真浏览器
set -euo pipefail

cd "$(dirname "$0")/.." # workbench/workbench-service

# 冒烟用独立端口（避免与机器上真实安装运行的 19980 实例冲突——独立 profile 的 uid 不同会误判 conflict/78）
PORT="${WORKBENCH_SMOKE_PORT:-19981}"
BASE="http://127.0.0.1:$PORT"
export WORKBENCH_HOME="$(mktemp -d)"
export WORKBENCH_NO_BROWSER=1
mkdir -p "$WORKBENCH_HOME"
printf '{\n  "_comment": "smoke 专用端口隔离",\n  "network": { "port": %s }\n}\n' "$PORT" > "$WORKBENCH_HOME/config.json"
RUN_DIR="$WORKBENCH_HOME/run"
PROFILE_DIR="$WORKBENCH_HOME"
LIFECYCLE_LOG="$WORKBENCH_HOME/logs/lifecycle.log"
OCCUPIER_PID=""

cleanup() {
  # 杀残留服务（读契约 pid，可能不存在）
  if [ -f "$RUN_DIR/service.pid" ]; then
    local pid
    pid="$(cat "$RUN_DIR/service.pid" 2>/dev/null || true)"
    if [ -n "$pid" ]; then taskkill //F //PID "$pid" >/dev/null 2>&1 || true; fi
  fi
  # 杀端口占用方
  if [ -n "$OCCUPIER_PID" ]; then taskkill //F //PID "$OCCUPIER_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$WORKBENCH_HOME"
}
trap cleanup EXIT

# healthz 就绪等待（最多 15s）
wait_healthz() {
  local deadline=$((SECONDS + 15))
  until curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "FAIL: healthz 在 15s 内未就绪"
      return 1
    fi
    sleep 0.5
  done
}

healthz_pid() {
  curl -sf --max-time 2 "$BASE/healthz" | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2
}

kill_service() { # 硬杀当前服务（读契约 pid）
  local pid
  pid="$(cat "$RUN_DIR/service.pid")"
  taskkill //F //PID "$pid" >/dev/null
  echo "  (kill -9 等效硬杀 pid $pid)"
}

echo "=== 场景 1: 后台 start → healthz 含 app+uid（uid 契约 a540c56） ==="
bun run src/main.ts start >"$WORKBENCH_HOME/start1.log" 2>&1 &
wait_healthz
BODY="$(curl -sf --max-time 2 "$BASE/healthz")"
echo "$BODY"
echo "$BODY" | grep -q '"app":"workbench"' || { echo "FAIL: healthz 缺 app=workbench"; exit 1; }
echo "$BODY" | grep -q '"uid"' || { echo "FAIL: healthz 缺 uid"; exit 1; }
PID1="$(healthz_pid)"
echo "PASS 场景 1 (pid=$PID1)"

echo "=== 场景 2: 幂等——再次 start 退出码 0 且 pid 不变 ==="
set +e
bun run src/main.ts start >"$WORKBENCH_HOME/start2.log" 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || { echo "FAIL: 二次 start 退出码 $RC（期望 0）"; exit 1; }
PID2="$(healthz_pid)"
[ "$PID1" = "$PID2" ] || { echo "FAIL: pid 变化 $PID1 → $PID2（不应起新进程）"; exit 1; }
echo "PASS 场景 2 (退出码 0, pid=$PID2 未变)"

echo "=== 场景 3: Host 白名单——evil.com → 403 ==="
CODE="$(curl -s --max-time 2 -H 'Host: evil.com' -o /dev/null -w '%{http_code}' "$BASE/healthz")"
[ "$CODE" = "403" ] || { echo "FAIL: Host=evil.com 得 $CODE（期望 403）"; exit 1; }
echo "PASS 场景 3 (403)"

echo "=== 场景 4: status → JSON 含 port ==="
STATUS_JSON="$(bun run src/main.ts status)"
echo "$STATUS_JSON"
echo "$STATUS_JSON" | grep -q '"port"' || { echo "FAIL: status 缺 port"; exit 1; }
echo "PASS 场景 4"

echo "=== 场景 5: stop → healthz 拒连 + service.json 删除 + cleanStop=true ==="
bun run src/main.ts stop
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
  echo "FAIL: stop 后 healthz 仍可达"
  exit 1
fi
[ ! -f "$RUN_DIR/service.json" ] || { echo "FAIL: stop 后 service.json 仍存在"; exit 1; }
grep -q '"cleanStop": true' "$RUN_DIR/reliability.json" || { echo "FAIL: reliability.json cleanStop!=true"; exit 1; }
echo "PASS 场景 5 (拒连 + 契约清理 + cleanStop=true)"

echo "=== 场景 5.7: user-stopped 哨兵——stop 后 __daemon 秒退不复活；start 清哨兵恢复 ==="
[ -f "$RUN_DIR/sentinels/user-stopped" ] || { echo "FAIL: stop 后 user-stopped 哨兵未落盘"; exit 1; }
DAEMON_START=$(date +%s%3N)
bun run src/main.ts __daemon
DAEMON_RC=$?
DAEMON_ELAPSED=$(( $(date +%s%3N) - DAEMON_START ))
[ "$DAEMON_RC" -eq 0 ] || { echo "FAIL: __daemon 哨兵路径退出码 $DAEMON_RC（应 0）"; exit 1; }
[ "$DAEMON_ELAPSED" -lt 3000 ] || { echo "FAIL: __daemon 哨兵路径耗时 ${DAEMON_ELAPSED}ms（应秒退 <3s，不能起服务）"; exit 1; }
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
  echo "FAIL: __daemon 哨兵路径后服务被拉起（healthz 可达）"
  exit 1
fi
grep -q 'daemon.skipped_user_stopped' "$PROFILE_DIR/logs/lifecycle.log" || { echo "FAIL: lifecycle.log 无 daemon.skipped_user_stopped 事件"; exit 1; }
# start（用户显式）清哨兵并起服务
( bun run src/main.ts start >"$WORKBENCH_HOME/start-again.log" 2>&1 & )
for i in $(seq 1 15); do curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1 || { echo "FAIL: start 清哨兵后服务未恢复"; exit 1; }
[ ! -f "$RUN_DIR/sentinels/user-stopped" ] || { echo "FAIL: start 后哨兵未被清除"; exit 1; }
echo "PASS 场景 5.7 (哨兵落盘 → __daemon 秒退 ${DAEMON_ELAPSED}ms 不复活 → start 清哨兵恢复)"
# 停回干净态供后续场景
bun run src/main.ts stop >/dev/null 2>&1
sleep 1

echo "=== 场景 5.8: 调度器路径不开浏览器（安装实测反馈：每分钟弹标签页缺口） ==="
# 服务在跑的状态下：__daemon（幂等分支）不得产生 browser.open 事件；用户 start（幂等分支）要产生
( bun run src/main.ts start >"$WORKBENCH_HOME/s58-start1.log" 2>&1 & )
for i in $(seq 1 15); do curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1 || { echo "FAIL: 5.8 前置——服务未起"; exit 1; }
BROWSER_BEFORE=$(grep -c 'browser.open' "$PROFILE_DIR/logs/lifecycle.log" 2>/dev/null || echo 0)
bun run src/main.ts __daemon
[ $? -eq 0 ] || { echo "FAIL: __daemon 幂等路径退出码非 0"; exit 1; }
BROWSER_AFTER_DAEMON=$(grep -c 'browser.open' "$PROFILE_DIR/logs/lifecycle.log" 2>/dev/null || echo 0)
[ "$BROWSER_AFTER_DAEMON" -eq "$BROWSER_BEFORE" ] || { echo "FAIL: __daemon 幂等路径产生了 browser.open 事件（$BROWSER_BEFORE -> $BROWSER_AFTER_DAEMON）"; exit 1; }
bun run src/main.ts start >/dev/null 2>&1
START_RC=$?
[ "$START_RC" -eq 0 ] || { echo "FAIL: 用户 start 幂等路径退出码 $START_RC"; exit 1; }
BROWSER_AFTER_START=$(grep -c 'browser.open' "$PROFILE_DIR/logs/lifecycle.log" 2>/dev/null || echo 0)
[ "$BROWSER_AFTER_START" -gt "$BROWSER_AFTER_DAEMON" ] || { echo "FAIL: 用户 start 幂等路径未产生 browser.open 事件"; exit 1; }
echo "PASS 场景 5.8 (__daemon 幂等不开浏览器: $BROWSER_BEFORE->$BROWSER_AFTER_DAEMON；用户 start 开: ->$BROWSER_AFTER_START)"
# 停回干净态
bun run src/main.ts stop >/dev/null 2>&1
sleep 1

echo "=== 场景 5.5: 坏 config.json → stop/status 仍可用，start 退出码 78（友好文案） ==="
echo '{"network": {"port": "not-a-number"}}' >"$WORKBENCH_HOME/config.json"
set +e
bun run src/main.ts stop >"$WORKBENCH_HOME/badcfg-stop.log" 2>&1
STOP_RC=$?
set -e
[ "$STOP_RC" -eq 0 ] || { echo "FAIL: 坏 config 下 stop 退出码 $STOP_RC（期望 0，stop 不应依赖 config）"; cat "$WORKBENCH_HOME/badcfg-stop.log"; exit 1; }
STATUS_JSON="$(bun run src/main.ts status)"
echo "$STATUS_JSON" | grep -q '"port"' || { echo "FAIL: 坏 config 下 status 不可用"; exit 1; }
set +e
bun run src/main.ts start >"$WORKBENCH_HOME/badcfg-start.log" 2>&1
RC=$?
set -e
cat "$WORKBENCH_HOME/badcfg-start.log"
[ "$RC" -eq 78 ] || { echo "FAIL: 坏 config 下 start 退出码 $RC（期望 78）"; exit 1; }
grep -q '配置' "$WORKBENCH_HOME/badcfg-start.log" || { echo "FAIL: 78 输出缺友好文案"; exit 1; }
if grep -qE '^\s+at ' "$WORKBENCH_HOME/badcfg-start.log"; then
  echo "FAIL: 78 输出含裸堆栈帧"; exit 1
fi
printf '{
  "_comment": "smoke 专用端口隔离",
  "network": { "port": %s }
}
' "$PORT" > "$WORKBENCH_HOME/config.json" # 恢复冒烟端口配置（非默认端口，不能删了事）
echo "PASS 场景 5.5 (stop/status 可用 + start 78 友好文案)"

echo "=== 场景 6: 干净 stop 后重启无 crash_detected；kill -9 后重启记 crash_detected ==="
# 6a 负向：干净 stop（场景 5 已置 cleanStop=true）后重启 → lifecycle.log 无 crash_detected
# （D-035：运行中实例的 cleanStop=false 是常态，幂等/干净重启不得误记崩溃）
bun run src/main.ts start >"$WORKBENCH_HOME/start6a.log" 2>&1 &
wait_healthz
if grep -q 'crash_detected' "$LIFECYCLE_LOG"; then
  echo "FAIL: 干净 stop 后重启不应记 crash_detected"
  cat "$LIFECYCLE_LOG"
  exit 1
fi
bun run src/main.ts stop
# 6b 正向：kill -9 → 确认真死（healthz 拒连）→ 重启记 crash_detected
bun run src/main.ts start >"$WORKBENCH_HOME/start6b.log" 2>&1 &
wait_healthz
kill_service
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
  echo "FAIL: kill_service 后 healthz 仍可达（未真杀死）"
  exit 1
fi
bun run src/main.ts start >"$WORKBENCH_HOME/start6c.log" 2>&1 &
wait_healthz
grep -q 'crash_detected' "$LIFECYCLE_LOG" || { echo "FAIL: 重启后 lifecycle.log 无 crash_detected"; exit 1; }
echo "PASS 场景 6 (负向无 crash + kill 后有 crash)"

echo "=== 场景 7: 端口被第三方占用 → start 退出码 78 ==="
kill_service # 留下陈旧 service.json（conflict 判定需要句柄存在），端口腾给占用方
sleep 1
WB_SMOKE_PORT="$PORT" bun -e "Bun.serve({port:Number(process.env.WB_SMOKE_PORT), hostname:\"127.0.0.1\", fetch: () => new Response(\"occupier\")}); console.log(process.pid)" >"$WORKBENCH_HOME/occupier.out" 2>&1 &
sleep 1.5
OCCUPIER_PID="$(head -1 "$WORKBENCH_HOME/occupier.out" | grep -o '[0-9]*')"
set +e
bun run src/main.ts start >"$WORKBENCH_HOME/start5.log" 2>&1
RC=$?
set -e
cat "$WORKBENCH_HOME/start5.log"
[ "$RC" -eq 78 ] || { echo "FAIL: 端口占用下 start 退出码 $RC（期望 78）"; exit 1; }
echo "PASS 场景 7 (conflict → 78)"

# ---------- 场景 8: 编译版全链（Task 11 / S-01） ----------

echo "=== 场景 8: 编译版全链——build.sh 单体编译 + exe 独立运行 ==="
# 释放场景 7 的端口占用方（occupier 仍持有占用端口）
if [ -n "$OCCUPIER_PID" ]; then
  taskkill //F //PID "$OCCUPIER_PID" >/dev/null 2>&1 || true
  OCCUPIER_PID=""
fi
sleep 1

echo "--- 8a: bash scripts/build.sh 产出 dist/devzero.exe ---"
bash scripts/build.sh >"$WORKBENCH_HOME/build.log" 2>&1
[ -f dist/devzero.exe ] || { echo "FAIL: dist/devzero.exe 未产出"; cat "$WORKBENCH_HOME/build.log"; exit 1; }
EXE_SIZE="$(ls -la dist/devzero.exe | awk '{print $5}')"
echo "  (devzero.exe ${EXE_SIZE} bytes, 构建日志见 $WORKBENCH_HOME/build.log)"
echo "PASS 8a (单体编译产出)"

echo "--- 8b: exe 后台 start → healthz 含 app+uid；/ 返回嵌入页；buildCommitId 已注入 ---"
./dist/devzero.exe start >"$WORKBENCH_HOME/exe-start1.log" 2>&1 &
wait_healthz
BODY="$(curl -sf --max-time 2 "$BASE/healthz")"
echo "$BODY"
echo "$BODY" | grep -q '"app":"workbench"' || { echo "FAIL: exe healthz 缺 app=workbench"; cat "$WORKBENCH_HOME/exe-start1.log"; exit 1; }
echo "$BODY" | grep -q '"uid"' || { echo "FAIL: exe healthz 缺 uid"; exit 1; }
PAGE="$(curl -sf --max-time 2 "$BASE/")"
# 注意：页面 ~91KB > 64KB 管道缓冲，grep -q 早退会让 echo 收 SIGPIPE(141)，
# 叠加 set -o pipefail 误判失败——大内容断言用 grep -c（读完全部输入）
echo "$PAGE" | grep -c 'DevZero' >/dev/null || {
  echo "FAIL: / 返回内容缺「DevZero」（嵌入未生效）"
  echo "  诊断: PAGE 字符数=${#PAGE} 头部=[$(printf '%s' "$PAGE" | head -c 120)]"
  curl -s --max-time 2 -o /dev/null -w '  诊断: http_code=%{http_code} size=%{size_download}
' "$BASE/" || true
  cat "$WORKBENCH_HOME/exe-start1.log"
  exit 1
}
EXPECTED_COMMIT="$(git rev-parse --short HEAD)"
grep -q "\"buildCommitId\": \"${EXPECTED_COMMIT}\"" "$RUN_DIR/service.json" || {
  echo "FAIL: service.json buildCommitId != ${EXPECTED_COMMIT}（--define 注入未生效）"
  cat "$RUN_DIR/service.json"
  exit 1
}
echo "PASS 8b (healthz app+uid + / 嵌入页 + buildCommitId=${EXPECTED_COMMIT})"

echo "--- 8c: 二次 start 幂等（rc 0）→ stop → healthz 拒连 ---"
set +e
./dist/devzero.exe start >"$WORKBENCH_HOME/exe-start2.log" 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || { echo "FAIL: exe 二次 start 退出码 $RC（期望 0）"; cat "$WORKBENCH_HOME/exe-start2.log"; exit 1; }
./dist/devzero.exe stop
if curl -sf --max-time 2 "$BASE/healthz" >/dev/null 2>&1; then
  echo "FAIL: exe stop 后 healthz 仍可达"
  exit 1
fi
echo "PASS 8c (幂等 + stop 拒连)"

echo ""
echo "=== 冒烟全部通过（9/9 场景：8 原场景 + 编译版全链） ==="
