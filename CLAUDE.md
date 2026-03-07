# OpenClaw + Zoe 项目开发规范

始终使用简体中文回复。

## 项目概述

Zoe 是 **OpenClaw 生态内的原生 Agent**，遵循 Elvis Sun 的"一人开发团队"范式。
OpenClaw 是编排层本体，Zoe 在其框架内作为一个注册 Agent 运行，通过 workspace 文件持有业务上下文，通过 skills 和 MCP 工具调度 Claude Code 施工队。

**不是**独立的外部项目，**而是** OpenClaw 生态的一部分。

## 新会话启动

**首次接触本项目时，先读 `MEMORY.md`**——它包含完整的项目上下文、架构决策和当前状态。

## 核心原则

### 1. 在 OpenClaw 框架内开发

- Zoe 通过 `openclaw.json` 的 `agents.list` 注册
- Zoe 的人格和业务上下文通过 workspace 目录下的 SOUL.md / AGENTS.md / USER.md 注入
- 工具以 OpenClaw 原生方式集成（skills + MCP servers）
- 消息路由通过 `bindings` 配置
- Agent 间通信使用 `sessions_send` / `sessions_spawn`

### 2. 修改或扩展 OpenClaw 架构需要报告

如果在开发过程中发现需要：
- 修改 OpenClaw 源码（`OpenClaw/src/` 下的文件）
- 新增 OpenClaw 不支持的机制
- 绕过 OpenClaw 的原生工作流

**必须先向用户报告并获得批准**，说明：
- 要改什么
- 为什么框架内现有机制不够用
- 有无替代方案

### 3. 技术约束

- 语言：TypeScript（ESM 模块），与 OpenClaw 保持一致
- 运行时：Node.js ≥ 22
- 包管理：pnpm
- MCP 工具通过 `tools.mcp.servers` 配置注册到 Zoe Agent
- Skills 放在 Zoe 的 workspace/skills/ 目录下
- 路径处理：使用 `path.join()` 确保跨平台兼容

### 4. 安全约束

- 禁止在代码中硬编码任何 API Key、Token 或凭证
- 所有敏感信息通过环境变量注入
- 施工队的 CLAUDE.md 安全规则不可弱化
- PR 门控是最后防线，不能绕过

## 环境配置（macOS）

```bash
# 前置依赖
brew install tmux
npm install -g pnpm @anthropic-ai/claude-code
gh auth login

# 项目初始化
git clone https://github.com/D-Tony2020/Zoe_Developer_Swarm.git
cd Zoe_Developer_Swarm

# OpenClaw 源码（用于参考和运行）
git clone https://github.com/openclaw/openclaw.git OpenClaw
cd OpenClaw && pnpm install && pnpm run build && cd ..

# MCP 工具
cd mcp-tools && npm install && npm run build && cd ..

# 一键验证
chmod +x scripts/*.sh
./scripts/setup.sh
```

## 目录结构

```
Zoe_Developer_Swarm/
├── OpenClaw/                              # OpenClaw 源码（git clone，不提交到本仓库）
│
├── workspace-zoe/                         # Zoe Agent 的 workspace 目录
│   ├── AGENTS.md                          # 操作指令
│   ├── SOUL.md                            # 角色定义
│   ├── USER.md                            # 用户上下文（需填写）
│   ├── TOOLS.md                           # 工具描述
│   ├── IDENTITY.md                        # 身份信息
│   ├── HEARTBEAT.md                       # 定期检查
│   ├── memory/                            # 日期记忆
│   └── skills/spawn-coder/SKILL.md        # Skill 定义
│
├── mcp-tools/                             # MCP Server（TypeScript）
│   ├── index.ts                           # 入口
│   ├── spawn_coder.ts                     # 核心工具
│   ├── list_tasks.ts                      # 查询任务
│   ├── cancel_task.ts                     # 取消任务
│   └── types.ts                           # 类型定义
│
├── templates/CLAUDE.md.template           # 施工队安全约束
├── scripts/                               # 安装 / 验证 / 监控脚本
│
├── MEMORY.md                              # ★ A2A 交接记忆（新会话先读这个）
├── CLAUDE.md                              # 本文件
├── ZOE_HANDOFF.md                         # 原始架构设计交接文档
└── ZOE_DEV_REPORT.md                      # 开发报告 v0.3
```

## OpenClaw 配置参考

Zoe 在 `~/.openclaw/openclaw.json` 中的注册方式：

```json5
{
  agents: {
    list: [
      {
        id: "zoe",
        name: "Zoe",
        default: false,
        workspace: "~/Zoe_Developer_Swarm/workspace-zoe",
        model: { primary: "anthropic/claude-opus-4-6" },
        identity: { name: "Zoe", emoji: "🔧" },
        tools: {
          mcp: {
            servers: [{
              name: "zoe-tools",
              command: "node",
              args: ["~/Zoe_Developer_Swarm/mcp-tools/dist/index.js"]
            }]
          }
        }
      }
    ]
  },
  bindings: [
    { agentId: "zoe", match: { channel: "telegram", peer: { kind: "group", id: "YOUR_GROUP_ID" } } }
  ]
}
```

## 架构变更日志

| 日期 | 变更 | 原因 | 用户批准 |
|------|------|------|---------|
| 2026-03-07 | 初始创建 | 项目启动 | - |
| 2026-03-07 | 从"外部独立项目"改为"OpenClaw 生态内原生 Agent" | 用户纠正，符合 Elvis Sun 原始范式 | ✅ |
| 2026-03-07 | 认证策略：Max 订阅优先，API Key 作为 fallback | 施工队是原生 claude CLI，订阅适用 | ✅ |

## 关键参考

- Elvis Sun 原帖：https://x.com/elvissun/status/2025920521871716562
- 详细文章：https://dailykoin.com/ai-agent-swarm/
- OpenClaw GitHub：https://github.com/openclaw/openclaw
- OpenClaw Agent 配置：`OpenClaw/src/agents/agent-scope.ts`
- OpenClaw workspace 加载：`OpenClaw/src/agents/workspace.ts`
- sessions_send：`OpenClaw/src/agents/tools/sessions-send-tool.ts`
- sessions_spawn：`OpenClaw/src/agents/tools/sessions-spawn-tool.ts`
- Skills 文档：`OpenClaw/docs/tools/skills.md`
- 多 Agent 文档：`OpenClaw/docs/concepts/multi-agent.md`
