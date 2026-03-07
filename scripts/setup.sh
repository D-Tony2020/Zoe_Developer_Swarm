#!/usr/bin/env bash
set -euo pipefail

# Zoe Agent 一键安装脚本
# 用途：检查依赖、安装 MCP 工具、提示配置 openclaw.json

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$PROJECT_DIR/mcp-tools"
WORKSPACE_DIR="$PROJECT_DIR/workspace-zoe"

echo "========================================="
echo "  Zoe Agent 安装脚本"
echo "========================================="
echo ""

# 1. 检查依赖
echo ">> 检查依赖..."

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo "  ✗ $1 未安装 — $2"
    return 1
  else
    echo "  ✓ $1 ($($1 --version 2>/dev/null | head -1))"
    return 0
  fi
}

MISSING=0
check_command "node"    "需要 Node.js >= 22: https://nodejs.org" || MISSING=1
check_command "git"     "需要 git >= 2.15: https://git-scm.com" || MISSING=1
check_command "claude"  "需要 Claude CLI: npm install -g @anthropic-ai/claude-code" || MISSING=1
check_command "gh"      "需要 GitHub CLI: https://cli.github.com" || MISSING=1
check_command "tmux"    "需要 tmux: brew install tmux (Mac) / apt install tmux (Linux)" || MISSING=1

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "⚠️  请先安装缺失的依赖再继续。"
  exit 1
fi

# 2. 安装 MCP 工具
echo ""
echo ">> 安装 MCP 工具依赖..."
cd "$MCP_DIR"
npm install
echo "  ✓ 依赖安装完成"

echo ""
echo ">> 编译 TypeScript..."
npm run build
echo "  ✓ 编译完成"

# 3. 提示配置
echo ""
echo "========================================="
echo "  安装完成！"
echo "========================================="
echo ""
echo "接下来请手动配置 openclaw.json："
echo ""
echo "  1. 打开 ~/.openclaw/openclaw.json"
echo "  2. 在 agents.list 中添加 Zoe Agent："
echo ""
cat << 'JSONEOF'
{
  "id": "zoe",
  "name": "Zoe",
  "default": false,
  "workspace": "WORKSPACE_DIR_PLACEHOLDER",
  "model": { "primary": "anthropic/claude-opus-4-6" },
  "identity": { "name": "Zoe", "emoji": "🔧" },
  "tools": {
    "mcp": {
      "servers": [{
        "name": "zoe-tools",
        "command": "node",
        "args": ["MCP_DIR_PLACEHOLDER/dist/index.js"]
      }]
    }
  }
}
JSONEOF
echo ""
echo "  替换路径："
echo "    WORKSPACE_DIR_PLACEHOLDER → $WORKSPACE_DIR"
echo "    MCP_DIR_PLACEHOLDER       → $MCP_DIR"
echo ""
echo "  3. 如需 Telegram 路由，在 bindings 中添加："
echo '    { "agentId": "zoe", "match": { "channel": "telegram", "peer": { "kind": "group", "id": "YOUR_GROUP_ID" } } }'
echo ""
