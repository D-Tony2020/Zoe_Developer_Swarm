---
name: spawn-coder
description: 启动 Claude Code 施工队在隔离 worktree 中执行编码任务
---

# spawn-coder

当用户给你一个开发任务时，使用 `spawn_coder` 工具来启动一个 Claude Code 施工队。

## 使用步骤

1. 理解用户意图，生成精确的 TASK.md 内容
2. 确认目标仓库路径和基础分支
3. 调用 `spawn_coder` 工具
4. 使用 `list_tasks` 监控进度
5. 收到 PR URL 后通知用户

## 注意事项

- 并发施工队上限 4 个
- 超过 2 小时的任务会被标记为超时
- 每个施工队在独立的 git worktree 中运行，互不干扰
