#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/nanbosheyingimacpro/Documents/ChatGPT/NBO-作品与智能体中心"
CODEX_NODE="/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
WORKBENCH_URL="http://127.0.0.1:4176"
LOG_DIR="/Users/nanbosheyingimacpro/Documents/NBO-行业内容工作台"
SERVICE_LABEL="com.nanbo.industry-content-workbench"
LAUNCH_AGENT_SOURCE="$PROJECT_DIR/tools/industry-content-workbench/$SERVICE_LABEL.plist"
LAUNCH_AGENT_TARGET="/Users/nanbosheyingimacpro/Library/LaunchAgents/$SERVICE_LABEL.plist"

if [[ -x "$CODEX_NODE" ]]; then
  NODE_BINARY="$CODEX_NODE"
elif command -v node >/dev/null 2>&1; then
  NODE_BINARY="$(command -v node)"
else
  print "没有找到南铂行业内容工作台需要的 Node.js。"
  print "请把这句话复制给 Codex：帮我修复南铂行业内容工作台启动器。"
  read "? 按回车关闭…"
  exit 1
fi

if [[ ! -f "$PROJECT_DIR/tools/industry-content-workbench/server.mjs" ]]; then
  print "没有找到工作台程序：$PROJECT_DIR"
  print "请把这句话复制给 Codex：帮我恢复南铂行业内容工作台。"
  read "? 按回车关闭…"
  exit 1
fi

mkdir -p "$LOG_DIR"
if ! curl --silent --fail "$WORKBENCH_URL/healthz" >/dev/null 2>&1; then
  mkdir -p "/Users/nanbosheyingimacpro/Library/LaunchAgents"
  if [[ ! -f "$LAUNCH_AGENT_TARGET" ]] || ! cmp -s "$LAUNCH_AGENT_SOURCE" "$LAUNCH_AGENT_TARGET"; then
    cp "$LAUNCH_AGENT_SOURCE" "$LAUNCH_AGENT_TARGET"
    launchctl bootout "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT_TARGET"
  elif ! launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT_TARGET"
  fi
  for _ in {1..40}; do
    if curl --silent --fail "$WORKBENCH_URL/healthz" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

if curl --silent --fail "$WORKBENCH_URL/healthz" >/dev/null 2>&1; then
  open "$WORKBENCH_URL"
else
  print "工作台没有成功启动。日志：$LOG_DIR/workbench.log"
  read "? 按回车关闭…"
  exit 1
fi
