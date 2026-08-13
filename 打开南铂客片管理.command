#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${0:A:h}"
CODEX_NODE="/Users/nanbosheyingimacpro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [[ -x "$CODEX_NODE" ]]; then
  NODE_BINARY="$CODEX_NODE"
elif command -v node >/dev/null 2>&1; then
  NODE_BINARY="$(command -v node)"
else
  print "没有找到南铂客片管理台需要的 Node.js。"
  print "请把这句话复制给 Codex：帮我修复南铂客片管理台启动器。"
  read "? 按回车关闭…"
  exit 1
fi

cd "$PROJECT_DIR"
exec "$NODE_BINARY" tools/portfolio-manager-server.mjs --open
