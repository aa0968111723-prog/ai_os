#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端測試（MCP 專區）：對真跑的伺服器驗證正式目錄中的全部 MCP 工具（含資料庫更新與代理稽核工具），以及每一道守門——
唯讀範圍（擋所有寫入、放行所有讀取）、到期／撤銷／壞金鑰一律 401、跨組隔離（別人的金鑰
碰不到你的專案）、封存專案寫入守衛、資料庫 AI 存取等級（none/read）閘門、跨介面審計歸屬。

與 CI 其他 e2e 同口徑：E2E_MOCK=1（假生成，plan/submit 走 mockPlan／假 fal，不需外部金鑰）。
需要 MCP_API_KEY＋ALLOW_LEGACY_MCP_ADMIN_KEY=1 才會啟用舊測試金鑰——CI 只在非 production 明確設定。
"""
import json, os, sys, subprocess, datetime, shutil, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local")
PW = os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123")

def _db_from_url():
    """Prefer PGDATABASE; else path of DATABASE_URL（本機 docker 常用 aidirector）。"""
    if os.environ.get("PGDATABASE"):
        return os.environ["PGDATABASE"]
    url = os.environ.get("DATABASE_URL") or ""
    if url:
        try:
            from urllib.parse import urlparse
            path = (urlparse(url).path or "").lstrip("/")
            if path:
                return path.split("?")[0] or "postgres"
        except Exception:
            pass
    return "postgres"

DB = _db_from_url()
PGHOST = os.environ.get("PGHOST", "localhost")
PGUSER = os.environ.get("PGUSER", "postgres")

_passed = _failed = 0
def ok(name, cond, detail=""):
    global _passed, _failed
    if cond: _passed += 1; print(f"✅ {name}" + (f"  — {detail}" if detail else ""))
    else: _failed += 1; print(f"❌ {name}" + (f"  — {detail}" if detail else ""))

def _psql(sql):
    """跑一條 SQL（-tAc）。本機有 psql 優先；否則用 Docker 容器內 psql。

    容器名：E2E_PG_CONTAINER 或 E2E_PSQL_DOCKER（run-e2e-local 兩者對齊）。
    """
    env = {**os.environ, "PGPASSWORD": os.environ.get("PGPASSWORD", "postgres")}
    container = os.environ.get("E2E_PG_CONTAINER") or os.environ.get("E2E_PSQL_DOCKER")
    if shutil.which("psql"):
        command = ["psql", f"host={PGHOST} user={PGUSER} dbname={DB}", "-tAc", sql]
    elif container:
        command = [
            "docker", "exec", "-e", f"PGPASSWORD={env['PGPASSWORD']}",
            container,
            "psql", "-U", PGUSER, "-d", DB, "-tAc", sql,
        ]
    else:
        raise RuntimeError(
            "psql 不在 PATH；Docker 測試請設定 E2E_PG_CONTAINER 或 E2E_PSQL_DOCKER（例：stress-pg）"
        )
    return subprocess.run(command, capture_output=True, text=True, env=env, check=True).stdout.strip()

# ── tRPC（cookie 手動保存：production cookie 帶 Secure，不會經 http 自動回送）──
class Sess:
    def __init__(self): self.cookie = None
    def call(self, path, payload):
        body = json.dumps({"0": {"json": payload}}).encode()
        h = {"content-type": "application/json"}
        if self.cookie: h["Cookie"] = self.cookie
        req = urllib.request.Request(f"{HOST}/api/trpc/{path}?batch=1", data=body, headers=h)
        with urllib.request.urlopen(req, timeout=30) as r:
            sc = r.headers.get("Set-Cookie")
            if sc and sc.startswith("aidos_session="): self.cookie = sc.split(";", 1)[0]
            d = json.loads(r.read())
        if isinstance(d, list) and d and "error" in d[0]:
            raise RuntimeError(d[0]["error"]["json"]["message"])
        return d[0]["result"]["data"]["json"]

def mcp_raw(method, params, key):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None: payload["params"] = params
    req = urllib.request.Request(f"{HOST}/api/mcp", data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "x-api-key": key or ""})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, None

def call(name, args, key):
    st, d = mcp_raw("tools/call", {"name": name, "arguments": args}, key)
    if d is None: return False, f"http {st}"
    if "error" in d: return False, d["error"]["message"]
    txt = d["result"]["content"][0]["text"]
    try: return True, json.loads(txt)
    except Exception: return True, txt

def rest_batch(table_id, rows, key, idempotency_key=None):
    headers = {"content-type": "application/json", "x-api-key": key}
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    req = urllib.request.Request(
        f"{HOST}/api/v1/databases/{table_id}/rows/batch",
        data=json.dumps({"rows": rows}).encode(),
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except Exception:
            return error.code, {}

BLOCKED = lambda r: ("找不到專案" in r or "不屬於這個組" in r) if isinstance(r, str) else False

# ══════════ 準備：真實 API 建資料 ══════════
print("\n######## 準備 ########")
admin = Sess()
au = admin.call("auth.login", {"email": EMAIL, "password": PW})
UID = au["user"]["id"]
ok("登入（真帳密→session）", au["user"]["email"] == EMAIL, au["user"]["name"])
G_A = next(g["groupId"] for g in au["groups"] if g["groupName"] == "剪輯組")
G_B = next(g["groupId"] for g in au["groups"] if g["groupName"] == "動畫組")
T_B = next(g["teamId"] for g in au["groups"] if g["groupName"] == "動畫組")

proj = admin.call("projects.create", {"groupId": G_A, "title": "MCP 完整測試片", "kind": "故事", "platform": "shorts"})
PID = proj["id"]
admin.call("projects.updateWorldview", {"id": PID, "worldview": {"logline": "陳師姐走出低谷的見證故事", "keyMessage": "希望", "tone": "溫暖"}})
tbl = admin.call("databases.create", {"scope": "group", "groupId": G_A, "name": "器材借用表",
    "fields": [{"key": "item", "label": "器材", "type": "text"}, {"key": "qty", "label": "數量", "type": "number"}],
    "agentAccess": "write"})
TID = tbl["id"]
tbl_ro = admin.call("databases.create", {"scope": "group", "groupId": G_A, "name": "唯讀資料庫",
    "fields": [{"key": "note", "label": "備註", "type": "text"}], "agentAccess": "read"})
TID_RO = tbl_ro["id"]
tbl_none = admin.call("databases.create", {"scope": "group", "groupId": G_A, "name": "AI不可見資料庫",
    "fields": [{"key": "note", "label": "備註", "type": "text"}], "agentAccess": "none"})
TID_NONE = tbl_none["id"]
full = admin.call("mcpTokens.create", {"label": "完整測試·可寫"})
ro = admin.call("mcpTokens.create", {"label": "完整測試·唯讀", "readOnly": True, "expiresInDays": 30})
FULL, RO = full["token"], ro["token"]
ok("建立測試資料（專案／世界觀／3 個資料庫／可寫＋唯讀金鑰）",
   PID and TID and FULL.startswith("aidmcp_") and ro["readOnly"])

# ══════════ 協定層 ══════════
print("\n######## 協定層 ########")
st, d = mcp_raw("initialize", None, FULL)
ok("initialize", st == 200 and d["result"]["serverInfo"]["name"] == "ai-director-os")
st, d = mcp_raw("tools/list", None, FULL)
names = {t["name"] for t in d["result"]["tools"]}
EXPECTED = {"whoami","list_projects","get_project_context","find_model","submit_generation","post_message",
    "list_generations","get_generation","list_assets","list_databases","query_database","add_database_row","add_database_rows","update_database_row",
    "list_database_files","read_database_file","get_database_stats","plan_agent","approve_agent","stop_agent","discard_agent",
    "list_agent_runs","get_agent_run","list_agent_events","get_agent_insights",
    "list_schedule","add_schedule_item","get_project_status",
    "list_notes","get_note","list_dm_contacts","list_dm_threads","read_dm","send_dm",
    "request_upload_grant","get_upload_grant_status"}
ok(f"tools/list = {len(EXPECTED)} 且名單完整", names == EXPECTED, f"{len(names)} 個")

# ══════════ 核心工具逐一實跑（可寫金鑰）══════════
print("\n######## 核心工具逐一實跑 ########")
g, r = call("whoami", {}, FULL); ok("1. whoami", g and r["user"]["email"] == EMAIL and r["readOnly"] is False)
g, r = call("list_projects", {}, FULL); ok("2. list_projects（含新專案）", g and any(p["id"] == PID for p in r))
g, r = call("get_project_context", {"projectId": PID}, FULL)
ok("3. get_project_context（世界觀正確）", g and r["worldview"]["logline"].startswith("陳師姐"))
g, r = call("find_model", {"category": "llm"}, FULL)
MODEL = r[0]["modelId"] if g and r else None
ok("4. find_model（且回傳全為 llm 類）", g and r and all(m["category"] == "llm" for m in r), f"{len(r)} 個")
g, r = call("list_generations", {"projectId": PID}, FULL); ok("5. list_generations（初始空）", g and r == [])
g, r = call("submit_generation", {"projectId": PID, "modelId": MODEL, "prompt": "測試腳本：一句溫暖的開場白"}, FULL)
GEN = r.get("generationId") if g and isinstance(r, dict) else None
ok("6. submit_generation", g and GEN, r.get("status") if isinstance(r, dict) else r)
g, r = call("get_generation", {"generationId": GEN}, FULL); ok("7. get_generation（取回單筆）", g and r["id"] == GEN)
g, r = call("list_generations", {"projectId": PID}, FULL); ok("5b. list_generations（送出後=1）", g and len(r) == 1)
g, r = call("list_assets", {"projectId": PID}, FULL); ok("8. list_assets", g and isinstance(r, list))
g, r = call("request_upload_grant", {"projectId": PID, "purpose": "e2e"}, FULL)
GRANT = r.get("grantId") if g and isinstance(r, dict) else None
ok("8u. request_upload_grant",
   g and GRANT and isinstance(r.get("token"), str) and str(r.get("token", "")).startswith("aidup_")
   and r.get("uploadUrl") and r.get("http", {}).get("method") == "POST",
   r if isinstance(r, dict) else r)
g, r = call("get_upload_grant_status", {"grantId": GRANT}, FULL)
ok("8u2. get_upload_grant_status（pending）",
   g and r.get("grantId") == GRANT and r.get("status") == "pending" and r.get("projectId") == PID,
   r if isinstance(r, dict) else r)
g, r = call("list_databases", {}, FULL)
vis = {t["tableId"] for t in r} if g else set()
ok("9. list_databases（可寫＋唯讀可見、none 不可見）",
   g and TID in vis and TID_RO in vis and TID_NONE not in vis, f"{len(vis)} 個庫")
g, r = call("query_database", {"tableId": TID}, FULL); ok("10. query_database（初始空）", g and r["rows"] == [])
g, r = call("add_database_row", {"tableId": TID, "data": {"item": "腳架", "qty": 3}}, FULL)
ok("11. add_database_row", g and r.get("rowId"))
g, r = call("query_database", {"tableId": TID, "keyword": "腳架"}, FULL)
ok("10b. query_database（關鍵字命中唯一列）", g and len(r["rows"]) == 1 and r["rows"][0]["data"]["item"] == "腳架")
ok("10b2. query_database 回 hasMore/returned", g and r.get("returned") == 1 and r.get("hasMore") is False)
# 更新列
ROW_ID = r["rows"][0]["id"]
g, r = call("update_database_row", {"tableId": TID, "rowId": ROW_ID, "data": {"item": "腳架（已校正）", "qty": 5}}, FULL)
ok("11u. update_database_row", g and r.get("data", {}).get("item") == "腳架（已校正）")
g, r = call("query_database", {"tableId": TID, "keyword": "已校正", "includeFields": False}, FULL)
ok("11u2. 更新後可查且可省略 fields", g and len(r["rows"]) == 1 and "fields" not in r)

# Batch writes are crash/retry safe across both MCP and REST. The same
# actor/table/key scope is shared by both protocols.
MCP_BATCH_KEY = "mcp-batch-20260726-001"
mcp_batch_args = {
    "tableId": TID,
    "idempotencyKey": MCP_BATCH_KEY,
    "rows": [{"data": {"item": "批次燈架", "qty": 2}}, {"data": {"item": "批次麥克風", "qty": 4}}],
}
g, first_batch = call("add_database_rows", mcp_batch_args, FULL)
ok("11b. MCP 批次首次寫入", g and first_batch.get("insertedCount") == 2 and first_batch.get("replayed") is False)
g, replay_batch = call("add_database_rows", mcp_batch_args, FULL)
ok("11c. MCP 同 key 同內容只回放", g and replay_batch.get("insertedCount") == 2 and replay_batch.get("replayed") is True)
g, conflict_batch = call("add_database_rows", {
    **mcp_batch_args,
    "rows": [{"data": {"item": "不同內容", "qty": 99}}],
}, FULL)
ok("11d. MCP 同 key 不同內容穩定衝突", (not g) and "IDEMPOTENCY_CONFLICT" in conflict_batch)

REST_BATCH_KEY = "rest-batch-20260726-001"
rest_rows = [{"data": {"item": "REST 批次 A", "qty": 1}}, {"data": {"item": "REST 批次 B", "qty": 2}}]
status, missing_key = rest_batch(TID, rest_rows, FULL)
ok("11e. REST 批次強制 Idempotency-Key", status == 400 and missing_key.get("code") == "IDEMPOTENCY_KEY_REQUIRED")
with ThreadPoolExecutor(max_workers=2) as executor:
    concurrent = list(executor.map(
        lambda _: rest_batch(TID, rest_rows, FULL, REST_BATCH_KEY),
        range(2),
    ))
ok("11f. REST 同 key 併發只提交一次",
   all(status == 200 for status, _ in concurrent)
   and sorted(result.get("replayed") for _, result in concurrent) == [False, True])
status, rest_conflict = rest_batch(
    TID,
    [{"data": {"item": "REST 改內容", "qty": 3}}],
    FULL,
    REST_BATCH_KEY,
)
ok("11g. REST 同 key 不同內容回 409", status == 409 and rest_conflict.get("code") == "IDEMPOTENCY_CONFLICT")
stored_hashes = _psql(
    f"select count(*) from idempotency_records where actor_id='{UID}' "
    f"and scope='database.rows.batch:{TID}' and length(key_hash)=64 "
    f"and row_to_json(idempotency_records)::text not like '%{MCP_BATCH_KEY}%' "
    f"and row_to_json(idempotency_records)::text not like '%{REST_BATCH_KEY}%';"
)
ok("11h. DB 只存 actor/scope 綁定雜湊，不存原始 key", stored_hashes.isdigit() and int(stored_hashes) >= 2)

g, r = call("list_database_files", {"tableId": TID}, FULL); ok("12. list_database_files（空）", g and r == [])
g, r = call("read_database_file", {"fileId": "00000000-0000-0000-0000-000000000000"}, FULL)
ok("13. read_database_file（不存在→報錯）", (not g) and "找不到" in r)
g, r = call("plan_agent", {"projectId": PID, "goal": "把知識庫腳本拆成分鏡並逐鏡出圖"}, FULL)
RUN = r.get("runId") if g and isinstance(r, dict) else None
ok("14. plan_agent（排出多步計畫）", g and RUN and len(r["steps"]) > 0, f'{len(r.get("steps",[])) if isinstance(r,dict) else 0} 步')
g, r = call("get_agent_run", {"runId": RUN}, FULL); ok("15. get_agent_run（待核准）", g and r["status"] == "awaiting_approval")
g, r = call("list_agent_runs", {"projectId": PID}, FULL); ok("16. list_agent_runs（含本 run）", g and any(x["runId"] == RUN for x in r))
g, r = call("list_agent_events", {"projectId": PID}, FULL)
ok("16b. list_agent_events（含規劃軌跡）", g and isinstance(r.get("items"), list) and len(r["items"]) >= 1)
g, r = call("get_agent_insights", {"projectId": PID}, FULL)
ok("16c. get_agent_insights（健康、工作與成果摘要）",
   g and r.get("status") in ("healthy", "attention", "blocked")
   and isinstance(r.get("workItems"), list) and isinstance(r.get("results"), list))
g, r = call("approve_agent", {"runId": RUN}, FULL)
ok("17. approve_agent（狀態真的離開待核准）", g and r["status"] in ("running", "done"), r.get("status") if isinstance(r, dict) else r)
g, r = call("stop_agent", {"runId": RUN}, FULL); ok("18. stop_agent", g and r["status"] in ("stopped", "done"))
g, r2 = call("plan_agent", {"projectId": PID, "goal": "另一個計畫供放棄測試用途"}, FULL)
RUN2 = r2.get("runId") if g and isinstance(r2, dict) else None
g, r = call("discard_agent", {"runId": RUN2}, FULL); ok("19. discard_agent", g and r["status"] == "discarded")
future = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=5)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
g, r = call("add_schedule_item", {"projectId": PID, "title": "交付死線", "startsAt": future}, FULL)
SCH = r.get("id") if g and isinstance(r, dict) else None
ok("20. add_schedule_item", g and SCH)
g, r = call("list_schedule", {"projectId": PID}, FULL); ok("21. list_schedule（含新行程）", g and any(i["id"] == SCH for i in r))
g, r = call("post_message", {"projectId": PID, "body": "MCP 自動化留言測試"}, FULL); ok("22. post_message", g and r.get("messageId"))
g, r = call("get_project_status", {"projectId": PID}, FULL)
ok("23. get_project_status（統整快照）", g and r["generations"]["recent"] >= 1 and len(r["upcomingSchedule"]) >= 1)

# ══════════ 資料庫 AI 存取等級閘門 ══════════
print("\n######## 資料庫 AI 存取等級（none/read）閘門 ########")
g, r = call("query_database", {"tableId": TID_NONE}, FULL); ok("none 級資料庫：連讀都當作不存在", (not g) and "找不到" in r)
g, r = call("query_database", {"tableId": TID_RO}, FULL); ok("read 級資料庫：可讀", g and "rows" in r)
g, r = call("add_database_row", {"tableId": TID_RO, "data": {"note": "x"}}, FULL)
ok("read 級資料庫：擋寫入", (not g) and "不開放 AI 寫入" in r)

# ══════════ 唯讀範圍：擋所有寫入、放行所有讀取 ══════════
print("\n######## 唯讀範圍 ########")
g, r = call("whoami", {}, RO); ok("唯讀·whoami 標記唯讀", g and r["readOnly"] is True)
READS = {"whoami": {}, "list_projects": {}, "get_project_context": {"projectId": PID}, "find_model": {"keyword": "flux"},
    "list_generations": {"projectId": PID}, "get_generation": {"generationId": GEN}, "list_assets": {"projectId": PID},
    "list_databases": {}, "query_database": {"tableId": TID}, "list_database_files": {"tableId": TID},
    # update 屬寫入，下面 write_tools 會測
    "get_database_stats": {"tableId": TID}, "list_dm_contacts": {}, "list_dm_threads": {},
    "list_agent_runs": {"projectId": PID}, "get_agent_run": {"runId": RUN}, "list_schedule": {"projectId": PID},
    "list_agent_events": {"projectId": PID}, "get_agent_insights": {"projectId": PID},
    "get_project_status": {"projectId": PID},
    "get_upload_grant_status": {"grantId": GRANT}}
allread = all(call(n, a, RO)[0] for n, a in READS.items())
ok(f"唯讀金鑰放行全部 {len(READS)} 個讀取工具", allread)
WRITES = {"submit_generation": {"projectId": PID, "modelId": MODEL, "prompt": "x"}, "post_message": {"projectId": PID, "body": "x"},
    "add_database_row": {"tableId": TID, "data": {"item": "x"}}, "plan_agent": {"projectId": PID, "goal": "應被唯讀擋下"},
    "add_database_rows": {"tableId": TID, "idempotencyKey": "readonly-batch-001", "rows": [{"data": {"item": "x"}}]},
    "update_database_row": {"tableId": TID, "rowId": "00000000-0000-4000-8000-000000000001", "data": {"item": "x"}},
    "approve_agent": {"runId": RUN}, "stop_agent": {"runId": RUN}, "discard_agent": {"runId": RUN},
    "add_schedule_item": {"projectId": PID, "title": "x", "startsAt": future},
    "send_dm": {"peer": "x", "body": "x"},
    "request_upload_grant": {"projectId": PID}}
allblocked = all((lambda gr: (not gr[0]) and "唯讀" in gr[1])(call(n, a, RO)) for n, a in WRITES.items())
ok(f"唯讀金鑰擋下全部 {len(WRITES)} 個寫入工具", allblocked)

# ══════════ 到期／撤銷／壞金鑰一律 401 ══════════
print("\n######## 到期／撤銷／壞金鑰 ########")
# 撤銷 → 立即 401
rev = admin.call("mcpTokens.create", {"label": "待撤銷測試"})
REVK = rev["token"]
ok("撤銷前可用", mcp_raw("tools/list", None, REVK)[0] == 200)
admin.call("mcpTokens.revoke", {"id": rev["id"]})
ok("撤銷後立即 401", mcp_raw("tools/list", None, REVK)[0] == 401)
# 到期 → 401（把唯讀金鑰的 expires_at 改成昨天）
_psql("update mcp_tokens set expires_at = now() - interval '1 day' where label='完整測試·唯讀';")
ok("到期金鑰被拒（401）", mcp_raw("tools/list", None, RO)[0] == 401)
ok("壞金鑰被拒（401，且走 DB 查無分支）", mcp_raw("tools/list", None, "aidmcp_0000000000000000000000000000")[0] == 401)
ok("無金鑰被拒（401）", mcp_raw("tools/list", None, "")[0] == 401)

# ══════════ 跨組隔離：第二個受限使用者的金鑰碰不到別組專案 ══════════
print("\n######## 跨組隔離 ########")
inv = admin.call("admin.invite", {"email": "helper_iso@example.com", "teamId": T_B,
                                   "teamRole": "member", "groupId": G_B, "groupRole": "member"})
if inv.get("attached"):
    ok("邀請新使用者（預期發連結）", False, inv.get("message"))
else:
    tok = inv["inviteUrl"].rsplit("/", 1)[-1]
    u2 = Sess()
    u2au = u2.call("auth.acceptInvite", {"token": tok, "name": "小幫手", "password": "Helper#2026"})
    ok("第二使用者（僅動畫組・非管理員）",
       u2au["user"]["email"] == "helper_iso@example.com" and [x["groupName"] for x in u2au["groups"]] == ["動畫組"]
       and not u2au["user"]["isSuperAdmin"])
    U2 = u2.call("mcpTokens.create", {"label": "U2可寫"})["token"]
    g, r = call("list_projects", {}, U2); ok("U2 list_projects 看不到剪輯組專案", g and all(p["id"] != PID for p in r))
    isolated = True
    for n, a in {"get_project_context": {"projectId": PID}, "get_project_status": {"projectId": PID},
                 "list_generations": {"projectId": PID}, "submit_generation": {"projectId": PID, "modelId": MODEL, "prompt": "x"},
                 "post_message": {"projectId": PID, "body": "x"}, "add_schedule_item": {"projectId": PID, "title": "x", "startsAt": future},
                 "plan_agent": {"projectId": PID, "goal": "偷別組專案"},
                 "request_upload_grant": {"projectId": PID}}.items():
        g, r = call(n, a, U2)
        if not ((not g) and BLOCKED(r)): isolated = False; print(f"   ⚠ 未被擋: {n} — {r}")
    ok("U2 對別組專案的 8 個讀寫工具全被擋", isolated)

    # ══════════ 站內私訊工具（開發者 ↔ U2 雙向；只碰本人參與的對話）══════════
    print("\n######## 站內私訊（MCP）########")
    g, r = call("list_dm_contacts", {}, FULL)
    ok("24. list_dm_contacts（開發者看得到 U2）", g and any(p["email"] == "helper_iso@example.com" for p in r), f"{len(r) if g else 0} 位")
    g, r = call("send_dm", {"peer": "helper_iso@example.com", "body": "MCP 私訊測試：請回報進度 🙏"}, FULL)
    ok("25. send_dm（以 Email 指定對象）", g and r.get("messageId"))
    g, r = call("list_dm_threads", {}, U2)
    ok("26. list_dm_threads（U2 有一串、未讀=1）", g and len(r) == 1 and r[0]["unread"] == 1 and not r[0]["lastFromMe"])
    g, r = call("read_dm", {"peer": EMAIL, "markRead": True}, U2)
    ok("27. read_dm（U2 讀到內容並標已讀）", g and any("請回報進度" in m["body"] for m in r["messages"]))
    g, r = call("list_dm_threads", {}, U2)
    ok("27b. 標已讀後未讀歸零", g and r and r[0]["unread"] == 0)
    g, r = call("send_dm", {"peer": EMAIL, "body": "收到，進度已回報"}, U2)
    ok("28. send_dm（U2 回訊）", g and r.get("messageId"))
    g, r = call("read_dm", {"peer": "helper_iso@example.com"}, FULL)
    ok("28b. 開發者讀到 U2 回訊（雙向串起）", g and any("進度已回報" in m["body"] for m in r["messages"]))
    g, r = call("send_dm", {"peer": "no-such-user@example.com", "body": "x"}, FULL)
    ok("🔒 私訊查無對象被擋", (not g) and "找不到" in r)

# ══════════ 封存專案寫入守衛 ══════════
print("\n######## 封存專案寫入守衛 ########")
admin.call("projects.setArchived", {"id": PID, "archived": True})
archived_blocked = True
for n, a in {"post_message": {"projectId": PID, "body": "x"},
             "add_schedule_item": {"projectId": PID, "title": "x", "startsAt": future},
             "plan_agent": {"projectId": PID, "goal": "封存專案不該能排計畫"},
             "submit_generation": {"projectId": PID, "modelId": MODEL, "prompt": "x"},
             "request_upload_grant": {"projectId": PID}}.items():
    g, r = call(n, a, FULL)
    if not ((not g) and "封存" in r): archived_blocked = False; print(f"   ⚠ 未被擋: {n} — {r}")
ok("封存專案擋下全部 5 個寫入工具", archived_blocked)
g, r = call("get_project_context", {"projectId": PID}, FULL); ok("封存後讀取仍放行", g and isinstance(r, dict))
admin.call("projects.setArchived", {"id": PID, "archived": False})

# ══════════ 審計歸屬（actorId=本人）══════════
print("\n######## 跨介面審計歸屬 ########")
mine = _psql(f"select count(*) from audit_log where action like 'mcp.%' and actor_id = '{UID}';")
fails = _psql(f"select count(*) from audit_log where action like 'mcp.%' and ok = false and actor_id = '{UID}';")
raw_key_audits = _psql(
    f"select count(*) from audit_log where actor_id='{UID}' "
    f"and (input::text like '%{MCP_BATCH_KEY}%' or input::text like '%{REST_BATCH_KEY}%');"
)
ok("MCP 操作全落審計且歸屬本人（actor_id）", mine.isdigit() and int(mine) >= 20, f"{mine} 筆")
ok("唯讀／隔離被擋也留審計（ok=false）", fails.isdigit() and int(fails) >= 8, f"{fails} 筆")
ok("審計資料不落原始 idempotency key", raw_key_audits == "0")

# ══════════ PostgreSQL 持久失敗封鎖 ══════════
print("\n######## MCP PostgreSQL 失敗限流 ########")
# 第 10 次失敗寫入 blockedUntil，但該次仍維持「金鑰錯誤」401；下一次在解析金鑰前即 429。
bad_codes = [
    mcp_raw("tools/list", None, f"aidmcp_invalid_rate_limit_{i:02d}")[0]
    for i in range(10)
]
blocked_code = mcp_raw("tools/list", None, "aidmcp_invalid_rate_limit_blocked")[0]
ok("MCP 限流：1 分鐘 10 次失敗皆 401，後續封鎖 5 分鐘回 429",
   bad_codes == [401] * 10 and blocked_code == 429)

# ══════════ 總結 ══════════
print("\n" + "=" * 60)
print(f"—— 斷言 {_passed + _failed} 項：✅ {_passed}/❌ {_failed} ——")
sys.exit(1 if _failed else 0)
