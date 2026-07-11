import json, urllib.request, urllib.parse, urllib.error, http.cookiejar

BASE = "http://localhost:3199/api/trpc"
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
ok = lambda name, cond: print(("✅" if cond else "❌"), name)

r = call("POST",admin,"auth.login",{"email":"admin@aidirector.local","password":"test-admin-123"})
ok("超管登入", r.get("user",{}).get("isSuperAdmin") is True)

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
ok("超管跨組看全部（2 專案）", len(alst)==2)

msg = call("POST",azhe,"messages.post",{"projectId":proj["id"],"body":"登入系統測試完成 🙏"})
msgs = call("GET",azhe,"messages.list",{"projectId":proj["id"]})
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
req = urllib.request.Request(f"http://localhost:3199/api/export/{proj['id']}")
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
req2 = urllib.request.Request(f"http://localhost:3199/api/export/{aproj['id']}")
req2.add_header("Cookie", azhe2.cookie)
try:
    urllib.request.urlopen(req2); ok("🔒 交付包隔離", False)
except urllib.error.HTTPError as e:
    ok("🔒 交付包隔離（403）", e.code==403)

# ─── 第三段：審批三態機＋AI 導演＋回饋＋MCP ───
# 把阿哲升組長來測裁決（超管操作）
call("POST",admin2,"admin.setGroupRole",{"groupId":edit_group["id"],"userId":acc["user"]["id"],"role":"leader"})
azhe3 = client(); call("POST",azhe3,"auth.login",{"email":"azhe@example.com","password":"azhe-pass-88"})

sub = call("POST",azhe3,"approvals.submit",{"sceneId":s1["id"]})
ok("送審 v1（分鏡進待審）", sub["version"]==1 and sub["status"]=="pending")
noreason = call("POST",azhe3,"approvals.decide",{"approvalId":sub["id"],"decision":"needs_work"})
ok("退回必附理由（被擋）", "理由" in noreason.get("__error__",""))
dec = call("POST",azhe3,"approvals.decide",{"approvalId":sub["id"],"decision":"needs_work","reason":"光太暗，柔一點"})
ok("退回 v1（附理由）", dec["status"]=="needs_work")
sub2 = call("POST",azhe3,"approvals.submit",{"sceneId":s1["id"]})
ok("重送=v2", sub2["version"]==2)
dec2 = call("POST",azhe3,"approvals.decide",{"approvalId":sub2["id"],"decision":"approved"})
ok("v2 通過", dec2["status"]=="approved")
msgs2 = call("GET",azhe3,"messages.list",{"projectId":proj["id"]})
sysmsgs = [m for m in msgs2 if m["kind"]=="system"]
ok("審批事件進留言（系統訊息×4）", len(sysmsgs)>=4 and any("需修改" in m["body"] for m in sysmsgs) and any("已通過" in m["body"] for m in sysmsgs))

sug = call("POST",azhe3,"director.suggest",{"projectId":proj["id"]})
ok("AI 導演給 3 個 idea（含世界觀）", len(sug["suggestions"])==3 and "陳師姐" in sug["suggestions"][0]["prompt"])

fb = call("POST",azhe3,"feedback.submit",{"scores":{"context":5,"cost":4,"collab":5,"ai":4,"daily":4,"usability":5},"best":"不用重複解釋背景","worst":"想要更快"})
fbl = call("GET",admin2,"feedback.list")
ok("回饋送出＋管理員可見", fbl[0]["userName"]=="阿哲" and fbl[0]["best"]=="不用重複解釋背景")

# MCP：initialize / tools list / call
def mcp(method, params=None, key="test-mcp-key"):
    req = urllib.request.Request("http://localhost:3199/api/mcp", data=json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params or {}}).encode(),
                                 headers={"Content-Type":"application/json","x-api-key":key}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"http": e.code}
ok("MCP 錯誤金鑰被擋", mcp("tools/list", key="wrong").get("http")==401)
init = mcp("initialize")
ok("MCP initialize", init["result"]["serverInfo"]["name"]=="ai-director-os")
tl = mcp("tools/list")
ok("MCP tools/list（4 工具）", len(tl["result"]["tools"])==4)
tc = mcp("tools/call",{"name":"list_projects","arguments":{}})
projects_via_mcp = json.loads(tc["result"]["content"][0]["text"])
ok("MCP list_projects 可用", any(p["title"]=="見證故事測試" for p in projects_via_mcp))
tc2 = mcp("tools/call",{"name":"get_project_context","arguments":{"projectId":proj["id"]}})
ctx2 = json.loads(tc2["result"]["content"][0]["text"])
ok("MCP 讀專案上下文（含世界觀）", ctx2["worldview"]["logline"].startswith("陳師姐"))
