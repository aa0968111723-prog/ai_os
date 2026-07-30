# 多智能体编排与运行时模式研究简报（2025–2026）

**范围**：仅编排框架与运行时模式（不含模型选型、RAG、评测平台）。  
**目标读者**：创意媒体生产系统架构（长链路、多角色、可暂停审批、可恢复长跑）。

---

## 1. LangGraph：图编排 + 一等持久化

### 关键原语
- **StateGraph / nodes / edges**：节点做计算，边决定下一步；支持条件边与并行（同一 super-step 内多节点可并行）。底层类似 Pregel 的 message-passing。
- **Shared state + reducers**：全图共享状态 schema；检查点按 super-step 边界落盘（非整节点中途）。
- **Checkpointer + `thread_id`**：每次 super-step 读写 checkpoint；`thread_id` 隔离会话，支撑并发生产任务。
- **`interrupt` / `Command(resume=…)`**：节点内可像 `input()` 一样暂停；状态持久化后进程可不占资源；恢复时传入人类决策。支持 resume map（按 interrupt ID 恢复）、time-travel / `updateState`。
- HITL 常见形态：Approve/Reject、Review & Edit State、Review Tool Calls、多轮多 agent 对话。

### 生产优势
- 持久化是一等公民，而非事后补丁；适合「跑一半等人审、几天后再续」。
- 可控分支/循环/多 agent，比纯「让 LLM 自己决定一切」更可运维。
- Replit 等生产 agent 强调 HITL 为关键设计。

**文档/博客**：https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt · https://docs.langchain.com/oss/python/langgraph/graph-api · https://langchain-ai.github.io/langgraph/concepts/persistence/

### 创意媒体制作可借
- 把制片流水线建模为 **显式 DAG/状态机**（脚本 → 分镜 → 生成 → 审片 → 修稿 → 导出）。
- 在「高成本渲染/发布/版权敏感工具调用」前挂 `interrupt`。
- 用 `thread_id` = 项目/镜头 ID；审片人编辑 checkpoint 中的 brief/风格参数后 resume。
- 注意：checkpoint ≠ 完整 durable execution；跨进程崩溃、幂等副作用仍需你自己补强（见 Temporal）。

---

## 2. CrewAI：Crews（角色协作）+ Flows（确定性骨架）

### 关键原语
- **Crews**：role / goal / backstory 的角色化 agent；Tasks + Process（sequential / hierarchical 等）；强调自主协作与委派。
- **Flows**：事件驱动工作流——条件路由、循环、状态、与普通 Python/单次 LLM 调用交织；**Flow 管结构，Crew 管推理**。
- **State**：dict 或 Pydantic；`@persist()` 支持暂停/恢复；Crew/Flow 层 persistent memory。
- 企业侧：Control Plane 可观测、可治理；可与沙箱运行时（如 NVIDIA NemoClaw）组合做策略硬边界。

### 生产优势
- 心智模型贴近「剧组/部门」：编剧、美术、剪辑、合规各一角色，上手快。
- **Roles + Flows 混合**：主干流程确定性（不丢片、不乱序），局部任务交给自主 Crew。
- Flow API（约 2025 末起）补齐条件路由与状态，更适合生产自动化。

**来源**：https://github.com/crewaiinc/crewai · https://crewai.com/blog/orchestrating-self-evolving-agents-with-crewai-and-nvidia-nemoclaw · https://crewai.com/

### 创意媒体制作可借
- **角色卡 = 部门岗位**：brief 锁定工具边界（仅某 agent 能调素材库/发布 API）。
- **Flow 固定「制作阶段门」**，Crew 只在阶段内做创意发散（文案变体、镜头建议）。
- Hierarchical manager–worker 适合「导演 agent 分派子任务」；工具按 task 限权，优于全网 mesh。
- 长任务用 persist + memory，避免每轮从零讲项目背景。

---

## 3. OpenAI Agents SDK：轻量 Agent Loop + Handoffs

### 关键原语
- **Agent**：instructions + tools + guardrails + handoffs。
- **Runner / agent loop**：模型调用 → 工具 → 再调用；handoff 后切换当前 agent；结束或 **approval 暂停**。
- **Handoffs vs agents-as-tools**：handoff = 移交回复所有权；as_tool = 子 agent 当函数，结果回父 agent（经理式编排）。
- **Guardrails**：输入/输出校验，可与执行并行、fail-fast。
- **Sessions**：跨 turn 会话记忆（如 SQLiteSession）。
- **HITL**：`needs_approval` on tools；`RunResult.interruptions`；`RunState` 可序列化（`to_json`/`from_json`），approve/reject 后 `Runner.run(agent, state)` 续跑；支持 sticky always_approve；嵌套 as_tool 的审批仍冒泡到顶层 run。

### 生产优势
- 表面积极小、无强制 DAG，适合快速落地「专家路由 + 审批」。
- 内置 tracing（模型/工具/handoff/guardrail）。
- HITL 与 handoff/嵌套 agent 统一审批面；适合事务型与对话型流水线。

**文档**：https://openai.github.io/openai-agents-python/human_in_the_loop/ · https://developers.openai.com/api/docs/guides/agents · https://tech-insider.org/openai-agents-sdk-tutorial-python-13-steps-2026/

### 创意媒体制作可借
- **按工种 handoff**：Intake → Script → Visual → Compliance；所有权清晰，避免「主 agent 抢答」。
- 发布/付费渲染/外发邮件等工具统一 `needs_approval`。
- Guardrails 卡品牌安全、未成年内容、版权关键词（输出侧）。
- 注意：handoff 默认偏「移交后结束/切换」，复杂「A→B→A→C」循环需设计为 tools 或外层编排，勿假设自动多跳回路。

---

## 4. Anthropic Claude Agent SDK：长程（long-horizon）Harness 模式

### 关键原语与模式（偏运行时习惯，而非图 DSL）
- **Agent harness**：工具循环 + **context compaction**（长会话压缩；可有 PreCompact 钩子）。
- **跨多 context window 的核心问题**：新 session 无记忆 → 半成品、过早宣称完成、或重猜历史。
- **Initializer agent + Coding agent 双阶段**（Anthropic 工程实践）：
  1. 首 session：搭环境——`init.sh`、进度文件（如 `claude-progress.txt`）、初始 git、**结构化 feature list（JSON，`passes: false`）**。
  2. 后续 session：只做**增量**；读 progress + git log；一次只推一个 feature；结束时 **git commit + 写进度**，保持可合并的 clean state。
- 强制端到端自测（浏览器自动化等），避免「单元测过了就标完成」。
- 可选：后续拆测试/QA/清理等 specialized subagents。

### 生产优势
- 针对「小时～天级」任务，用**外部工件**（git、清单、进度日志）桥接 context 断层，比只靠 compaction 稳。
- Claude Code / Agent SDK 同一套基础设施思路，适合代码与复杂多步工具工作。

**来源**：https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents · https://www.anthropic.com/engineering/multi-agent-research-system

### 创意媒体制作可借
- 把长片/系列项目拆成 **feature/shot checklist（JSON）**，禁止 agent 删项，只允许改 `passes`。
- 每 session：**只做一个镜头/段落**；产出可审可回滚（版本化资产 + 变更说明）。
- Initializer：模板工程、目录约定、风格 bible、渲染/导出脚本。
- 结束 session 前自检「可交付 clean state」（无半截工程文件、清单与磁盘一致）。
- 进度文件 + 版本历史 = 下一班组（下一 agent 实例）的 onboarding。

---

## 5. Temporal + Agents：Durable Execution

### 关键原语
- **Workflow（确定性编排）** vs **Activities（非确定性 I/O）**：LLM 调用、工具、HTTP 一律进 Activity；Workflow 只写控制流（循环、子工作流、等待信号）。
- **Event History 回放**：崩溃后按已记录决策重放，不重跑已完成 Activity 的「新决定」——避免「订了惠斯勒机票，重启又订日本」。
- **Signals / Queries / Schedules**：人机输入、状态查询、定时 ambient agents。
- 动态计划：LLM 在 Activity 里生成 plan 列表，Workflow `for step in plan` 或 child workflow 执行；路径不预写死，但执行可恢复。
- 生产背书：OpenAI Codex web、Replit Agent 3 等长跑 agent 使用 Temporal；并有与 OpenAI Agents SDK / Google ADK 等集成方向。

### 生产优势
- 真正的**跨机器、跨天、带重试/超时/幂等语义**的长跑；checkpoint 库级方案通常仍需应用层当「编排器」。
- HITL = 干净的 durable wait（不必手搓队列+状态机胶水）。
- 工具做成 durable Activity/Workflow → 审计轨迹与故障隔离。

**来源**：https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal · https://temporal.io/blog/build-resilient-agentic-ai-with-temporal · https://temporal.io/blog/orchestrating-ambient-agents-with-temporal

### 创意媒体制作可借
- 整条 **job = Workflow**；单步生成/转码/上传 = Activity（可重试、可超时）。
- 审片 = Signal；查询进度 = Query；夜间批处理 = Schedule。
- LLM 规划分镜列表后，**逐步 durable 执行**，中断不丢「已通过镜头」。
- 建议分层：**Temporal 保活 + 幂等副作用**，上层用 LangGraph/Crew/Agents SDK 做认知编排。

---

## 6. 横向对照（选型速查）

| 维度 | LangGraph | CrewAI | OpenAI Agents SDK | Anthropic harness | Temporal |
|------|-----------|--------|-------------------|-------------------|----------|
| 控制模型 | 显式图/状态 | Flow 确定性 + Crew 自主 | Loop + handoff | Session 工件驱动 | Workflow/Activity |
| 暂停恢复 | interrupt + checkpoint | `@persist` / memory | RunState 序列化 | 跨 session 文件/git | Event History |
| HITL | 一等、可改 state | 支持 + 企业治理 | tool approval 一等 | 人审清单/合并 | Signal 等待 |
| 长跑耐久 | 应用级 checkpoint | 中等 | 需自管/外挂 | 多窗口工件 | 最强 |
| 创意契合 | 复杂流水线状态机 | 剧组角色协作 | 轻量专家路由 | 多日项目增量 | 渲染级长任务底座 |

---

## 7. 创意媒体生产：可落地的编排建议

1. **双层架构**：外层 **Temporal（或同等 durable runtime）** 管作业生命周期；内层 **图或 Flow** 管阶段逻辑；局部用 **role crew / handoff specialists** 做创意发散。
2. **阶段门 = 显式 interrupt/approval**：脚本锁定、风格锁定、成片发布强制 HITL；高成本 GPU 步骤前审批。
3. **外部真相源**：shot list JSON、进度日志、资产版本（git/对象存储版本），对齐 Anthropic long-horizon 实践——**context 会丢，磁盘上的清单不会**。
4. **所有权语义**：handoff 用于「下个部门接盘」；agents-as-tools 用于「导演征求意见后自己汇总」。
5. **安全边界在基础设施**：工具白名单 + 沙箱（勿仅靠 prompt guardrail）；发布类副作用必须幂等 + 可审计。
6. **失败语义**：重试 Activity 不重复扣费/不重复发帖；计划与执行决策写入 durable history，避免「重启换路线」。

---

## 8. 参考链接汇总

- LangGraph HITL interrupt: https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt  
- LangGraph Graph API: https://docs.langchain.com/oss/python/langgraph/graph-api  
- CrewAI README / hybrid: https://github.com/crewaiinc/crewai  
- CrewAI Flows 生产架构: https://crewai.com/blog/orchestrating-self-evolving-agents-with-crewai-and-nvidia-nemoclaw  
- OpenAI Agents HITL: https://openai.github.io/openai-agents-python/human_in_the_loop/  
- OpenAI Agents overview: https://developers.openai.com/api/docs/guides/agents  
- Anthropic long-running harness: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents  
- Anthropic multi-agent research: https://www.anthropic.com/engineering/multi-agent-research-system  
- Temporal dynamic AI agents: https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal  
- Temporal agentic AI: https://temporal.io/blog/build-resilient-agentic-ai-with-temporal  
- Checkpoint vs durable execution 讨论: https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows  

---

*简报字数约 1450；侧重可操作原语与媒体生产映射，非厂商全面对比。*
