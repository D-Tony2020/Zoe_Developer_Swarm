/**
 * spawn_coder — 核心工具：启动 Claude Code 施工队
 *
 * 流程：
 * 1. 生成 task_id
 * 2. 创建 git worktree + branch
 * 3. 写入 TASK.md + CLAUDE.md 到 worktree
 * 4. 启动 tmux session + Claude Code
 * 5. 启动 PR 检测轮询
 */

import { execSync, exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { activeTasks, MAX_CONCURRENT_AGENTS } from "./types.js";
import type { TaskInfo, SpawnCoderInput, SpawnCoderOutput } from "./types.js";

/** CLAUDE.md.template 的路径（相对于本项目根目录） */
const TEMPLATE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "templates"
);

/**
 * 生成唯一 task_id：时间戳 + 4 位随机数
 */
function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6);
  return `${ts}-${rand}`;
}

/**
 * 安全执行 shell 命令
 */
function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
}

/**
 * 检查 tmux 是否可用
 */
function isTmuxAvailable(): boolean {
  try {
    run("tmux -V");
    return true;
  } catch {
    return false;
  }
}

/**
 * 持久化任务注册表到文件
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
 * 从文件恢复任务注册表
 */
export function loadTasks(repoPath: string): void {
  const tasksFile = path.join(repoPath, ".openclaw", "active-tasks.json");
  if (fs.existsSync(tasksFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tasksFile, "utf-8"));
      for (const [id, info] of Object.entries(data)) {
        activeTasks.set(id, info as TaskInfo);
      }
    } catch {
      // 文件损坏，忽略
    }
  }
}

/**
 * 启动 PR 检测轮询
 */
function startPrPolling(taskId: string, branchName: string, repoPath: string): void {
  const interval = setInterval(async () => {
    const task = activeTasks.get(taskId);
    if (!task || task.status === "done" || task.status === "cancelled" || task.status === "error") {
      clearInterval(interval);
      return;
    }

    try {
      // 检查是否有新 commit 带 [DONE] 标志
      const log = run(
        `git log ${branchName} --oneline -5`,
        repoPath
      );
      const isDone = log.includes("[DONE]");

      // 检查 PR
      const prOutput = run(
        `gh pr list --head ${branchName} --json url --jq ".[0].url"`,
        repoPath
      );

      if (prOutput) {
        task.pr_url = prOutput;
        task.status = "done";
        activeTasks.set(taskId, task);
        persistTasks(repoPath);
        clearInterval(interval);
        // PR 结果会通过 list_tasks 被 Zoe 读取
      } else if (isDone) {
        // 有 DONE 标志但还没 PR，可能 PR 正在创建中，继续等
      }
    } catch {
      // 轮询失败不中断，下次再试
    }
  }, 30_000); // 每 30 秒检查一次
}

/**
 * spawn_coder 主函数
 */
export async function spawnCoder(input: SpawnCoderInput): Promise<SpawnCoderOutput> {
  const { task_description, repo_path, branch_base = "main" } = input;

  // 前置检查
  if (!fs.existsSync(repo_path)) {
    return { task_id: "", worktree_path: "", branch_name: "", status: "error", error: `仓库路径不存在: ${repo_path}` };
  }

  // 检查并发上限
  const runningCount = Array.from(activeTasks.values()).filter(
    (t) => t.status === "running" || t.status === "starting"
  ).length;
  if (runningCount >= MAX_CONCURRENT_AGENTS) {
    return {
      task_id: "",
      worktree_path: "",
      branch_name: "",
      status: "error",
      error: `并发施工队已达上限 (${MAX_CONCURRENT_AGENTS})。请等待现有任务完成或取消后再试。`,
    };
  }

  // 检查 tmux
  if (!isTmuxAvailable()) {
    return {
      task_id: "",
      worktree_path: "",
      branch_name: "",
      status: "error",
      error: "tmux 不可用。请确保已安装 tmux (brew install tmux)。",
    };
  }

  const taskId = generateTaskId();
  const branchName = `feat/zoe-${taskId}`;
  const worktreeDir = path.join(repo_path, ".worktrees", `task-${taskId}`);
  const tmuxSession = `zoe-${taskId}`;

  try {
    // 1. 创建 git worktree
    run(`git worktree add "${worktreeDir}" -b ${branchName} origin/${branch_base}`, repo_path);

    // 2. 写入 TASK.md
    const taskMd = `# 任务\n\n${task_description}`;
    fs.writeFileSync(path.join(worktreeDir, "TASK.md"), taskMd, "utf-8");

    // 3. 复制 CLAUDE.md.template → CLAUDE.md
    // 修正 Windows 路径（file:///D:/... → D:/...）
    let templateDir = TEMPLATE_DIR;
    if (process.platform === "win32" && templateDir.startsWith("/")) {
      templateDir = templateDir.substring(1);
    }
    const templatePath = path.join(templateDir, "CLAUDE.md.template");
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, path.join(worktreeDir, "CLAUDE.md"));
    }

    // 4. 注册任务
    const taskInfo: TaskInfo = {
      task_id: taskId,
      repo_path,
      worktree_path: worktreeDir,
      branch_name: branchName,
      tmux_session: tmuxSession,
      status: "starting",
      started_at: new Date().toISOString(),
    };
    activeTasks.set(taskId, taskInfo);
    persistTasks(repo_path);

    // 5. 启动 tmux session + Claude Code
    const claudeCmd = `claude -p "请阅读 TASK.md 并完成任务。完成后创建 PR。" --dangerously-skip-permissions`;
    run(`tmux new-session -d -s ${tmuxSession} -c "${worktreeDir}"`);
    run(`tmux send-keys -t ${tmuxSession} '${claudeCmd}' Enter`);

    // 6. 更新状态
    taskInfo.status = "running";
    activeTasks.set(taskId, taskInfo);
    persistTasks(repo_path);

    // 7. 启动 PR 检测轮询
    startPrPolling(taskId, branchName, repo_path);

    return {
      task_id: taskId,
      worktree_path: worktreeDir,
      branch_name: branchName,
      status: "started",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 清理：如果 worktree 已创建但后续失败
    try {
      if (fs.existsSync(worktreeDir)) {
        run(`git worktree remove "${worktreeDir}" --force`, repo_path);
      }
    } catch {
      // 清理失败不影响错误返回
    }

    // 清理 tmux session
    try {
      run(`tmux kill-session -t ${tmuxSession}`);
    } catch {
      // session 可能不存在
    }

    return {
      task_id: taskId,
      worktree_path: worktreeDir,
      branch_name: branchName,
      status: "error",
      error: errorMsg,
    };
  }
}
