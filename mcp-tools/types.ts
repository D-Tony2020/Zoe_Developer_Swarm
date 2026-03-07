/**
 * Zoe MCP Tools 共享类型定义
 */

export interface TaskInfo {
  task_id: string;
  repo_path: string;
  worktree_path: string;
  branch_name: string;
  tmux_session: string;
  status: "starting" | "running" | "done" | "error" | "cancelled";
  started_at: string;
  pr_url?: string;
  error?: string;
}

export interface SpawnCoderInput {
  task_description: string;
  repo_path: string;
  branch_base?: string;
}

export interface SpawnCoderOutput {
  task_id: string;
  worktree_path: string;
  branch_name: string;
  status: "started" | "error";
  error?: string;
}

export interface CancelTaskInput {
  task_id: string;
}

/**
 * 全局任务注册表
 * 运行时维护在内存中，同时持久化到 .openclaw/active-tasks.json
 */
export const activeTasks: Map<string, TaskInfo> = new Map();

/**
 * 并发施工队上限
 */
export const MAX_CONCURRENT_AGENTS = 4;
