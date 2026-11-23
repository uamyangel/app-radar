#!/bin/bash
# 本地 AI 分析的定时自动运行（macOS launchd）
#
#   scripts/insights-agent.sh install     安装并启用：登录/开机时、之后每 30 分钟检查一次（合盖期间不触发，醒来补一次）
#   scripts/insights-agent.sh uninstall   停用并删除
#   scripts/insights-agent.sh status      看是否在运行、最近的日志
#   scripts/insights-agent.sh run         立刻触发一次（和定时触发完全一样）
#
# 每次触发执行 pnpm insights auto：没插电且电量低、上一次还没结束、没有待办时直接退出，不调用模型。
# 参数（订阅、每次最多调用次数、电量阈值）在 config.yaml 的 insights.auto。
set -euo pipefail

LABEL="com.app-radar.insights"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/app-radar"
LOG="$LOG_DIR/insights.log"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE_BIN="$(dirname "$(command -v node)")"
    CURSOR_BIN="$(dirname "$(command -v cursor-agent || echo /usr/local/bin/cursor-agent)")"
    command -v pnpm >/dev/null || { echo "找不到 pnpm"; exit 1; }
    mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
    # launchd 不读 shell 配置，PATH 要写全：node/pnpm（nvm）、cursor-agent、claude、codex、psql
    PATH_VALUE="$NODE_BIN:$CURSOR_BIN:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$REPO</string>
  <!-- caffeinate -i：运行期间不因闲置而休眠；合盖仍会正常休眠，醒来接着跑 -->
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$NODE_BIN/pnpm</string><string>-s</string><string>insights</string><string>auto</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$PATH_VALUE</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>1800</integer>
  <key>Nice</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "已安装：$PLIST"
    echo "日志：$LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "已停用并删除"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E '^\s*(state|runs|last exit code|pid) =' || true
    else
      echo "未安装"
    fi
    [ -f "$LOG" ] && { echo "--- 最近日志"; tail -15 "$LOG"; }
    ;;
  run)
    launchctl kickstart "$DOMAIN/$LABEL" && echo "已触发，日志：$LOG"
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1
    ;;
esac
