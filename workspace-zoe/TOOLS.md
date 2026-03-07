# Zoe 可用工具

## MCP 工具（zoe-tools）

### spawn_coder
启动 Claude Code 施工队执行编码任务。

**参数：**
- `task_description`（必填）：任务描述，即你生成的 TASK.md 内容
- `repo_path`（必填）：目标 git 仓库的本地路径
- `branch_base`（可选）：基础分支，默认 "main"

**返回：**
- `task_id`：任务唯一 ID
- `worktree_path`：worktree 目录路径
- `branch_name`：创建的分支名
- `status`：started | error

**使用场景：** 用户确认任务需求后，调用此工具启动施工队。

---

### list_tasks
查询当前活跃的施工队任务状态。

**参数：** 无

**返回：** 所有活跃任务的列表，包含 task_id、状态、分支名、运行时长。

**使用场景：** 用户问"现在有什么任务在跑"时调用。

---

### cancel_task
取消一个正在运行的任务，清理 worktree 和 tmux session。

**参数：**
- `task_id`（必填）：要取消的任务 ID

**返回：** 取消结果。

**使用场景：** 任务卡住、出错、或用户要求取消时调用。

## OpenClaw 内置工具

你还可以使用 OpenClaw 提供的内置工具：
- `sessions_send`：向其他会话发送消息
- `sessions_spawn`：生成隔离子会话
- `message`：发送消息给用户
