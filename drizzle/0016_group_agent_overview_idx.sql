-- S1：組級代理總覽的索引。
-- teamAssistant.agentOverview（作業台「AI 工作與團隊分析」）與 list_agent_runs 工具都以
-- group_id 為條件查 agent_runs，但該表原本只有 project_id / status / user_id 前綴索引，
-- 沒有任何 group_id 前綴 → 每次打開作業台都是全表掃描。updated_at 後綴讓清單的
-- 「近期優先」排序也能靠索引取前幾筆。
CREATE INDEX IF NOT EXISTS "agent_runs_group_updated_idx" ON "agent_runs" USING btree ("group_id","updated_at");
