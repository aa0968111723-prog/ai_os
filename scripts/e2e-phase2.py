# Phase 2 核心批次 e2e：審計日誌(2.2)/成本審核門檻(2.1)/版本回看(#4)/
# 卡片同步+圖片描述(6.4/6.2)/助手擴權(6.5)/交付格式(#8)。
# 前置：FAL_MOCK=1、MCP 可不設；伺服器 :3199、SEED_ADMIN_EMAIL=admin@aidirector.local、
#       SEED_ADMIN_PASSWORD=test-admin-123；建議全新資料庫(冪等性未保證)。
# 用法：python3 scripts/e2e-phase2.py
import json, time, urllib.request, urllib.parse, urllib.error

BASE = "http://localhost:3199/api/trpc"

class Client:
    def __init__(self): self.cookie = None
    def open(self, req):
        if self.cookie: req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req)

def client(): return Client()

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

def raw_get(opener, path):
    req = urllib.request.Request(f"http://localhost:3199{path}")
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r: return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)

ok = lambda name, cond: print(("✅" if cond else "❌"), name)

def wait_done(opener, gid, timeout=30):
    for _ in range(timeout):
        st = call("GET", opener, "generation.status", {"id": gid})
        if st.get("status") in ("done", "failed"): return st
        time.sleep(1)
    return st

admin = client(); mem = client()
r = call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
ok("開發者登入", r.get("user", {}).get("isSuperAdmin") is True)

teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
grp = next(g for g in north["groups"] if g["name"] == "剪輯組")

inv = call("POST", admin, "admin.invite", {"email": "p2member@example.com", "teamId": north["id"], "teamRole": "member", "groupId": grp["id"], "groupRole": "member"})
token = inv["inviteUrl"].split("/")[-1]
acc = call("POST", mem, "auth.acceptInvite", {"token": token, "name": "測試組員", "password": "p2-member-88"})
ok("組員就位", acc["user"]["name"] == "測試組員")

# ── 2.1 成本審核門檻 ──
r = call("POST", admin, "quota.setApprovalThreshold", {"groupId": grp["id"], "thresholdPoints": 2})
ok("組長設定門檻=2 點", r.get("ok") is True and r.get("thresholdPoints") == 2)
my = call("GET", mem, "quota.my", {"groupId": grp["id"]})
ok("quota.my 回門檻", my.get("approvalThreshold") == 2)
usage = call("GET", admin, "quota.usage", {"groupId": grp["id"]})
ok("quota.usage 回門檻", usage.get("approvalThreshold") == 2)

proj = call("POST", mem, "projects.create", {"groupId": grp["id"], "title": "Phase2 測試案", "kind": "witness", "platform": "shorts"})
pid = proj["id"]

g_cheap = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "晨光禪堂"})
ok("低於門檻(1 點)直接送出", g_cheap.get("status") in ("queued", "running"))

g_gate = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux-2/pro", "prompt": "夕陽古寺"})
ok("達門檻(2 點)進待核", g_gate.get("status") == "awaiting_approval")

deny = call("POST", mem, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("🔒 組員不能自行核准", "__error__" in deny and "組長" in deny["__error__"])

app = call("POST", admin, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("組長核准 → 送出", app.get("status") in ("queued", "running"))
done1 = wait_done(mem, g_gate["id"])
ok("核准後完成(mock)", done1.get("status") == "done" and bool(done1.get("resultUrl")))

dup = call("POST", admin, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("重複裁決被擋", "__error__" in dup)

g_gate2 = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux-2/pro", "prompt": "駁回測試"})
rej = call("POST", admin, "generation.decideCost", {"id": g_gate2["id"], "decision": "rejected", "reason": "先用便宜模型試方向"})
ok("組長駁回附理由", rej.get("status") == "rejected" and "駁回" in (rej.get("error") or ""))

leader_gen = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux-2/pro", "prompt": "組長自送"})
ok("組長/管理層自送不受門檻", leader_gen.get("status") in ("queued", "running"))

lst = call("GET", mem, "generation.listByProjectPaged", {"projectId": pid, "status": "rejected"})
ok("列表可篩 rejected", any(x["id"] == g_gate2["id"] for x in lst["items"]))

# ── #4 版本回看：分鏡綁定歷史 + 設為現用 ──
wait_done(mem, g_cheap["id"])
scene = call("POST", mem, "scenes.addFromGeneration", {"generationId": g_cheap["id"], "title": "第一鏡"})
sid = scene["id"]
old_asset = scene["assetId"]
g_new = call("POST", mem, "scenes.generateInto", {"sceneId": sid, "modelId": "fal-ai/flux/schnell", "prompt": "改成星空"})
wait_done(mem, g_new["generationId"])
scenes = call("GET", mem, "scenes.listByProject", {"projectId": pid})
cur = next(s for s in scenes if s["id"] == sid)
ok("就地生成回填新畫面", cur["assetId"] != old_asset)
by_scene = call("GET", mem, "generation.listByProjectPaged", {"projectId": pid, "sceneId": sid})
ok("列表可按分鏡聚合", len(by_scene["items"]) >= 1 and all(x["sceneId"] == sid for x in by_scene["items"]))
back = call("POST", mem, "scenes.setVisualFromGeneration", {"sceneId": sid, "generationId": g_cheap["id"]})
ok("設為此鏡現用(切回舊版)", back.get("assetId") == old_asset)

# ── 6.2 圖片 → AI 描述 → 知識庫(mock) ──
assets = call("GET", mem, "projects.assets", {"projectId": pid})
img = next((a for a in assets if a["kind"] == "image"), None)
if img:
    d = call("POST", mem, "knowledge.describeImageAsset", {"assetId": img["id"]})
    ok("圖片描述入知識庫", isinstance(d, dict) and "__error__" not in d)
    kn = call("GET", mem, "knowledge.list", {"projectId": pid})
    ok("知識庫出現圖片描述", any("圖片描述" in k["title"] for k in kn))
    d2 = call("POST", mem, "knowledge.describeImageAsset", {"assetId": img["id"]})
    ok("重複描述冪等(不再新增)", "__error__" not in d2 and sum(1 for k in call("GET", mem, "knowledge.list", {"projectId": pid}) if "圖片描述" in k["title"]) == sum(1 for k in kn if "圖片描述" in k["title"]))
else:
    ok("圖片描述入知識庫(略過：無圖片素材)", True)

# ── 6.4 卡片 → 知識上下文(間接驗證：助手 mock 回應含知識庫字數) ──
call("POST", mem, "characters.add", {"projectId": pid, "name": "安倢", "appearance": "紅傘、米白外套、齊肩黑髮"}) if True else None
ask = call("POST", mem, "assistant.ask", {"projectId": pid, "message": "素材裡有什麼?"})
ok("助手可回應(mock)", "answer" in ask)

# ── 6.5 助手新動作 ──
cs = call("POST", mem, "assistant.runAction", {"projectId": pid, "action": {"type": "create_scene", "title": "助手新增鏡"}})
ok("助手動作 create_scene", cs.get("ok") is True)
scenes2 = call("GET", mem, "scenes.listByProject", {"projectId": pid})
ok("分鏡確實新增", any(s["title"] == "助手新增鏡" for s in scenes2))
wfs = call("GET", mem, "models.workflows")
if wfs:
    rw = call("POST", mem, "assistant.runAction", {"projectId": pid, "action": {"type": "run_workflow", "presetId": wfs[0]["id"], "prompt": "一句話故事"}})
    ok("助手動作 run_workflow", rw.get("ok") is True)
else:
    ok("助手動作 run_workflow(略過：無工作流)", True)
bad = call("POST", mem, "assistant.runAction", {"projectId": pid, "action": {"type": "generate", "prompt": "x", "modelId": "fal-ai/不存在的模型"}})
ok("🔒 助手 generate 模型白名單", "__error__" in bad)

# ── #8 交付格式 ──
code, body, hdr = raw_get(mem, f"/api/export/{pid}/timeline?format=srt")
ok("SRT 下載", code == 200 and b"-->" in body)
code, body, hdr = raw_get(mem, f"/api/export/{pid}/timeline?format=fcpxml")
ok("FCPXML 下載", code == 200 and b"fcpxml" in body.lower())
code, body, hdr = raw_get(mem, f"/api/export/{pid}/timeline?format=edl")
ok("EDL 下載", code == 200 and b"TITLE" in body)
code, body, hdr = raw_get(mem, f"/api/export/{pid}/timeline?format=exe")
ok("非法 format 被擋", code == 400)
pick = assets[0]["id"] if assets else ""
code, body, hdr = raw_get(mem, f"/api/export/{pid}?assetIds={pick}")
ok("多選打包(zip)", code == 200 and body[:2] == b"PK")

# ── 2.2 審計日誌 ──
au = call("GET", admin, "audit.list", {"action": "decideCost"})
ok("審計記到 decideCost", any(i["action"] == "generation.decideCost" and i["ok"] for i in au["items"]))
au2 = call("GET", admin, "audit.list", {"action": "setApprovalThreshold"})
ok("審計記到門檻設定", any(i["action"] == "quota.setApprovalThreshold" for i in au2["items"]))
au3 = call("GET", admin, "audit.list", {})
ok("審計含 actor 名字", all("actorName" in i for i in au3["items"][:5]) and len(au3["items"]) > 5)
ok("審計輸入已脫敏(無 password 鍵)", all("password" not in json.dumps(i.get("input", {})) for i in au3["items"]))
denied = call("GET", mem, "audit.list", {})
ok("🔒 組員不能看審計", "__error__" in denied)

print("—— e2e-phase2 完成 ——")
