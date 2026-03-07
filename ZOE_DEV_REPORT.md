# Zoe 开发报告

**版本**：v0.3
**日期**：2026-03-07
**作者**：Claude Code
**状态**：架构评审 + 开发路线图

---

## 一、项目理解

### 1.1 一句话

Zoe 是 OpenClaw 生态内的一个原生 Agent，复现 Elvis Sun 的"一人开发团队"范式——通过 Telegram/WhatsApp 接收自然语言指令，调度 Claude Code 施工队在隔离 worktree 中并行执行，完成后通过 PR 汇报。

### 1.2 核心架构原则：Context Window 分层隔离

| 层级 | 角色 | 持有信息 | 不做的事 |
|------|------|---------|---------|
| **Zoe（OpenClaw Agent）** | 业务大脑 | 全量业务上下文、用户意图、项目背景 | 不写代码 |
| **Claude Code 施工队** | 编码执行 | 精确的 TASK.md 技术规范 | 不持有业务上下文 |

这是 Elvis Sun 的关键洞见：context window 是零和资源，混杂业务和代码两类信息会导致两者都退化。

### 1.3 Elvis Sun 原始范式验证

通过 [dailykoin.com 文章](https://dailykoin.com/ai-agent-swarm/) 确认的实际做法：

- **OpenClaw 就是编排层本身**，Zoe 在其中作为注册 Agent 运行
- 每个施工队在**独立 tmux session + git worktree** 中运行
- 任务注册在 `.openclaw/active-tasks.json`
- 监控通过 cron 脚本（每 10 分钟检查一次）
- 施工完成后通过 `gh pr create --fill` 创建 PR
- 产出实测：94 commits/天，7 PRs/30 分钟，月成本 ~$190

---

## 二、开发方式：在 OpenClaw 框架内

### 2.1 Zoe 不是独立项目

**错误做法**（已弃用）：创建 `zoe/` 独立目录，有自己的 package.json，把 OpenClaw 当作外部依赖。

**正确做法**：
- Zoe 通过 `openclaw.json` 的 `agents.list` 注册
- workspace 目录（`workspace-zoe/`）持有 Zoe 的人格和上下文
- MCP 工具通过 `tools.mcp.servers` 挂载到 Zoe Agent
- 消息路由通过 `bindings` 配置
- 如需修改 OpenClaw 架构，向用户报告

### 2.2 OpenClaw 原生 Agent 创建流程

OpenClaw 框架提供的标准 Agent 开发模式：

```
步骤 1：openclaw agents add zoe          # 交互式注册
步骤 2：创建 workspace-zoe/ 目录           # 放置 SOUL.md, AGENTS.md 等
步骤 3：在 openclaw.json 中配置 bindings    # 路由 Telegram 消息到 Zoe
步骤 4：注册 MCP 工具                      # spawn_coder 等
步骤 5：启动 openclaw gateway              # 开始运行
```

### 2.3 openclaw.json 中的 Zoe 配置

```json5
{
  agents: {
    list: [
      {
        id: "zoe",
        name: "Zoe",
        default: false,
        workspace: "<absolute-path>/OpenClaw+Zoe/workspace-zoe",
        model: { primary: "anthropic/claude-opus-4-6" },
        identity: { name: "Zoe", emoji: "🔧" },
        tools: {
          mcp: {
            servers: [{
              name: "zoe-tools",
              command: "node",
              args: ["<absolute-path>/OpenClaw+Zoe/mcp-tools/index.js"]
            }]
          }
        }
      }
    ]
  },
  bindings: [
    {
      agentId: "zoe",
      match: { channel: "telegram", peer: { kind: "group", id: "<GROUP_ID>" } }
    }
  ]
}
```

---

## 三、OpenClaw 框架能力评估

### 3.1 版本

已克隆 OpenClaw **v2026.3.3**，依赖安装成功，核心 TypeScript 编译通过（335 文件，10.23 MB）。

### 3.2 框架能力对照

| 需要的能力 | OpenClaw 支持情况 | 备注 |
|-----------|-----------------|------|
| 多渠道接入 | ✅ 内置 Telegram + WhatsApp + 12 其他通道 | 零额外工作 |
| Agent workspace 注入 | ✅ SOUL.md/AGENTS.md/USER.md 自动加载到 system prompt | OpenClaw 标准机制 |
| 外部 MCP Server | ✅ `tools.mcp.servers` 配置 | spawn_coder 走此路径 |
| Workspace Skills | ✅ `<workspace>/skills/<name>/SKILL.md` | Zoe 专用 skills |
| sessions_send（A2A 消息） | ✅ 支持同步/fire-and-forget | 用于回传 PR 结果 |
| sessions_spawn（隔离子会话） | ✅ subagent/acp 两种运行时 | tmux 的潜在替代品 |
| 配置热重载 | ✅ JSON5 格式，文件变更自动应用 | 开发迭代友好 |
| 消息路由 bindings | ✅ 支持 channel + peer + accountId 匹配 | 精确路由 |
| Heartbeat 定时任务 | ✅ 支持 cron 定期执行 | 用于任务监控 |
| Agent 间权限控制 | ✅ `tools.agentToAgent.enabled` + allow 白名单 | 安全边界 |

### 3.3 sessions_spawn：tmux 的潜在升级路径

OpenClaw 原生的 `sessions_spawn` 支持：
- `cwd` 参数（指定工作目录 → 对应 worktree 路径）
- `runtime: "acp"` 模式（Agent Control Protocol，强隔离）
- `streamTo: "parent"` 流式转发输出
- 超时控制

**MVP 阶段保留 tmux**（透明、可调试），sessions_spawn 作为后续升级路径。

---

## 四、项目目录结构

```
OpenClaw+Zoe/
│
├── OpenClaw/                              # OpenClaw 源码
│   ├── src/                               # 核心源码（可阅读，修改需报告）
│   ├── extensions/                        # 通道插件
│   ├── skills/                            # 内置 skills
│   ├── docs/                              # 文档（重要参考）
│   └── ...
│
├── workspace-zoe/                         # ★ Zoe Agent 的 workspace
│   ├── AGENTS.md                          # 操作指令（启动顺序、工具规则）
│   ├── SOUL.md                            # Zoe 的角色和核心原则
│   ├── USER.md                            # 用户/项目上下文（用户填写）
│   ├── TOOLS.md                           # 可用工具描述
│   ├── IDENTITY.md                        # Zoe 的身份（名字、emoji）
│   ├── HEARTBEAT.md                       # 定期检查模板
│   ├── memory/                            # 日期记忆日志
│   │   └── YYYY-MM-DD.md
│   ├── skills/                            # Zoe 专用 skills
│   │   └── spawn-coder/
│   │       └── SKILL.md                   # spawn_coder skill 定义
│   └── .openclaw/                         # 会话状态（自动生成）
│
├── mcp-tools/                             # ★ MCP Server 实现
│   ├── package.json                       # 依赖（@modelcontextprotocol/sdk）
│   ├── tsconfig.json
│   ├── index.ts                           # MCP Server 入口
│   ├── spawn_coder.ts                     # 核心：启动 Claude Code 施工队
│   ├── list_tasks.ts                      # 查询任务状态
│   └── cancel_task.ts                     # 取消任务和清理
│
├── templates/
│   └── CLAUDE.md.template                 # 施工队安全约束
│
├── scripts/
│   ├── setup.sh                           # 一键初始化（注册 Agent + 配置）
│   ├── test-manual.sh                     # 手动验证脚本
│   └── check-agents.sh                    # 监控脚本（cron 驱动）
│
├── ZOE_HANDOFF.md                         # 原始交接文档
├── ZOE_DEV_REPORT.md                      # 本文件
└── CLAUDE.md                              # 开发规范
```

---

## 五、环境与平台

### 5.1 当前开发环境

| 组件 | 版本 | 状态 |
|------|------|------|
| Node.js | v24.11.0 | ✅ 满足 ≥22 |
| pnpm | 10.23.0 | ✅ |
| git | 2.51.0 | ✅ 支持 worktree |
| Claude CLI | 2.1.63 | ✅ |
| tmux | 不可用 | ❌ Windows 限制，Mac 迁移后可用 |
| OpenClaw | 2026.3.3 | ✅ 依赖已装，核心已编译 |

### 5.2 Windows 特殊处理

- **pnpm 跨盘链接**：需要 `PNPM_HOME="D:/.pnpm"` 环境变量
- **A2UI Canvas**：Windows 上无法打包（bash 脚本依赖），不影响核心功能
- **tmux 不可用**：代码编写和类型检查在 Windows 完成，集成测试在 Mac 完成
- **路径兼容**：所有代码使用 `path.join()` 确保跨平台

---

## 六、开发路线图

### Phase 0：基础设施（✅ 已完成）
- [x] 克隆 OpenClaw 源码 v2026.3.3
- [x] 安装依赖 + 核心编译
- [x] 环境检查和工具链验证
- [x] 深度分析 OpenClaw Agent 架构
- [x] 理解修正：OpenClaw 原生 Agent，非独立项目

### Phase 1：Workspace 和 Agent 注册
- [ ] 创建 `workspace-zoe/` 目录结构
- [ ] 编写 `SOUL.md` — Zoe 的角色定义和核心原则
- [ ] 编写 `AGENTS.md` — 操作指令和工具使用规则
- [ ] 编写 `USER.md` — 用户上下文模板
- [ ] 编写 `TOOLS.md` — 工具描述
- [ ] 编写 `IDENTITY.md` — Zoe 身份信息
- [ ] 编写 `HEARTBEAT.md` — 定期检查清单
- [ ] 通过 `openclaw agents add zoe` 或手动编辑 `openclaw.json` 注册 Agent
- [ ] 验证 Zoe Agent 能通过 `openclaw agent --agent zoe` 启动

### Phase 2：MCP 工具核心开发（优先级最高）
- [ ] `mcp-tools/package.json` + `tsconfig.json` 初始化
- [ ] `mcp-tools/index.ts` — MCP Server 入口（`@modelcontextprotocol/sdk`）
- [ ] `mcp-tools/spawn_coder.ts` — 核心逻辑：
  - 生成 task_id
  - 创建 git worktree + branch
  - 写入 TASK.md + CLAUDE.md
  - 启动 tmux session + Claude Code
  - PR 检测轮询（`gh pr list --head <branch>`）
  - 通过 sessions_send 回传结果
- [ ] `mcp-tools/list_tasks.ts` — 查询活跃任务
- [ ] `mcp-tools/cancel_task.ts` — 取消任务 + 清理 worktree
- [ ] 在 openclaw.json 中注册 MCP Server 到 Zoe Agent
- [ ] TypeScript 类型检查通过

### Phase 3：安全与模板
- [ ] `templates/CLAUDE.md.template` — 施工队安全约束
- [ ] `scripts/check-agents.sh` — cron 监控脚本
- [ ] `workspace-zoe/skills/spawn-coder/SKILL.md` — Skill 定义

### Phase 4：集成验证（Mac 迁移后）
- [ ] `scripts/setup.sh` — 一键安装脚本
- [ ] `scripts/test-manual.sh` — 手动验证流程
- [ ] tmux 端到端测试
- [ ] Telegram → Zoe → Claude Code → PR 全链路验证

---

## 七、Claude Code 认证策略

### 7.1 HANDOFF 的误判

HANDOFF 5.3 节称"Anthropic 封锁了在 Claude Code 之外使用 OAuth Token"，并要求使用 API Key。
**这对本项目不适用。** `spawn_coder` 启动的是**真正的 `claude` CLI 进程**（在 tmux session 中），这就是 Claude Code 本身在运行，不是"第三方工具调用 API"。订阅认证完全适用。

### 7.2 真实风险：多实例 OAuth 竞态

当多个 `claude` 进程并发运行时，它们共享 `~/.claude/.credentials.json` 中的一次性 OAuth refresh token。
多进程同时刷新会导致竞态——先刷新的进程赢，后刷新的进程拿到 404 并丢失认证。

参考 Issue：
- [#27933 - OAuth token refresh race condition](https://github.com/anthropics/claude-code/issues/27933)
- [#24317 - Frequent re-authentication with concurrent sessions](https://github.com/anthropics/claude-code/issues/24317)

### 7.3 认证方案选择

| 方案 | 优点 | 缺点 | 适用阶段 |
|------|------|------|---------|
| **Max 订阅（OAuth）** | 不额外花钱，原生支持 | 并发实例有竞态风险 | ✅ MVP 首选 |
| **API Key** | 无竞态，并发稳定 | 按量计费，成本高 | 后续高并发 fallback |
| **`claude setup-token`** | 生成静态 token，无刷新竞态 | 需要定期续期 | 中间方案 |

**决策：MVP 阶段使用 Max 订阅认证。** 理由：
1. 启动的是原生 `claude` CLI，订阅认证天然支持
2. Elvis Sun 月成本 ~$190，大概率以订阅为主
3. MVP 阶段并发量低（≤2-3 实例），竞态不一定触发
4. 该 bug 在 Anthropic 修复路线上（Agent Teams 功能依赖多实例）
5. 如后续频繁掉线，再切换到 API Key 或静态 token 作为 fallback

---

## 八、风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|---------|
| Windows 无 tmux | 无法本地测试完整流程 | 代码 + 类型检查在 Windows，Mac 上集成测试 |
| MCP Server 与 OpenClaw 兼容性 | 工具注册失败 | 参考现有 MCP 插件和文档 |
| sessions_send A2A 权限 | 回调被拦截 | 确保 `tools.agentToAgent.enabled=true` |
| OAuth 多实例竞态 | 并发施工队掉线 | MVP 限制并发数；fallback 到 API Key |
| 并发 Agent 内存压力 | 16GB Mac Mini 上限 | MAX_CONCURRENT_AGENTS=4 硬限制 |
| OpenClaw 版本迭代 | API 破坏性变更 | 锁定 v2026.3.3，跟踪 changelog |

---

## 九、给用户的确认清单

正式进入 Phase 1 前需确认：

1. **Claude Max 订阅**：是否已有 Max 计划？（施工队用订阅认证，不需要单独的 API Key）
2. **GitHub CLI (`gh`)**：是否已认证？PR 创建依赖它
3. **Telegram Bot Token**：是否已创建 Telegram Bot？
4. **目标仓库**：首次测试操作哪个 Git 仓库？
5. **Mac Mini 时间线**：预计何时迁移？决定 tmux 测试时间

---

*报告 v0.3 — 2026-03-07*
*v0.2: 架构修正（独立项目 → OpenClaw 原生 Agent）*
*v0.3: 认证策略修正（API Key → Max 订阅优先，API Key 作为 fallback）*
