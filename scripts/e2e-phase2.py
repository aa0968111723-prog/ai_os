# Phase 2 核心批次 e2e：審計日誌(2.2)/成本審核門檻(2.1)/版本回看(#4)/
# 卡片同步+圖片描述(6.4/6.2)/助手擴權(6.5)/交付格式(#8)。
# 前置：E2E_MOCK=1、MCP 可不設；伺服器 :3199、SEED_ADMIN_EMAIL=admin@aidirector.local、
#       SEED_ADMIN_PASSWORD=test-admin-123；建議全新資料庫(冪等性未保證)。
# 用法：python3 scripts/e2e-phase2.py
import json, time, urllib.request, urllib.parse, urllib.error

import os as _os
HOST = f"http://localhost:{_os.environ.get('E2E_PORT', '3199')}"  # E2E_PORT 可換埠(與研究/其他行程共存)
BASE = f"{HOST}/api/trpc"

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
    req = urllib.request.Request(f"{HOST}{path}")
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r: return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)

from e2e_lib import ok  # 共用斷言:計數+結束碼(有 ❌ 即非零退出,CI 據此判紅綠)

def wait_done(opener, gid, timeout=30):
    for _ in range(timeout):
        st = call("GET", opener, "generation.status", {"id": gid})
        if st.get("status") in ("done", "failed"): return st
        time.sleep(1)
    return st

def wait_workflow(opener, project_id, run_id, wanted, timeout=30):
    current = None
    for _ in range(timeout * 2):
        rows = call("GET", opener, "workflows.listByProject", {"projectId": project_id})
        current = next((row for row in rows if row["id"] == run_id), None)
        if current and current.get("status") == wanted:
            return current
        time.sleep(0.5)
    return current

def wait_workflow_generation(opener, project_id, run_id, status, timeout=30):
    for _ in range(timeout * 2):
        page = call("GET", opener, "generation.listByProjectPaged", {"projectId": project_id, "status": status})
        hit = next((row for row in page.get("items", []) if row.get("workflowRunId") == run_id), None)
        if hit:
            return hit
        time.sleep(0.5)
    return None

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

g_gate = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "openai/gpt-image-2", "prompt": "夕陽古寺"})
ok("達門檻(≥門檻)進待核", g_gate.get("status") == "awaiting_approval")

deny = call("POST", mem, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("🔒 組員不能自行核准", "__error__" in deny and "組長" in deny["__error__"])

app = call("POST", admin, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("組長核准 → 送出", app.get("status") in ("queued", "running"))
done1 = wait_done(mem, g_gate["id"])
ok("核准後完成(mock)", done1.get("status") == "done" and bool(done1.get("resultUrl")))

dup = call("POST", admin, "generation.decideCost", {"id": g_gate["id"], "decision": "approved"})
ok("重複裁決被擋", "__error__" in dup)

g_gate2 = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "openai/gpt-image-2", "prompt": "駁回測試"})
rej = call("POST", admin, "generation.decideCost", {"id": g_gate2["id"], "decision": "rejected", "reason": "先用便宜模型試方向"})
ok("組長駁回附理由", rej.get("status") == "rejected" and "駁回" in (rej.get("error") or ""))

leader_gen = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "openai/gpt-image-2", "prompt": "組長自送"})
ok("組長/管理層自送不受門檻", leader_gen.get("status") in ("queued", "running"))

lst = call("GET", mem, "generation.listByProjectPaged", {"projectId": pid, "status": "rejected"})
ok("列表可篩 rejected", any(x["id"] == g_gate2["id"] for x in lst["items"]))

# 工作流必須與手動生成使用同一成本門檻；過去 runner 未帶角色，組員可繞過核准直接扣點。
call("POST", admin, "quota.setApprovalThreshold", {"groupId": grp["id"], "thresholdPoints": 1})
wf_reject = call("POST", mem, "workflows.start", {
    "projectId": pid,
    "presetId": "wf/draft-minimal",
    "prompt": "工作流成本守門駁回測試",
})
wf_gate = wait_workflow_generation(mem, pid, wf_reject["id"], "awaiting_approval")
ok("🔒 工作流組員同樣進成本待核", wf_gate is not None)
if wf_gate:
    call("POST", admin, "generation.decideCost", {
        "id": wf_gate["id"],
        "decision": "rejected",
        "reason": "工作流成本測試駁回",
    })
wf_failed = wait_workflow(mem, pid, wf_reject["id"], "failed")
ok("工作流待核遭駁回後收攏 failed", wf_failed is not None and "駁回" in (wf_failed.get("error") or ""))

# 動態撤權：已送出的第一步可由組長核准收尾，但下一個付費步驟不得沿用舊 editor 權限。
wf_revoke = call("POST", mem, "workflows.start", {
    "projectId": pid,
    "presetId": "wf/draft-minimal",
    "prompt": "工作流執行中撤權測試",
})
wf_first = wait_workflow_generation(mem, pid, wf_revoke["id"], "awaiting_approval")
ok("撤權測試第一步已停在待核", wf_first is not None)
call("POST", admin, "projects.setProjectRole", {
    "projectId": pid,
    "userId": acc["user"]["id"],
    "role": "viewer",
})
if wf_first:
    call("POST", admin, "generation.decideCost", {"id": wf_first["id"], "decision": "approved"})
wf_revoked = wait_workflow(mem, pid, wf_revoke["id"], "failed")
all_after_revoke = call("GET", admin, "generation.listByProjectPaged", {"projectId": pid})
wf_generated = [row for row in all_after_revoke.get("items", []) if row.get("workflowRunId") == wf_revoke["id"]]
ok("🔒 降為 viewer 後工作流不再送下一步", wf_revoked is not None and len(wf_generated) == 1)
call("POST", admin, "projects.setProjectRole", {
    "projectId": pid,
    "userId": acc["user"]["id"],
    "role": "editor",
})
call("POST", admin, "quota.setApprovalThreshold", {"groupId": grp["id"], "thresholdPoints": 2})

# ── #4 版本回看：分鏡綁定歷史 + 設為現用 ──
wait_done(mem, g_cheap["id"])
scene = call("POST", mem, "scenes.addFromGeneration", {"generationId": g_cheap["id"], "title": "第一鏡"})
sid = scene["id"]
old_asset = scene["assetId"]
g_new = call("POST", mem, "scenes.generateInto", {"sceneId": sid, "modelId": "fal-ai/flux/schnell", "prompt": "改成星空"})
wait_done(mem, g_new["generationId"])
# #753 起（master plan §12）：就地生成是 Candidate，不 silent 改 current——
# 完成後 current 必須「還是舊畫面」，明確 Adopt 之後才回填新畫面。
scenes = call("GET", mem, "scenes.listByProject", {"projectId": pid})
cur = next(s for s in scenes if s["id"] == sid)
ok("就地生成完成後不動 current（候選）", cur["assetId"] == old_asset)
call("POST", mem, "creativeContext.adoptGeneration", {"generationId": g_new["generationId"]})
scenes = call("GET", mem, "scenes.listByProject", {"projectId": pid})
cur = next(s for s in scenes if s["id"] == sid)
ok("明確採用後回填新畫面", cur["assetId"] != old_asset)
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

# ── 6.4 角色定裝 + 場景設定卡 → 知識上下文／生成綁定 ──
char = call("POST", mem, "characters.add", {
    "projectId": pid, "name": "安倢", "appearance": "紅傘、米白外套、齊肩黑髮",
})
ok("建立角色定裝卡", "id" in char)
preset = call("POST", mem, "scenePresets.add", {
    "projectId": pid,
    "name": "禪堂前庭",
    "palette": "米金、木色、白牆",
    "lighting": "清晨柔側光",
})
ok("建立場景設定卡", "id" in preset and preset.get("name") == "禪堂前庭")
presets = call("GET", mem, "scenePresets.list", {"projectId": pid})
ok("場景清單含新建卡", any(p["id"] == preset["id"] and "米金" in p.get("palette", "") for p in presets))
# 生成同時綁角色＋場景：跨鏡光影／外觀一致
g_cards = call("POST", mem, "generation.submit", {
    "projectId": pid,
    "modelId": "fal-ai/flux/schnell",
    "prompt": "安倢站在禪堂前庭",
    "characterIds": [char["id"]],
    "scenePresetIds": [preset["id"]],
})
ok("帶角色＋場景設定的生成可送出", g_cards.get("status") in ("queued", "running", "done"))
# 外鍵場景卡 fail-closed
bad_scene = call("POST", mem, "generation.submit", {
    "projectId": pid,
    "modelId": "fal-ai/flux/schnell",
    "prompt": "假場景",
    "scenePresetIds": ["99999999-9999-4999-8999-999999999999"],
})
ok("🔒 外鍵場景設定被擋", "__error__" in bad_scene and "場景設定" in bad_scene["__error__"])
# 場景卡冪等
sid = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
p1 = call("POST", mem, "scenePresets.add", {
    "projectId": pid, "name": "雨巷", "palette": "青灰", "clientRequestId": sid,
})
p2 = call("POST", mem, "scenePresets.add", {
    "projectId": pid, "name": "雨巷改名不應新建", "palette": "墨黑", "clientRequestId": sid,
})
ok("場景設定 clientRequestId 冪等", p1.get("id") == sid and p2.get("id") == sid and p2.get("name") == p1.get("name"))
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

# ── P0 ACL：素材端點（改名/鎖定/刪除/還原/永久刪）對專案檢視者全擋 ──
me2 = call("GET", mem, "auth.me")
mem_id = me2["user"]["id"]
if assets:
    aid = assets[0]["id"]
    call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "viewer"})
    deny = call("POST", mem, "projects.renameAsset", {"assetId": aid, "title": "越權改名"})
    ok("🔒 檢視者不能改素材名", "檢視者" in deny.get("__error__", ""))
    deny = call("POST", mem, "projects.setAssetLock", {"assetId": aid, "locked": True})
    ok("🔒 檢視者不能鎖定/解鎖素材", "檢視者" in deny.get("__error__", ""))
    deny = call("POST", mem, "projects.deleteAsset", {"assetId": aid})
    ok("🔒 檢視者不能刪素材", "檢視者" in deny.get("__error__", ""))
    deny = call("POST", mem, "projects.purgeAsset", {"assetId": aid})
    ok("🔒 檢視者不能永久刪素材", "檢視者" in deny.get("__error__", ""))
    deny = call("POST", mem, "projects.restoreAsset", {"assetId": aid})
    ok("🔒 檢視者不能還原素材", "檢視者" in deny.get("__error__", ""))
    call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "editor"})
else:
    ok("素材端點 ACL(略過：無素材)", True)

# ── P0 回收桶軟刪：已軟刪素材不能再當付費生成的來源 ──
# 刪/還原用 admin：AI 生成素材的 uploadedBy 為空，組員會被「上傳者本人或組長以上」守衛擋下
img_src = next((a for a in assets if a["kind"] == "image"), None)
if img_src:
    r = call("POST", admin, "projects.deleteAsset", {"assetId": img_src["id"]})
    ok("先把圖片素材移入回收桶", r.get("ok") is True)
    deny = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/nano-banana-2/edit", "prompt": "x", "sourceAssetId": img_src["id"]})
    ok("🔒 回收桶素材不能當生成來源", "回收桶" in deny.get("__error__", ""))
    r = call("POST", admin, "projects.restoreAsset", {"assetId": img_src["id"]})
    ok("還原素材後回復正常", r.get("ok") is True)
else:
    ok("回收桶來源防護(略過：無圖片素材)", True)

# ── 點數分配樹（開發者→組→組員）：分配、權限、帳表口徑、審計 ──
# 組員不能自行分配（setMemberBudget/setGroupBudget 需組長／團隊管理員）
deny = call("POST", mem, "quota.setMemberBudget", {"groupId": grp["id"], "userId": mem_id, "budgetPoints": 500})
ok("🔒 組員不能分配個人預算", "__error__" in deny)
deny = call("POST", mem, "quota.setGroupBudget", {"groupId": grp["id"], "budgetPoints": 1000})
ok("🔒 組員不能調組預算", "__error__" in deny)

# 團隊管理員把組預算分配給組，組長再把個人預算分配給組員
rgb = call("POST", admin, "quota.setGroupBudget", {"groupId": grp["id"], "budgetPoints": 1000})
ok("團隊管理員分配組預算=1000", rgb.get("ok") is True and rgb.get("budgetPoints") == 1000)
rmb = call("POST", admin, "quota.setMemberBudget", {"groupId": grp["id"], "userId": mem_id, "budgetPoints": 300})
ok("組長分配組員個人預算=300", rmb.get("ok") is True and rmb.get("budgetPoints") == 300)

# quota.usage 反映分配樹：組預算、已分配總和、每位組員(含零用量者)的 budget/role/total
usage2 = call("GET", admin, "quota.usage", {"groupId": grp["id"]})
ok("usage 回組預算", usage2.get("groupBudget") == 1000)
ok("usage 回已分配總和", usage2.get("allocated") == 300)
mem_row = next((x for x in usage2["rows"] if x["userId"] == mem_id), None)
ok("usage 列出組員含個人預算與角色", mem_row is not None and mem_row["budget"] == 300 and mem_row["role"] == "member")

# quota.my 給組員看自己的個人分配剩餘（300 − 已用；不限層回 None）
my2 = call("GET", mem, "quota.my", {"groupId": grp["id"]})
ok("quota.my 回個人分配剩餘", isinstance(my2.get("memberBudgetRemaining"), int) and my2["memberBudgetRemaining"] <= 300)

# 實際守門（原子閘）：把個人預算設成「剛好等於已用」→ 剩 0 → 下一筆生成被擋下。
# 僅在有扣點（CI 的 MOCK_BILLING=1 或正式模式）時可驗；E2E_MOCK 預設略過扣點時 total=0，優雅跳過。
used_now = mem_row["total"]
if used_now > 0:
    call("POST", admin, "quota.setMemberBudget", {"groupId": grp["id"], "userId": mem_id, "budgetPoints": used_now})
    blocked = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "超出個人分配"})
    ok("個人預算用盡 → 生成被原子閘擋下", "__error__" in blocked and "點數已用完" in blocked["__error__"])
else:
    ok("個人預算守門(略過：此環境未扣點)", True)

# 0＝不限（正規化成 null）；分配給非本組成員 → 擋下
r0 = call("POST", admin, "quota.setMemberBudget", {"groupId": grp["id"], "userId": mem_id, "budgetPoints": 0})
ok("個人預算 0 正規化為不限", r0.get("budgetPoints") is None)
deny = call("POST", admin, "quota.setMemberBudget", {"groupId": grp["id"], "userId": "00000000-0000-0000-0000-000000000000", "budgetPoints": 50})
ok("🔒 分配給非本組成員被擋", "__error__" in deny)

# 審計記到兩個分配動作
au4 = call("GET", admin, "audit.list", {"action": "setGroupBudget"})
ok("審計記到組預算分配", any(i["action"] == "quota.setGroupBudget" for i in au4["items"]))
au5 = call("GET", admin, "audit.list", {"action": "setMemberBudget"})
ok("審計記到組員預算分配", any(i["action"] == "quota.setMemberBudget" for i in au5["items"]))

# 收尾：組預算回不限，不留狀態影響其他假設
call("POST", admin, "quota.setGroupBudget", {"groupId": grp["id"], "budgetPoints": 0})

print("—— e2e-phase2 完成 ——")
