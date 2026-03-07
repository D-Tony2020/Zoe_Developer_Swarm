/**
 * cancel_task — 取消一个正在运行的任务，清理 worktree 和 tmux session
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { activeTasks } from "./types.js";
import type { CancelTaskInput } from "./types.js";

/**
 * 安全执行 shell 命令
 */
function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    timeout: 15_000,
  }).trim();
}

export interface CancelResult {
  task_id: string;
  status: "cancelled" | "not_found" | "error";
  message: string;
}

/**
 * 持久化任务注册表
 */
function persistTasks(repoPath: string): void {
  const tasksDir = path.join(repoPath, ".openclaw");
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }
  const tasksFile = path.join(tasksDir, "active-tasks.json");
  const data = Object.fromEntries(activeTasks);
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * cancel_task 主函数
 */
export function cancelTask(input: CancelTaskInput): CancelResult {
  const { task_id } = input;

  const task = activeTasks.get(task_id);
  if (!task) {
    return {
      task_id,
      status: "not_found",
      message: `任务 ${task_id} 不存在。`,
    };
  }

  const errors: string[] = [];

  // 1. 终止 tmux session
  try {
    run(`tmux kill-session -t ${task.tmux_session}`);
  } catch {
    // session 可能已经不存在
  }

  // 2. 清理 git worktree
  try {
    if (fs.existsSync(task.worktree_path)) {
      run(`git worktree remove "${task.worktree_path}" --force`, task.repo_path);
    }
  } catch (err) {
    errors.push(`清理 worktree 失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. 删除远端分支（可选，失败不影响）
  try {
    run(`git push origin --delete ${task.branch_name}`, task.repo_path);
  } catch {
    // 分支可能不存在于远端
  }

  // 4. 更新任务状态
  task.status = "cancelled";
  activeTasks.set(task_id, task);
  persistTasks(task.repo_path);

  if (errors.length > 0) {
    return {
      task_id,
      status: "cancelled",
      message: `任务已取消，但有清理警告: ${errors.join("; ")}`,
    };
  }

  return {
    task_id,
    status: "cancelled",
    message: `任务 ${task_id} 已取消，worktree 和 tmux session 已清理。`,
  };
}
