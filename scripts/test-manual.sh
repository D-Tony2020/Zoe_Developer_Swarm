#!/usr/bin/env bash
set -euo pipefail

# Zoe 手动验证脚本
# 用途：验证 git worktree + Claude Code 的基础链路
# 前提：tmux 和 claude CLI 已安装

echo "========================================="
echo "  Zoe 手动验证测试"
echo "========================================="
echo ""

TEST_DIR="/tmp/zoe-test-repo-$$"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cleanup() {
  echo ""
  echo ">> 清理测试环境..."
  cd /tmp
  if [ -d "$TEST_DIR" ]; then
    # 先清理 worktree
    cd "$TEST_DIR" 2>/dev/null && git worktree list | grep -v "bare" | awk '{print $1}' | while read wt; do
      [ "$wt" != "$TEST_DIR" ] && git worktree remove "$wt" --force 2>/dev/null || true
    done
    cd /tmp
    rm -rf "$TEST_DIR"
  fi
  # 清理 tmux session
  tmux kill-session -t zoe-test 2>/dev/null || true
  echo "  ✓ 清理完成"
}
trap cleanup EXIT

# 1. 创建测试仓库
echo ">> 步骤 1: 创建测试仓库 ($TEST_DIR)"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
git init
git commit --allow-empty -m "init"
echo "  ✓ 测试仓库已创建"

# 2. 创建 worktree
echo ""
echo ">> 步骤 2: 创建 git worktree"
git worktree add .worktrees/task-001 -b feat/zoe-test-001
echo "  ✓ Worktree 已创建: .worktrees/task-001"

# 3. 写入任务文件
echo ""
echo ">> 步骤 3: 写入 TASK.md 和 CLAUDE.md"

cat > ".worktrees/task-001/TASK.md" << 'EOF'
# 任务：创建测试文件

## 具体要求
- 在当前目录创建 `hello.ts` 文件
- 内容为：`console.log("hello from Zoe")`
- commit 消息中包含 `[DONE]`

## 验收标准
- hello.ts 文件存在且内容正确
- 有至少一个 commit

## 禁止事项
- 不要创建任何其他文件
EOF

cp "$PROJECT_DIR/templates/CLAUDE.md.template" ".worktrees/task-001/CLAUDE.md"
echo "  ✓ TASK.md 和 CLAUDE.md 已写入"

# 4. 验证文件
echo ""
echo ">> 步骤 4: 验证 worktree 内容"
echo "  目录内容:"
ls -la ".worktrees/task-001/"
echo ""
echo "  TASK.md 内容:"
cat ".worktrees/task-001/TASK.md"

# 5. 提示手动启动
echo ""
echo "========================================="
echo "  自动验证完成！"
echo "========================================="
echo ""
echo "现在手动验证 Claude Code 链路："
echo ""
echo "  cd $TEST_DIR/.worktrees/task-001"
echo "  claude -p \"\$(cat TASK.md)\" --dangerously-skip-permissions"
echo ""
echo "验证 Claude Code 是否能："
echo "  1. 读取 TASK.md"
echo "  2. 创建 hello.ts"
echo "  3. commit 并包含 [DONE]"
echo ""
echo "确认后按 Ctrl+C 退出（自动清理测试环境）"
echo ""

# 等待用户操作
read -r -p "按 Enter 清理测试环境..."
