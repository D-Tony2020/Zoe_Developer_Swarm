/**
 * list_tasks — 查询当前活跃的施工队任务状态
 */

import { execSync } from "node:child_process";
import { activeTasks } from "./types.js";
import type { TaskInfo } from "./types.js";

/**
 * 计算运行时长的可读格式
 */
function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

/**
 * 检查 tmux session 是否还活着
 */
function isTmuxSessionAlive(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export interface TaskStatusEntry {
  task_id: string;
  status: string;
  branch_name: string;
  duration: string;
  pr_url: string | null;
  tmux_alive: boolean;
}

/**
 * list_tasks 主函数
 */
export function listTasks(): TaskStatusEntry[] {
  const result: TaskStatusEntry[] = [];

  for (const [taskId, task] of activeTasks) {
    // 检查 tmux session 是否还在
    let tmuxAlive = false;
    try {
      tmuxAlive = isTmuxSessionAlive(task.tmux_session);
    } catch {
      // tmux 不可用
    }

    // 如果 tmux session 已死但任务还标记为 running，更新状态
    if (!tmuxAlive && task.status === "running") {
      task.status = "done";
      activeTasks.set(taskId, task);
    }

    result.push({
      task_id: taskId,
      status: task.status,
      branch_name: task.branch_name,
      duration: formatDuration(task.started_at),
      pr_url: task.pr_url ?? null,
      tmux_alive: tmuxAlive,
    });
  }

  return result;
}
