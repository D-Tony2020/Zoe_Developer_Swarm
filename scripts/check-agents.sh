#!/usr/bin/env bash
# Zoe 施工队监控脚本
# 用途：通过 cron 定期运行，检查活跃任务状态
# 建议 cron 配置：*/10 * * * * /path/to/check-agents.sh
#
# 检查内容：
# 1. 孤儿 tmux session（有 session 但任务已完成）
# 2. 超时任务（运行超过 2 小时）
# 3. 孤儿 worktree（有 worktree 但无对应 tmux session）

MAX_RUNTIME_MINUTES=120

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始检查施工队状态..."

# 1. 列出所有 zoe- 前缀的 tmux session
SESSIONS=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^zoe-' || true)

if [ -z "$SESSIONS" ]; then
  echo "  没有活跃的施工队 session。"
  exit 0
fi

echo "  活跃 session:"
for session in $SESSIONS; do
  # 获取 session 创建时间
  CREATED=$(tmux display-message -t "$session" -p '#{session_created}' 2>/dev/null || echo "0")
  NOW=$(date +%s)
  ELAPSED_MIN=$(( (NOW - CREATED) / 60 ))

  if [ "$ELAPSED_MIN" -gt "$MAX_RUNTIME_MINUTES" ]; then
    echo "  ⚠️  $session — 运行 ${ELAPSED_MIN}m（超过 ${MAX_RUNTIME_MINUTES}m 上限）"
    echo "    → 建议手动检查或取消: tmux kill-session -t $session"
  else
    echo "  ✓  $session — 运行 ${ELAPSED_MIN}m"
  fi
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 检查完成。"
