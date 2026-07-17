#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端測試（MCP 專區）：對真跑的伺服器逐一驗證全部 23 個 MCP 工具，以及每一道守門——
唯讀範圍（擋所有寫入、放行所有讀取）、到期／撤銷／壞金鑰一律 401、跨組隔離（別人的金鑰
碰不到你的專案）、封存專案寫入守衛、資料庫 AI 存取等級（none/read）閘門、跨介面審計歸屬。

與 CI 其他 e2e 同口徑：E2E_MOCK=1（假生成，plan/submit 走 mockPlan／假 fal，不需外部金鑰）。
需要 MCP_API_KEY 設定才會「啟用」端點（否則 handleMcp 回 404 不張揚）——CI 已設 test-mcp-key。
"""
import json, os, sys, subprocess, datetime, urllib.request, urllib.error

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local")
PW = os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123")
DB = os.environ.get("PGDATABASE", "postgres")
PGHOST = os.environ.get("PGHOST", "localhost")
PGUSER = os.environ.get("PGUSER", "postgres")

_passed = _failed = 0
def ok(name, cond, detail=""):
    global _passed, _failed
    if cond: _passed += 1; print(f"✅ {name}" + (f"  — {detail}" if detail else ""))
    else: _failed += 1; print(f"❌ {name}" + (f"  — {detail}" if detail else ""))

def _psql(sql):
    return subprocess.run(["psql", f"host={PGHOST} user={PGUSER} dbname={DB}", "-tAc", sql],
                          capture_output=True, text=True, env={**os.environ, "PGPASSWORD": os.environ.get("PGPASSWORD", "postgres")}).stdout.strip()

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
    "list_generations","get_generation","list_assets","list_databases","query_database","add_database_row",
    "list_database_files","read_database_file","plan_agent","approve_agent","stop_agent","discard_agent",
    "list_agent_runs","get_agent_run","list_schedule","add_schedule_item","get_project_status",
    "list_notes","get_note"}  # 筆記兩工具（calendar-mcp-knowledge-map）
ok("tools/list = 25 且名單完整", len(names) == 25 and EXPECTED <= names, f"{len(names)} 個")

# ══════════ 23 工具逐一實跑（可寫金鑰）══════════
print("\n######## 23 工具逐一實跑 ########")
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
g, r = call("list_databases", {}, FULL)
vis = {t["tableId"] for t in r} if g else set()
ok("9. list_databases（可寫＋唯讀可見、none 不可見）",
   g and TID in vis and TID_RO in vis and TID_NONE not in vis, f"{len(vis)} 個庫")
g, r = call("query_database", {"tableId": TID}, FULL); ok("10. query_database（初始空）", g and r["rows"] == [])
g, r = call("add_database_row", {"tableId": TID, "data": {"item": "腳架", "qty": 3}}, FULL)
ok("11. add_database_row", g and r.get("rowId"))
g, r = call("query_database", {"tableId": TID, "keyword": "腳架"}, FULL)
ok("10b. query_database（關鍵字命中唯一列）", g and len(r["rows"]) == 1 and r["rows"][0]["data"]["item"] == "腳架")
g, r = call("list_database_files", {"tableId": TID}, FULL); ok("12. list_database_files（空）", g and r == [])
g, r = call("read_database_file", {"fileId": "00000000-0000-0000-0000-000000000000"}, FULL)
ok("13. read_database_file（不存在→報錯）", (not g) and "找不到" in r)
g, r = call("plan_agent", {"projectId": PID, "goal": "把知識庫腳本拆成分鏡並逐鏡出圖"}, FULL)
RUN = r.get("runId") if g and isinstance(r, dict) else None
ok("14. plan_agent（排出多步計畫）", g and RUN and len(r["steps"]) > 0, f'{len(r.get("steps",[])) if isinstance(r,dict) else 0} 步')
g, r = call("get_agent_run", {"runId": RUN}, FULL); ok("15. get_agent_run（待核准）", g and r["status"] == "awaiting_approval")
g, r = call("list_agent_runs", {"projectId": PID}, FULL); ok("16. list_agent_runs（含本 run）", g and any(x["runId"] == RUN for x in r))
g, r = call("approve_agent", {"runId": RUN}, FULL)
ok("17. approve_agent（狀態真的離開待核准）", g and r["status"] in ("running", "done"), r.get("status") if isinstance(r, dict) else r)
g, r = call("stop_agent", {"runId": RUN}, FULL); ok("18. stop_agent", g and r["status"] in ("stopped", "done"))
g, r2 = call("plan_agent", {"projectId": PID, "goal": "另一個計畫供放棄測試用途"}, FULL)
RUN2 = r2.get("runId") if g and isinstance(r2, dict) else None
g, r = call("discard_agent", {"runId": RUN2}, FULL); ok("19. discard_agent", g and r["status"] == "discarded")
future = (datetime.datetime.utcnow() + datetime.timedelta(days=5)).replace(microsecond=0).isoformat() + "Z"
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
    "list_agent_runs": {"projectId": PID}, "get_agent_run": {"runId": RUN}, "list_schedule": {"projectId": PID},
    "get_project_status": {"projectId": PID}}
allread = all(call(n, a, RO)[0] for n, a in READS.items())
ok(f"唯讀金鑰放行全部 {len(READS)} 個讀取工具", allread)
WRITES = {"submit_generation": {"projectId": PID, "modelId": MODEL, "prompt": "x"}, "post_message": {"projectId": PID, "body": "x"},
    "add_database_row": {"tableId": TID, "data": {"item": "x"}}, "plan_agent": {"projectId": PID, "goal": "應被唯讀擋下"},
    "approve_agent": {"runId": RUN}, "stop_agent": {"runId": RUN}, "discard_agent": {"runId": RUN},
    "add_schedule_item": {"projectId": PID, "title": "x", "startsAt": future}}
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
                 "plan_agent": {"projectId": PID, "goal": "偷別組專案"}}.items():
        g, r = call(n, a, U2)
        if not ((not g) and BLOCKED(r)): isolated = False; print(f"   ⚠ 未被擋: {n} — {r}")
    ok("U2 對別組專案的 7 個讀寫工具全被擋", isolated)

# ══════════ 封存專案寫入守衛 ══════════
print("\n######## 封存專案寫入守衛 ########")
admin.call("projects.setArchived", {"id": PID, "archived": True})
archived_blocked = True
for n, a in {"post_message": {"projectId": PID, "body": "x"},
             "add_schedule_item": {"projectId": PID, "title": "x", "startsAt": future},
             "plan_agent": {"projectId": PID, "goal": "封存專案不該能排計畫"},
             "submit_generation": {"projectId": PID, "modelId": MODEL, "prompt": "x"}}.items():
    g, r = call(n, a, FULL)
    if not ((not g) and "封存" in r): archived_blocked = False; print(f"   ⚠ 未被擋: {n} — {r}")
ok("封存專案擋下全部 4 個寫入工具", archived_blocked)
g, r = call("get_project_context", {"projectId": PID}, FULL); ok("封存後讀取仍放行", g and isinstance(r, dict))
admin.call("projects.setArchived", {"id": PID, "archived": False})

# ══════════ 審計歸屬（actorId=本人）══════════
print("\n######## 跨介面審計歸屬 ########")
mine = _psql(f"select count(*) from audit_log where action like 'mcp.%' and actor_id = '{UID}';")
fails = _psql(f"select count(*) from audit_log where action like 'mcp.%' and ok = false and actor_id = '{UID}';")
ok("MCP 操作全落審計且歸屬本人（actor_id）", mine.isdigit() and int(mine) >= 20, f"{mine} 筆")
ok("唯讀／隔離被擋也留審計（ok=false）", fails.isdigit() and int(fails) >= 8, f"{fails} 筆")

# ══════════ 總結 ══════════
print("\n" + "=" * 60)
print(f"—— 斷言 {_passed + _failed} 項：✅ {_passed}/❌ {_failed} ——")
sys.exit(1 if _failed else 0)
