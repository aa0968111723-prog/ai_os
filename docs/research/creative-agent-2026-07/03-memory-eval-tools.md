# Agent 系统 2025–2026 最佳实践简报

> 覆盖：记忆与上下文、工具注册表、评估、可观测性、意图路由、长跑编程 Agent  
> 范围：公开工程实践与平台文档（LangChain/LangSmith、Anthropic/Claude Code、OpenAI Agents SDK、MCP 等）

---

## 1. 记忆与上下文（Memory & Context）

**核心范式：Context Engineering** — 在每一步把「恰到好处」的信息填入上下文窗口（写 / 选 / 压缩 / 隔离），而非只堆 prompt。

| 层级 | 实践 | 要点 |
|------|------|------|
| **短期会话** | Thread-scoped state + checkpoint | LangGraph 用 checkpoint 持久化会话内 state（scratchpad）；工具回传与中间决策写入 state，按步选择性暴露给 LLM |
| **长期项目记忆** | 跨 session 的 profile / collection | 过程记忆（CLAUDE.md、Cursor rules）、情节记忆（few-shot）、语义记忆（事实/图谱）；产品侧如 ChatGPT/Cursor/Windsurf 自动抽取长期记忆 |
| **压缩** | 摘要 + 裁剪 | Claude Code 在窗口 ~95% 时 auto-compact；工具结果后处理摘要；硬裁剪旧消息 |
| **隔离** | 子 Agent / 沙箱 / state 字段 | 子任务独立 context；重对象放环境变量/沙箱，只回传摘要 |

**Artifact 血缘（lineage）**  
将每次产物建模为带元数据的节点：agent/model 指纹、输入摘要、结果 hash、parent 引用，形成 **DAG 审计图**（人 → Agent → 工件）。协作时消息/工件携带 lineage；下游校验上游真实性后再消费。

**sourceRefs / outputRefs 模式（推荐契约）**

```text
Artifact {
  id, type, contentRef | inline,
  sourceRefs: [{ kind: tool|file|url|memory|user, id, span?, hash? }],
  outputRefs: [{ consumer: step|agent|pr, role: input|evidence }],
  parentIds: [...],  // 血缘
  createdBy: { agent, model, runId }
}
```

- **sourceRefs**：本步依据（检索片段、文件路径、工具结果、记忆条目）  
- **outputRefs**：被谁消费（后续 step、PR、评测 harness）  
- 编码 Agent 的 PR/测试门禁应能回溯「改了什么 ← 依据什么证据」

**URL**  
- https://www.langchain.com/blog/context-engineering-for-agents/  
- https://langchain-ai.github.io/langgraph/concepts/memory/  
- https://code.claude.com/docs/en/best-practices  
- https://engineeringagents.substack.com/p/provenance-as-the-chain-of-accountability  

---

## 2. 工具注册表（Tool Registries）

**统一工具面**：Web UI、MCP Server、后台 Runner 共用同一 **Tool Descriptor + ACL**，避免三套权限语义。

| 维度 | 2025–2026 共识 |
|------|----------------|
| **描述契约** | `name` + `description` + `inputSchema`（JSON Schema）；可选 `outputSchema` / annotations |
| **发现** | MCP `tools/list`（可按授权 scope 过滤）；`listChanged` 通知；确定性排序利于 prompt cache |
| **调用** | `tools/call`；执行错误用 `isError` 回传可恢复信息；协议错误 vs 业务错误分离 |
| **ACL** | 同一 policy 引擎：身份 → 允许工具集合 → 参数约束（路径/网络/密钥）→ 审计；MCP 允许按凭证返回工具子集 |
| **人机协同** | 敏感操作确认 UI；展示将调用的工具与入参；HITL 可拒绝 |
| **规模** | 工具过多时对 **description 做 RAG 检索** 再注入，降低选错工具 |
| **有状态工具** | 无隐式 session；用显式 handle（如 `basket_id`），每次鉴权 |

**统一注册表示例字段**：`id, transport(ui|mcp|worker), risk_level, scopes[], rate_limit, schema_version`。UI 按钮、MCP、Celery/后台任务都只是 **adapter**，注册与鉴权在中心。

**URL**  
- https://modelcontextprotocol.io/docs/concepts/tools  
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization  
- https://www.anthropic.com/engineering/building-effective-agents  

---

## 3. 评估（Evaluation）

**三层评测（2026 主流）**

1. **Outcome**：任务是否成功（最终答案 / 状态变更是否正确）  
2. **Trajectory**：路径是否合理（工具选择、顺序、循环、恢复）——不必严格匹配参考路径  
3. **Step / component**：单步工具参数、检索质量、子 Agent 交接  

**Capability vs Regression**  
- Capability：难任务、初始低通过率，用来爬山  
- Regression：高通过率金标，CI 防回退；常见「每 PR 30+ golden，指标跌 >3% 阻断」

**实践清单要点**  
- 先手读 20–50 条真实 trace，再上自动化  
- 成功标准可双人一致判定；同时测正例与反例  
- 优先 **binary pass/fail**；客观项用代码裁判，主观项 LLM-as-judge 并对齐人类  
- **判结果不判路径**（除非合规强制）；可对进度 partial credit  
- 多 trial、干净环境（无跨 trial 状态泄漏）  
- Offline（数据集）+ Online（生产采样）+ 定期人工探查  

**URL**  
- https://www.langchain.com/blog/agent-evaluation-readiness-checklist  
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents  
- https://www.braintrust.dev/articles/ai-agent-evaluation-framework  
- https://langfuse.com/guides/cookbook/example_pydantic_ai_mcp_agent_evaluation  
- https://cameronrwolfe.substack.com/p/agent-evals  

---

## 4. 可观测性（Observability）

**原语**：`Run`（单步）→ `Trace`（一轮完整轨迹）→ `Thread`（多轮会话）；OpenAI 侧为 **Trace + nested Spans**（agent / generation / function / guardrail / handoff）。

| 能力 | 实践 |
|------|------|
| **Event stream** | 流式 token、工具起止、自定义 `add_event`；长跑 worker 结束 `flush_traces()` |
| **归因** | 逐步 latency/cost/token；工具失败 vs 模型失败分状态 |
| **Health / blocked** | 超时、权限拒绝、死循环、HITL 等待、沙箱阻断 → 结构化状态机，非仅 error 日志 |
| **Insights** | LangSmith Insights 对生产 trace 聚类：用法模式、失败模式、负面交互根因 |
| **OTel** | 2025–2026 多平台 OTLP；与 APM 打通 |

**OpenAI Agents SDK**：默认记录 workflow；`group_id` 串会话；可关敏感 I/O；自定义 processor 双写 LangSmith/Langfuse 等。

**URL**  
- https://www.langchain.com/langsmith/observability  
- https://docs.langchain.com/langsmith/insights  
- https://openai.github.io/openai-agents-python/tracing/  
- https://platform.openai.com/traces  
- https://www.langchain.com/blog/from-traces-to-insights-understanding-agent-behavior-at-scale  

---

## 5. 意图路由（Intent Routing）

**不要**把所有模式塞进一个巨型 system prompt。推荐 **轻量路由层 → 专用执行路径**：

| Intent | 行为 | 成本/风险 |
|--------|------|-----------|
| **chat** | 问答、解释、只读探查 | 低；可流式 |
| **one-shot generate** | 单文件补丁、小生成、明确 diff | 中；可跳过 plan |
| **multi-step plan** | 多文件/不确定方案 → Plan 模式再实现 | 高；需验收标准 |
| **template / skill** | 固定工作流（`/fix-issue`、迁移脚本） | 可重复、可闸门 |

**实现**  
- 小模型/规则/语义路由 **每请求一次**，输出 `intent + confidence + 可选 playbook`  
- 低置信度 → 澄清问题或默认 chat  
- 路由与执行分离：执行 Agent 不承担全库工具选择  
- 分层意图（先领域再动作）降低多域误分  

**URL**  
- https://blog.gopenai.com/intent-routing-for-ai-agents-e075d64da6c9  
- https://dev.to/wonderlab/agent-series-5-intent-recognition-and-routing-making-agents-actually-understand-users-3174  
- https://medium.com/google-cloud/designing-cognitive-architectures-agentic-workflow-patterns-from-scratch-63baa74c54bc  

---

## 6. 长跑编程 Agent 计划（Claude Code / Cursor 风格）

**原则：可验证、可回退、PR 粒度、门禁驱动。**

1. **Explore → Plan → Implement → Commit/PR**  
   - Plan mode 只读探查；明确再退出 plan 写代码  
   - 小改动可跳过 plan；多文件/陌生代码必须 plan  

2. **PR-sized 任务**  
   - 单 PR 可审、可测、可回滚；大功能拆为 **PR DAG**（依赖边：schema → API → UI → 清理）  
   - 每节点：目标、范围外、文件列表、验收标准、测试命令  

3. **验收与 Test Gates**  
   - 给 Agent 可执行检查：单测、build、lint、截图 diff  
   - Stop hook / `/goal` 未通过则不准结束  
   - 证据优先：贴测试输出，不单说「已修好」  
   - 独立 **reviewer 子 Agent** 对照 plan 查缺口（对抗式复核）  

4. **上下文卫生**  
   - 调查用 subagent，避免主会话被读文件撑爆  
   - 无关任务 `/clear`；失败两次就清会话重写更好的首 prompt  
   - CLAUDE.md / rules 保持短：放「猜不到的约定」，不放可从代码推断的细节  

5. **并行与自动化**  
   - git worktree / 多 session 隔离实验  
   - `claude -p` 进 CI；批量迁移脚本 + 收紧 `--allowedTools`  

**URL**  
- https://code.claude.com/docs/en/best-practices  
- https://code.claude.com/docs/en/how-claude-code-works  
- https://www.anthropic.com/engineering/claude-code-best-practices  
- https://cognition.ai/blog/dont-build-multi-agents  

---

## 落地优先级（建议）

1. **Trace 全覆盖** + 失败分类（工具/权限/模型/数据）  
2. **统一 Tool Registry + 同一 ACL**（UI/MCP/Worker）  
3. **Intent 路由** 分流 chat / generate / plan / template  
4. **Outcome + Trajectory 评测**；金标进 CI regression  
5. **Memory**：session checkpoint + 项目级 CLAUDE.md/rules + artifact sourceRefs  
6. **长跑**：PR DAG + 可执行 acceptance + stop gate + 独立 review  

---

*字数约 1.4k 中文；引用均为 2025–2026 公开文档与工程文。*
