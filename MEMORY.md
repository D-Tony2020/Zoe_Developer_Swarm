# Zoe Developer Swarm — A2A 交接记忆

**最后更新**：2026-03-07
**交接源**：Windows 11 上的 Claude Code 开发会话
**交接目标**：Mac Mini 上的 Claude Code 继续开发

---

## 一、项目是什么

Zoe 是 **OpenClaw 生态内的原生 Agent**，复现 Elvis Sun 的"一人开发团队"范式。

**核心链路**：
```
用户（手机 Telegram）
  → 自然语言 → Zoe（OpenClaw Agent，业务大脑）
  → 精确 TASK.md → Claude Code（施工队，tmux + git worktree 隔离）
  → PR → 用户 review → merge
```

**关键原则**：Context Window 分层隔离——Zoe 持有业务上下文不写代码，施工队只接收技术规范不持有业务上下文。

---

## 二、项目当前状态

### 已完成（Phase 1-3）

| 组件 | 状态 | 说明 |
|------|------|------|
| `workspace-zoe/` | ✅ 完成 | SOUL.md, AGENTS.md, USER.md（模板）, TOOLS.md, IDENTITY.md, HEARTBEAT.md, skills/ |
| `mcp-tools/` | ✅ 完成，TypeScript 零错误 | index.ts, spawn_coder.ts, list_tasks.ts, cancel_task.ts, types.ts |
| `templates/CLAUDE.md.template` | ✅ 完成 | 施工队安全约束 |
| `scripts/` | ✅ 完成 | setup.sh, test-manual.sh, check-agents.sh |
| OpenClaw 源码分析 | ✅ 完成 | v2026.3.3 架构完全理解 |

### 未完成（Phase 4，Mac 上执行）

- [ ] 克隆 OpenClaw 源码到 Mac 并构建
- [ ] 运行 `scripts/setup.sh` 安装依赖
- [ ] 配置 `~/.openclaw/openclaw.json`（添加 Zoe Agent + bindings）
- [ ] 运行 `scripts/test-manual.sh` 验证基础链路
- [ ] 端到端测试：tmux + worktree + Claude Code → PR
- [ ] 可选：配置 Telegram Bot 集成
- [ ] 用户填写 `workspace-zoe/USER.md`

---

## 三、关键架构决策（已确认）

1. **Zoe 是 OpenClaw 原生 Agent**，不是独立外部项目
   - 通过 `openclaw.json` 的 `agents.list` 注册
   - workspace 目录持有人格和上下文
   - MCP 工具通过 `tools.mcp.servers` 挂载

2. **认证方式：Max 订阅优先**
   - 施工队（Claude Code CLI）用 Max 订阅认证，不需要 API Key
   - 已知风险：多实例 OAuth 竞态（[Issue #27933](https://github.com/anthropics/claude-code/issues/27933)）
   - MVP 阶段并发低不触发，高并发时 fallback 到 API Key

3. **修改 OpenClaw 源码需要向用户报告**
   - 能用配置/workspace/MCP 解决的不改源码
   - 必须改时说明原因和替代方案

4. **sessions_spawn 是 tmux 的潜在升级路径**
   - OpenClaw 原生支持隔离子会话
   - MVP 保留 tmux（更透明可调试）

---

## 四、用户确认的信息

| 项目 | 确认结果 |
|------|---------|
| 认证 | Claude Max 订阅，CLI 已登录 |
| GitHub CLI | 已安装已认证 |
| Telegram | 先跳过，核心链路优先 |
| Mac 迁移 | 几天内 |
| 目标仓库 | 新建测试仓库 |
| 施工队权限 | `--dangerously-skip-permissions` + CLAUDE.md 约束 |

---

## 五、OpenClaw 框架关键知识

### Agent 注册（openclaw.json）
```json5
{
  agents: {
    list: [{
      id: "zoe",
      name: "Zoe",
      workspace: "<path>/workspace-zoe",
      model: { primary: "anthropic/claude-opus-4-6" },
      identity: { name: "Zoe", emoji: "🔧" },
      tools: {
        mcp: {
          servers: [{
            name: "zoe-tools",
            command: "node",
            args: ["<path>/mcp-tools/dist/index.js"]
          }]
        }
      }
    }]
  }
}
```

### Workspace 文件加载顺序
AGENTS.md → SOUL.md → TOOLS.md → IDENTITY.md → USER.md → HEARTBEAT.md → MEMORY.md（主会话）→ memory/日期.md

### OpenClaw 关键源码路径
- Agent 配置解析：`src/agents/agent-scope.ts`
- Workspace 加载：`src/agents/workspace.ts`
- 工具注册：`src/agents/openclaw-tools.ts`
- sessions_send：`src/agents/tools/sessions-send-tool.ts`
- sessions_spawn：`src/agents/tools/sessions-spawn-tool.ts`
- Skills 系统：`docs/tools/skills.md`
- 多 Agent 文档：`docs/concepts/multi-agent.md`

### OpenClaw 构建注意
- 使用 pnpm，Mac 上直接 `pnpm install && pnpm run build`
- Windows 需要 `PNPM_HOME="D:/.pnpm"` 环境变量解决跨盘链接
- A2UI Canvas 在 Windows 无法打包（bash 脚本依赖），核心编译正常

---

## 六、MCP 工具架构

```
mcp-tools/
├── index.ts          → MCP Server 入口（stdio transport）
├── spawn_coder.ts    → worktree + TASK.md + tmux + Claude Code + PR 轮询
├── list_tasks.ts     → 查询活跃任务 + tmux session 存活检测
├── cancel_task.ts    → 终止 tmux + 清理 worktree + 删远端分支
└── types.ts          → TaskInfo, activeTasks Map, MAX_CONCURRENT_AGENTS=4
```

任务注册表持久化到 `<repo>/.openclaw/active-tasks.json`。

---

## 七、参考链接

- [Elvis Sun 原帖](https://x.com/elvissun/status/2025920521871716562)
- [详细文章](https://dailykoin.com/ai-agent-swarm/)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [多 Agent Pipeline 实践](https://dev.to/ggondim/how-i-built-a-deterministic-multi-agent-dev-pipeline-inside-openclaw-and-contributed-a-missing-4ool)
- [OAuth 竞态 Issue](https://github.com/anthropics/claude-code/issues/27933)

---

*本文件作为 A2A 交接记忆，新会话启动时优先读取此文件。*
