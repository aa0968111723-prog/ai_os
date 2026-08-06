import json, urllib.request, urllib.parse, urllib.error, http.cookiejar

import os as _os
HOST = f"http://localhost:{_os.environ.get('E2E_PORT', '3199')}"  # E2E_PORT 可換埠(與研究/其他行程共存)
BASE = f"{HOST}/api/trpc"
class Client:
    def __init__(self): self.cookie = None
    def open(self, req):
        if self.cookie: req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req)
def client():
    return Client()
def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if data is None and op == "GET":
        req = urllib.request.Request(url)
    elif op == "GET":
        req = urllib.request.Request(url + "?input=" + urllib.parse.quote(json.dumps({"json": data})))
    else:
        req = urllib.request.Request(url, data=json.dumps({"json": data}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req) as r:
            sc = r.headers.get("Set-Cookie")
            if sc: opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if "error" in body: return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]

admin = client(); azhe = client()
from e2e_lib import ok  # 共用斷言:計數+結束碼(有 ❌ 即非零退出,CI 據此判紅綠)

r = call("POST",admin,"auth.login",{"email":"admin@aidirector.local","password":"test-admin-123"})
ok("開發者登入", r.get("user",{}).get("isSuperAdmin") is True)

teams = call("GET",admin,"admin.overview")
north = next(t for t in teams if t["name"]=="北區工作組")
edit_group = next(g for g in north["groups"] if g["name"]=="剪輯組")
anim_group = next(g for t in teams for g in t["groups"] if g["name"]=="動畫組")
ok("總覽：2 團隊 3 組", len(teams)==2 and sum(len(t["groups"]) for t in teams)==3)

inv = call("POST",admin,"admin.invite",{"email":"azhe@example.com","teamId":north["id"],"teamRole":"member","groupId":edit_group["id"],"groupRole":"member"})
token = inv["inviteUrl"].split("/")[-1]
ok("邀請連結產生（72h）", inv["expiresInHours"]==72 and len(token)>=40)

acc = call("POST",azhe,"auth.acceptInvite",{"token":token,"name":"阿哲","password":"azhe-pass-88"})
ok("阿哲接受邀請＋自動登入", acc["user"]["name"]=="阿哲" and acc["groups"][0]["groupName"]=="剪輯組" and acc["groups"][0]["role"]=="member")

reuse = call("POST",client(),"auth.acceptInvite",{"token":token,"name":"壞人","password":"hacker-pass-99"})
ok("邀請一次性（重用被擋）", "__error__" in reuse)

proj = call("POST",azhe,"projects.create",{"groupId":edit_group["id"],"title":"見證故事測試","kind":"witness","platform":"shorts"})
ok("阿哲建專案（9:16 自動）", proj["format"]=="9:16")

gen = call("POST",azhe,"generation.submit",{"projectId":proj["id"],"modelId":"fal-ai/flux/schnell","prompt":"晨光禪堂"})
ok("阿哲生成扣 1 點", gen["pointsEst"]==1 and gen["status"] in ("queued","running"))

cross = call("POST",azhe,"projects.create",{"groupId":anim_group["id"],"title":"越權測試","kind":"promo","platform":"youtube"})
ok("🔒 阿哲在動畫組建專案被擋", cross.get("__error__")=="你不屬於這個組")

aproj = call("POST",admin,"projects.create",{"groupId":anim_group["id"],"title":"動畫組機密專案","kind":"promo","platform":"youtube"})
read = call("GET",azhe,"projects.get",{"id":aproj["id"]})
ok("🔒 阿哲讀動畫組專案被擋", read.get("__error__")=="你不屬於這個組")

lst = call("GET",azhe,"projects.list",{})
ok("阿哲僅見剪輯組專案", [p["title"] for p in lst]==["見證故事測試"])

alst = call("GET",admin,"projects.list",{})
ok("開發者跨組看全部（2 專案）", len(alst)==2)

msg = call("POST",azhe,"messages.post",{"projectId":proj["id"],"body":"登入系統測試完成 🙏"})
msgs = call("GET",azhe,"messages.list",{"projectId":proj["id"]})
msgs = msgs["items"] if isinstance(msgs, dict) and "items" in msgs else msgs
ok("留言含姓名", msgs[-1]["userName"]=="阿哲")

call("POST",azhe,"auth.logout",None)
me = call("GET",azhe,"auth.me")
ok("登出後 session 失效", me is None)

# ─── 第二段：彈性點數＋分鏡＋交付包 ───
admin2 = client(); azhe2 = client()
call("POST",admin2,"auth.login",{"email":"admin@aidirector.local","password":"test-admin-123"})
call("POST",azhe2,"auth.login",{"email":"azhe@example.com","password":"azhe-pass-88"})

qs = call("GET",admin2,"quota.getSettings")
ok("全域設定存在（初始 5000/300，可調）", qs["totalBudgetPoints"]==5000 and qs["defaultWeeklyPoints"]==300)

# 組長/管理員把剪輯組週額度調到 1 → 阿哲已用 1 點 → 再生成被擋
call("POST",admin2,"quota.setGroupQuota",{"groupId":edit_group["id"],"weeklyPointsPerUser":1})
blocked = call("POST",azhe2,"generation.submit",{"projectId":proj["id"],"modelId":"fal-ai/flux/schnell","prompt":"再一張"})
ok("彈性額度生效（1點上限→被擋）", "本週額度不足" in blocked.get("__error__",""))

# 調成 0（不限）→ 通過
call("POST",admin2,"quota.setGroupQuota",{"groupId":edit_group["id"],"weeklyPointsPerUser":0})
gen2 = call("POST",azhe2,"generation.submit",{"projectId":proj["id"],"modelId":"fal-ai/flux/schnell","prompt":"晨鐘古寺"})
ok("調成不限後可生成", gen2.get("status") in ("queued","running"))

# 等假生成完成 → 加入分鏡 ×2 → 排序 → 打包
import time
for gid in [gen["id"], gen2["id"]]:
    for _ in range(10):
        st = call("GET",azhe2,"generation.status",{"id":gid})
        if st["status"]=="done": break
        time.sleep(1)
wv = {"logline":"陳師姐從憂鬱低谷走出重生","message":"把心交給佛","audience":"","themes":[],"tones":["莊嚴"],"acts":{"hook":"","turn":"","cta":""},"people":[],"styles":[],"references":[],"taboos":["不得使用醫療宣稱"]}
call("POST",azhe2,"projects.updateWorldview",{"id":proj["id"],"worldview":wv})
s1 = call("POST",azhe2,"scenes.addFromGeneration",{"generationId":gen["id"],"title":"開場"})
s2 = call("POST",azhe2,"scenes.addFromGeneration",{"generationId":gen2["id"],"title":"晨鐘"})
ok("兩鏡加入分鏡", s1["orderIndex"]==1 and s2["orderIndex"]==2)
call("POST",azhe2,"scenes.move",{"sceneId":s2["id"],"direction":"up"})
lst2 = call("GET",azhe2,"scenes.listByProject",{"projectId":proj["id"]})
ok("↑ 排序生效（晨鐘變第一）", lst2[0]["title"]=="晨鐘")

# 交付包：下載 zip 驗證內容
req = urllib.request.Request(f"{HOST}/api/export/{proj['id']}")
req.add_header("Cookie", azhe2.cookie)
with urllib.request.urlopen(req) as r:
    ct = r.headers.get("Content-Type"); data = r.read()
import io, zipfile
zf = zipfile.ZipFile(io.BytesIO(data))
names = zf.namelist()
doc = zf.read("05_文件/腳本與鏡頭表.md").decode()
ok("交付包為 zip 且含圖像/文件/README", ct=="application/zip" and any(n.startswith("03_圖像/") for n in names) and "README.txt" in names)
ok("鏡頭表含世界觀與兩鏡", "晨鐘" in doc and "開場" in doc and "陳師姐" in doc)

# 隔離：別組成員不能下載
req2 = urllib.request.Request(f"{HOST}/api/export/{aproj['id']}")
req2.add_header("Cookie", azhe2.cookie)
try:
    urllib.request.urlopen(req2); ok("🔒 交付包隔離", False)
except urllib.error.HTTPError as e:
    ok("🔒 交付包隔離（403）", e.code==403)

# ─── 第三段：AI 導演＋回饋＋MCP ───
# （分鏡送審／裁決機制已移除，這段原本的審批三態機驗證一併拿掉）
# 把阿哲升組長（開發者操作）——後續 MCP／回饋仍需要組長身分
call("POST",admin2,"admin.setGroupRole",{"groupId":edit_group["id"],"userId":acc["user"]["id"],"role":"leader"})
azhe3 = client(); call("POST",azhe3,"auth.login",{"email":"azhe@example.com","password":"azhe-pass-88"})

sug = call("POST",azhe3,"director.suggest",{"projectId":proj["id"]})
ok("AI 導演給 3 個 idea（含世界觀）", len(sug["suggestions"])==3 and "陳師姐" in sug["suggestions"][0]["prompt"])

fb = call("POST",azhe3,"feedback.submit",{"scores":{"context":5,"cost":4,"collab":5,"ai":4,"daily":4,"usability":5},"best":"不用重複解釋背景","worst":"想要更快"})
fbl = call("GET",admin2,"feedback.list")
ok("回饋送出＋管理員可見", fbl[0]["userName"]=="阿哲" and fbl[0]["best"]=="不用重複解釋背景")

# MCP：initialize / tools list / call
def mcp(method, params=None, key="test-mcp-key"):
    req = urllib.request.Request(f"{HOST}/api/mcp", data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params or {}}).encode(),
                                 headers={"Content-Type":"application/json","x-api-key":key}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"http": e.code}
ok("MCP 錯誤金鑰被擋", mcp("tools/list", key="wrong").get("http")==401)
init = mcp("initialize")
ok("MCP initialize", init["result"]["serverInfo"]["name"]=="ai-director-os")
tl = mcp("tools/list")
tool_names = {t["name"] for t in tl["result"]["tools"]}
ok("MCP tools/list（完整工具集：基礎＋生成取回＋資料庫＋代理＋排程＋統整）",
   len(tl["result"]["tools"]) >= 23 and
   {"whoami","list_projects","get_project_context","submit_generation","post_message",
    "find_model","list_generations","get_generation","list_assets",
    "list_databases","query_database","add_database_row","list_database_files","read_database_file",
    "plan_agent","approve_agent","stop_agent","discard_agent","list_agent_runs","get_agent_run",
    "list_schedule","add_schedule_item","get_project_status"} <= tool_names)
tc = mcp("tools/call",{"name":"list_projects","arguments":{}})
projects_via_mcp = json.loads(tc["result"]["content"][0]["text"])
ok("MCP list_projects 可用", any(p["title"]=="見證故事測試" for p in projects_via_mcp))
tc2 = mcp("tools/call",{"name":"get_project_context","arguments":{"projectId":proj["id"]}})
ctx2 = json.loads(tc2["result"]["content"][0]["text"])
ok("MCP 讀專案上下文（含世界觀）", ctx2["worldview"]["logline"].startswith("陳師姐"))

# P0：MCP 是最高權限介面，每次工具呼叫（成功/失敗）都要落審計——過去完全零軌跡。
# 審計是 fire-and-forget 非同步寫入：用輪詢等落庫（最多 10 秒），不賭固定 sleep
import time as _t

# pred 收「整頁 rows」：兩筆 mcp 審計是各自 fire-and-forget，逐筆判斷會在第一筆落庫、
# 第二筆還在路上時提前收手（CI 實際踩過：len>=2 與 projectId 斷言雙紅）——要等到完整條件成立才回傳
def wait_audit(pred, timeout=10):
    rows = []
    for _ in range(timeout * 2):
        rows = call("GET", admin2, "audit.list", {}).get("items", [])
        if pred(rows):
            return rows
        _t.sleep(0.5)
    return rows

def _mcp_rows(rows):
    return [i for i in rows if str(i.get("action", "")).startswith("mcp.")]

rows = wait_audit(lambda rows: len(_mcp_rows(rows)) >= 2 and any(i.get("projectId") == proj["id"] for i in _mcp_rows(rows)))
mcp_rows = _mcp_rows(rows)
ok("MCP 呼叫落審計(mcp.* action)", len(mcp_rows) >= 2)
ok("MCP 審計帶 projectId 歸屬", any(i.get("projectId") == proj["id"] for i in mcp_rows))
bad = mcp("tools/call", {"name": "get_project_context", "arguments": {"projectId": "00000000-0000-0000-0000-000000000000"}})
ok("MCP 錯誤呼叫回 JSON-RPC error", "error" in bad)
rows2 = wait_audit(lambda rows: any(i.get("ok") is False for i in _mcp_rows(rows)))
ok("MCP 失敗呼叫也落審計(ok=false)", any(i.get("ok") is False for i in _mcp_rows(rows2)))

# ─── 強制改密碼跨傳輸層守門 ───
# tRPC 原本已有閘門；這裡特別驗直接 Express 端點，防止用既有 session 繞過。
reset = call("POST", admin2, "admin.resetMemberPassword", {"userId": acc["user"]["id"]})
restricted = client()
restricted_login = call("POST", restricted, "auth.login", {
    "email": "azhe@example.com",
    "password": reset["tempPassword"],
})
ok("臨時密碼可登入且標記必須改密碼", restricted_login.get("user", {}).get("mustChangePassword") is True)
blocked_trpc = call("GET", restricted, "projects.list", {})
ok("🔒 強制改密碼：tRPC 功能被擋", "先" in blocked_trpc.get("__error__", "") and "密碼" in blocked_trpc.get("__error__", ""))

direct = urllib.request.Request(f"{HOST}/api/me/export")
direct.add_header("Cookie", restricted.cookie)
try:
    urllib.request.urlopen(direct)
    ok("🔒 強制改密碼：Express 端點被擋", False)
except urllib.error.HTTPError as e:
    direct_body = json.load(e)
    ok(
        "🔒 強制改密碼：Express 端點被擋（403＋穩定代碼）",
        e.code == 403 and direct_body.get("code") == "PASSWORD_CHANGE_REQUIRED",
    )

changed = call("POST", restricted, "auth.changePassword", {
    "oldPassword": reset["tempPassword"],
    "newPassword": "azhe-pass-99",
})
ok("完成改密碼後解除守門", changed.get("ok") is True and isinstance(call("GET", restricted, "projects.list", {}), list))

# ─── PostgreSQL 跨 replica 登入限流（同 email 15 分鐘 5 次） ───
# 前 5 次仍走等成本 dummy bcrypt 並回統一未授權；第 6 次由持久限流桶拒絕。
brute = client()
first_five = [
    call("POST", brute, "auth.login", {"email": "brute-force@example.com", "password": f"wrong-{i}"})
    for i in range(5)
]
sixth = call("POST", brute, "auth.login", {"email": "brute-force@example.com", "password": "wrong-6"})
ok("PostgreSQL 登入限流：前 5 次統一拒絕、第 6 次回 429 語意",
   all("email 或密碼不正確" in item.get("__error__", "") for item in first_five)
   and "嘗試太多次" in sixth.get("__error__", ""))
