# 项目交接文档：Zoe —— OpenClaw + Claude Code 编排层

**文档版本**：v1.0  
**日期**：2026-03-07  
**交接对象**：Claude Code（自主开发执行）  
**项目状态**：从零开始，独立项目，与 MAOS 无关  

---

## 一、项目定位与目标

### 1.1 一句话描述

> 构建一个名为 **Zoe** 的 OpenClaw Agent，使其能够接收用户通过 Telegram/WhatsApp 发送的自然语言开发指令，自动将其转化为结构化任务规范，并调度 Claude Code / Codex 在隔离的 git worktree 中并行执行，完成后通过 PR 汇报结果。

### 1.2 灵感来源与范式

本项目完整复现并工程化 Elvis Sun（[@elvissun](https://x.com/elvissun/status/2025920521871716562)）在 X 上分享的"一人开发团队"范式。

**核心洞见（必须理解，影响所有架构决策）：**

Claude Code 和 Codex 的 context window 是零和资源。当一个 Agent 同时持有"业务背景"和"如何写代码"两类信息时，两者都会退化。正确的做法是**分层隔离**：

- **Zoe（OpenClaw Agent）**：持有全量业务上下文，负责意图理解和任务转化，**不写代码**
- **Claude Code 施工队**：只接收精确的技术任务规范，**不持有业务上下文**

```
你（手机）
  → [自然语言] → Zoe（OpenClaw，业务大脑）
  → [精确 TASK.md] → Claude Code Lead（施工队长）
    → [git worktree 隔离] → Teammate 1/2/3（并行施工）
  → [PR] → 你 review → merge
```

### 1.3 成功标准

- [ ] 用户发 Telegram 消息："帮我在 src/ 下加一个 hello.ts 文件"
- [ ] Zoe 自动理解、生成 TASK.md、启动 Claude Code
- [ ] Claude Code 在独立 worktree 内完成代码、commit、push、创建 PR
- [ ] Zoe 通过 Telegram 把 PR 链接发回给用户
- [ ] 全程用户不需要打开代码编辑器

---

## 二、技术栈与工具选型

### 2.1 确定选型

| 组件 | 选型 | 理由 |
|---|---|---|
| 对话网关 / Orchestrator | **OpenClaw**（最新稳定版 2026.3.x） | 提供多渠道接入、Agent 持久化、MCP 工具框架、热重载，零成本拿到 Telegram/WhatsApp 集成 |
| 编码 Agent | **Claude Code CLI**（`claude` 命令） | 原生 git worktree 支持，Agent Teams 实验性功能，Anthropic 官方 |
| 备选编码 Agent | **Codex CLI**（可选，用于 billing 类任务）| 与 Claude Code 互补，Zoe 可按任务类型路由 |
| 任务隔离机制 | **git worktree** | 每个 Agent 独立目录和 branch，原生支持，无冲突 |
| 进程管理 | **tmux** | 每个 Claude Code 实例跑在独立 tmux pane，便于监控和调试 |
| 工具桥接 | **MCP Tool（Node.js/TypeScript）** | OpenClaw 原生支持 MCP，`spawn_coder` 工具通过 MCP 协议注册 |
| 业务上下文存储 | **Markdown 文件（workspace/）** | OpenClaw workspace 目录下的 .md 文件自动注入 Agent 的 system prompt |
| PR 检测 | **git log 轮询** | 轻量，无需额外依赖 |
| 通知回传 | **OpenClaw sessions_send RPC** | Zoe 通过这个 RPC 把结果发回原始对话 |

### 2.2 明确排除的选型

- ❌ **Redis / 外部消息队列**：项目规模不需要，SQLite 或文件轮询足够
- ❌ **WASM Sandbox**：工具隔离通过 git worktree + CLAUDE.md 约束实现，无需 WASM
- ❌ **Agent Teams（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）**：目前是实验性 feature，作为可选增强，MVP 不依赖
- ❌ **Docker 容器隔离**：worktree 隔离已满足文件系统隔离需求，Docker 是过度工程

### 2.3 运行环境要求

```
Node.js >= 22
npm >= 10
git（支持 worktree，git >= 2.15）
tmux >= 3.0
claude CLI（最新版，通过 npm install -g @anthropic-ai/claude-code 安装）
openclaw（最新版，通过 npm install -g openclaw 安装）
```

---

## 三、项目目录结构

```
zoe-orchestrator/
│
├── README.md                    # 项目说明
├── package.json
├── tsconfig.json
│
├── mcp-tools/                   # MCP 工具实现（核心代码）
│   ├── spawn_coder.ts           # 主工具：启动 Claude Code 施工队
│   ├── list_tasks.ts            # 查询当前活跃任务状态
│   └── cancel_task.ts           # 取消任务并清理 worktree
│
├── openclaw-config/             # OpenClaw 配置文件
│   ├── zoe-agent.json5          # Zoe Agent 配置（model, tools, workspace）
│   └── config.patch.example    # config.patch RPC 示例（用于集成到 openclaw.json）
│
├── workspace/                   # Zoe 的业务上下文文件（注入 system prompt）
│   ├── SOUL.md                  # Zoe 的角色定义和核心原则
│   ├── USER.md                  # 项目/业务上下文（用户填写）
│   ├── AGENTS.md                # spawn_coder 的使用规则和示例
│   └── TOOLS.md                 # 可用工具描述
│
├── templates/                   # 任务模板
│   └── CLAUDE.md.template       # 注入施工 worktree 的安全约束文件
│
├── scripts/
│   ├── setup.sh                 # 一键初始化脚本
│   └── test-manual.sh           # 手动验证脚本（不依赖 OpenClaw）
│
└── docs/
    └── architecture.md          # 详细架构文档
```

---

## 四、核心组件详细规格

### 4.1 `spawn_coder.ts`（最核心，唯一需要写的业务逻辑）

**MCP Tool 定义：**

```typescript
// Tool 名称：spawn_coder
// 触发时机：Zoe 理解用户意图后，调用此工具启动施工队
// 输入参数：
{
  task_description: string,  // 任务描述（Zoe 生成的精确技术规范）
  repo_path: string,         // 目标 git 仓库的本地路径
  branch_base?: string,      // 基础分支，默认 "main"
  budget_usd?: number,       // 费用上限（美元），默认 20
  agent?: "claude" | "codex" // 使用哪个编码 Agent，默认 "claude"
}

// 输出：
{
  task_id: string,           // 本次任务唯一 ID（用于查询状态）
  worktree_path: string,     // worktree 目录路径
  branch_name: string,       // 创建的 git branch 名
  tmux_session: string,      // tmux session 名称
  status: "started" | "error"
}
```

**内部执行流程（按序）：**

```
1. 生成 task_id（timestamp + 随机4位）
2. 创建 git worktree：
   git worktree add <repo_path>/.worktrees/task-<task_id> -b feat/task-<task_id> origin/<branch_base>
3. 写入 TASK.md 到 worktree 根目录（包含 task_description）
4. 从 templates/CLAUDE.md.template 复制 CLAUDE.md 到 worktree 根目录
5. 启动 tmux session：
   tmux new-session -d -s zoe-<task_id> -c <worktree_path>
6. 在 tmux 中启动 Claude Code：
   tmux send-keys -t zoe-<task_id> "claude --dangerously-skip-permissions" Enter
   # 注意：--dangerously-skip-permissions 在有 CLAUDE.md 约束时才可接受
7. 启动后台轮询进程（setInterval，每 30 秒）：
   检测 worktree branch 是否有新 commit
   检测是否存在对应的 GitHub PR（通过 gh pr list --head feat/task-<task_id>）
   PR 出现后：调用 OpenClaw sessions_send RPC，把 PR URL 发回给 Zoe
8. 返回 task metadata
```

**费用保护逻辑：**

```typescript
// 在轮询中检查运行时长
// 超过 budget_usd 对应的预估时长（$20 ≈ 45分钟）时发出警告
// 超过 2x 预估时长时强制终止 tmux session
```

### 4.2 `workspace/SOUL.md`（Zoe 的人格定义）

```markdown
# Zoe - 工程助手

你是 Zoe，一个专注于软件工程任务调度的 AI 助手。

## 你的核心职责
1. **理解意图**：把用户的自然语言描述转化为精确的技术任务规范
2. **上下文注入**：在生成任务规范时，自动将 USER.md 中的项目背景融入 prompt
3. **任务派发**：调用 spawn_coder 工具启动 Claude Code 施工队
4. **进度汇报**：收到 PR 通知后，用清晰简洁的语言告诉用户

## 你不做的事
- 你不直接写代码
- 你不猜测用户的意图，不清楚时主动追问
- 你不在没有用户确认的情况下发起超过 $20 的任务

## 任务规范的格式
当你生成 TASK.md 时，必须包含：
- 任务目标（一句话）
- 具体要求（bullet list）
- 验收标准（怎么判断完成了）
- 禁止事项（不能修改哪些文件/目录）
```

### 4.3 `templates/CLAUDE.md.template`（施工队安全约束）

```markdown
# 任务约束（必须遵守）

## Git 规则
- 永远不要 push 到 main 或 master branch
- 完成后必须创建 PR，PR 标题格式：`[Zoe] <简短描述>`
- PR description 必须包含：变更摘要、测试方法、影响范围

## 文件访问规则
- 禁止读取：`credentials/`、`.env`、`*.key`、`*.pem` 等凭证文件
- 禁止修改：`package-lock.json` 之外的 lock 文件（除非任务明确要求）

## 任务执行规则
- 先读取 TASK.md，完全理解任务后再开始编码
- 遇到架构层面的不确定性，创建 `QUESTIONS.md` 而不是自作主张
- 每次 commit 前必须运行测试（如果项目有测试）

## 完成标志
- 所有变更已 commit
- PR 已创建并推送到远端
- 在最后一条 commit message 中写入 `[DONE]` 标志
```

### 4.4 OpenClaw Agent 配置

```json5
// openclaw-config/zoe-agent.json5
// 这是 Zoe Agent 的配置，需要合并到用户的 ~/.openclaw/openclaw.json
{
  agents: {
    list: [
      {
        id: "zoe",
        default: false,
        identity: {
          name: "Zoe",
          emoji: "🔧",
          theme: "precise engineering coordinator"
        },
        workspace: "./workspace",  // 指向本项目的 workspace/ 目录
        model: {
          primary: "anthropic/claude-opus-4-6",  // Zoe 需要强推理能力
          fallbacks: ["anthropic/claude-sonnet-4-6"]
        },
        tools: {
          mcp: {
            servers: [
              {
                name: "zoe-tools",
                command: "node",
                args: ["./mcp-tools/index.js"]
              }
            ]
          }
        }
      }
    ]
  },
  bindings: [
    // 示例：把特定 Telegram 群绑定到 Zoe
    // 用户自行配置 channel 和 peer
    {
      agentId: "zoe",
      match: {
        channel: "telegram",
        peer: { kind: "group", id: "YOUR_GROUP_ID" }
      }
    }
  ]
}
```

---

## 五、已知约束与风险（必须在实现中处理）

### 5.1 OpenClaw config.patch 速率限制

**事实**：OpenClaw 控制平面写 RPC（`config.apply`、`config.patch`）被限速为**每 deviceId+clientIp 每 60 秒最多 3 次**。

**影响**：本项目中 `spawn_coder` 不依赖 `config.patch`，而是直接通过 CLI 操作 git 和 tmux，**此限制不影响本项目**。但如果后续扩展为动态 Agent 管理，需要注意这个限制。

### 5.2 硬件内存上限

**事实**：每个 Claude Code 实例需要独立 worktree，每个 worktree 需要独立的 `node_modules`，且会同时运行 TypeScript 编译器和测试。

**实测数据**：16GB RAM 的 Mac Mini 大约支持 4-5 个并发 Agent，超过后开始内存交换，性能急剧下降。

**处理方式**：
- `list_tasks.ts` 工具需要检查当前活跃 tmux session 数量
- 超过 `MAX_CONCURRENT_AGENTS`（默认 4）时，`spawn_coder` 拒绝新任务并告知用户

### 5.3 Claude Code OAuth Token 限制

**事实**：2026 年 1 月 9 日起，Anthropic 封锁了在 Claude Code 之外使用 Claude Max 订阅的 OAuth Token。通过第三方工具（包括 OpenClaw）调用 Claude Code 时，**必须使用 API Key，不能用订阅 Token**。

**处理方式**：`spawn_coder` 在启动 Claude Code 时，通过环境变量注入 API Key：

```typescript
tmux send-keys -t zoe-<task_id> 
  `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} claude --dangerously-skip-permissions`
  Enter
```

### 5.4 Prompt Injection 风险

**事实**：IDEsaster 事件（2025 年 12 月）记录了 AI IDE 生态中大量 Prompt Injection 漏洞。恶意内容可通过 README、代码注释等方式注入 Claude Code 的 context，导致非预期行为。

**缓解措施**（已在 CLAUDE.md.template 中体现）：
- Claude Code 只接触目标 repo 的代码，不接触 Zoe 的业务上下文
- CLAUDE.md 明确禁止访问凭证文件
- PR 门控：所有变更需要人工 review 才能合并

---

## 六、开发优先级与 MVP 范围

### Phase 1：手动验证（Day 0，做之前先跑）

在写任何代码之前，手动验证以下链路：

```bash
# 测试脚本：scripts/test-manual.sh
# 1. 创建测试 repo
mkdir /tmp/test-repo && cd /tmp/test-repo && git init && git commit --allow-empty -m "init"

# 2. 手动创建 worktree
git worktree add .worktrees/task-001 -b feat/task-001

# 3. 写任务文件
echo "请创建 src/hello.ts，内容为 console.log('hello from Zoe')" > .worktrees/task-001/TASK.md
cp <project>/templates/CLAUDE.md.template .worktrees/task-001/CLAUDE.md

# 4. 手动启动 Claude Code
cd .worktrees/task-001 && claude

# 5. 验证：Claude Code 是否能独立读取 TASK.md 并完成任务
```

**只有这个手动流程跑通，才进入 Phase 2。**

### Phase 2：spawn_coder 工具（核心，Day 1-2）

- 实现 `mcp-tools/spawn_coder.ts` 的完整逻辑
- 实现 PR 检测轮询（使用 `gh` CLI，需要用户提前配置 GitHub CLI）
- 实现 OpenClaw 回调（通过 `sessions_send` RPC）
- 编写 `mcp-tools/index.ts`（MCP server 入口）

### Phase 3：Zoe workspace 配置（Day 2-3）

- 完善 `workspace/SOUL.md`（根据测试中 Zoe 的实际行为迭代）
- 完善 `workspace/AGENTS.md`（加入 spawn_coder 的使用示例和注意事项）
- 完善 `workspace/USER.md`（提供模板，用户填写自己的项目上下文）

### Phase 4：OpenClaw 集成与安装脚本（Day 3-4）

- 实现 `scripts/setup.sh`：检查依赖、注册 MCP Tool、合并 OpenClaw 配置
- 编写 README 的快速开始部分
- 端到端测试：从 Telegram 消息到 PR 创建全链路

### ❌ 不在 MVP 范围内

- Codex 集成（仅 Claude Code，Codex 作为后续扩展）
- Web Dashboard
- 费用精确统计
- Agent Teams（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）
- 任何 MAOS 相关功能

---

## 七、参考资料

### 原始范式来源

- **Elvis Sun 的原帖**：https://x.com/elvissun/status/2025920521871716562
- **详细文章**：https://dailykoin.com/ai-agent-swarm/

### OpenClaw 文档

- **配置参考**：https://docs.openclaw.ai/gateway/configuration
- **Multi-Agent**：https://docs.openclaw.ai/agents/multi-agent
- **MCP 工具集成**：https://docs.openclaw.ai/tools/mcp
- **config RPC 参考**：https://deepwiki.com/openclaw/openclaw/2.3-configuration

### Claude Code 文档

- **Agent Teams 官方文档**：https://code.claude.com/docs/en/agent-teams
- **Worktree 支持（2026.02.21）**：https://www.threads.com/@boris_cherny/post/DVAAnexgRUj/
- **并行 Agent 工作流**：https://www.verdent.ai/guides/how-to-run-parallel-claude-code-agents

### 社区实践参考

- **OpenClaw + Agent Teams 实战**：https://jangwook.net/en/blog/en/claude-agent-teams-guide/
- **确定性 Multi-Agent 管道**：https://dev.to/ggondim/how-i-built-a-deterministic-multi-agent-dev-pipeline-inside-openclaw-and-contributed-a-missing-4ool
- **C 编译器 16-Agent 实验**（规模参考）：https://www.anthropic.com/engineering/building-c-compiler

### 安全背景

- **IDEsaster 披露**：记录了 AI IDE 生态 30+ 漏洞，100% 被测 IDE 存在 Prompt Injection 风险（2025 年 12 月）
- **MCP Tool Poisoning**：GitHub MCP Server 被劫持案例，通过 poisoned issue 泄露私有仓库内容

---

## 八、给 Claude Code 的开发指令

**以下是你（Claude Code）收到本文档后应该做的第一件事：**

```
1. 阅读完整文档，特别是第五节"已知约束"
2. 执行 Phase 1 的手动验证脚本，确认基础链路可行
3. 按以下顺序创建文件：
   a. package.json + tsconfig.json
   b. templates/CLAUDE.md.template
   c. workspace/SOUL.md + AGENTS.md + USER.md（模板版）
   d. mcp-tools/spawn_coder.ts（核心）
   e. mcp-tools/list_tasks.ts
   f. mcp-tools/cancel_task.ts
   g. mcp-tools/index.ts（MCP server 入口）
   h. openclaw-config/zoe-agent.json5
   i. scripts/setup.sh
   j. README.md

4. 每完成一个文件，运行对应的类型检查（tsc --noEmit）
5. 完成后创建 PR，PR description 必须包含：
   - 实际实现与本文档的差异说明
   - 手动验证结果截图/输出
   - 已知遗留问题列表
```

**如果遇到本文档未覆盖的技术决策点，优先选择更简单的方案，并在 PR description 中记录决策原因。**

---

*本文档由架构设计会话生成，版本 v1.0，2026-03-07*
