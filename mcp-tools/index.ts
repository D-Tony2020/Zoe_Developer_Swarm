/**
 * Zoe MCP Tools — MCP Server 入口
 *
 * 提供三个工具：
 * - spawn_coder: 启动 Claude Code 施工队
 * - list_tasks: 查询活跃任务状态
 * - cancel_task: 取消任务并清理
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { spawnCoder } from "./spawn_coder.js";
import { listTasks } from "./list_tasks.js";
import { cancelTask } from "./cancel_task.js";

const server = new Server(
  {
    name: "zoe-tools",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 注册工具列表
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "spawn_coder",
        description:
          "启动 Claude Code 施工队。在隔离的 git worktree 中创建分支、写入任务规范、启动 Claude Code 自动执行。完成后自动创建 PR。",
        inputSchema: {
          type: "object" as const,
          properties: {
            task_description: {
              type: "string",
              description:
                "任务描述（TASK.md 内容）。必须包含：任务目标、具体要求、验收标准、禁止事项。",
            },
            repo_path: {
              type: "string",
              description: "目标 git 仓库的本地绝对路径。",
            },
            branch_base: {
              type: "string",
              description: '基础分支名，默认 "main"。',
              default: "main",
            },
          },
          required: ["task_description", "repo_path"],
        },
      },
      {
        name: "list_tasks",
        description:
          "查询当前所有活跃的施工队任务状态。返回每个任务的 ID、状态、分支名、运行时长和 PR URL。",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "cancel_task",
        description:
          "取消一个正在运行的施工队任务。会终止 tmux session、清理 git worktree、删除远端分支。",
        inputSchema: {
          type: "object" as const,
          properties: {
            task_id: {
              type: "string",
              description: "要取消的任务 ID。可通过 list_tasks 获取。",
            },
          },
          required: ["task_id"],
        },
      },
    ],
  };
});

/**
 * 处理工具调用
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "spawn_coder": {
      const input = args as {
        task_description: string;
        repo_path: string;
        branch_base?: string;
      };

      if (!input.task_description || !input.repo_path) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                error: "缺少必填参数: task_description 和 repo_path",
              }),
            },
          ],
        };
      }

      const result = await spawnCoder(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    case "list_tasks": {
      const tasks = listTasks();
      const summary =
        tasks.length === 0
          ? "当前没有活跃的施工队任务。"
          : `当前有 ${tasks.length} 个任务：\n${JSON.stringify(tasks, null, 2)}`;

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    }

    case "cancel_task": {
      const input = args as { task_id: string };
      if (!input.task_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "error", error: "缺少必填参数: task_id" }),
            },
          ],
        };
      }

      const result = cancelTask(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "error", error: `未知工具: ${name}` }),
          },
        ],
      };
  }
});

/**
 * 启动 MCP Server
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[zoe-tools] MCP Server 已启动，等待连接...");
}

main().catch((err) => {
  console.error("[zoe-tools] 启动失败:", err);
  process.exit(1);
});
