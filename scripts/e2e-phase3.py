# Phase 3 e2e：專案級權限(2.3)/筆記排程+.ics(10)/團隊彙總代理(12)/助手拆分鏡動作鏈(6.6)。
# 前置：E2E_MOCK=1、:3199、SEED_ADMIN_EMAIL=admin@aidirector.local、SEED_ADMIN_PASSWORD=test-admin-123、全新 DB。
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
        with opener.open(req) as r: return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

from e2e_lib import ok  # 共用斷言:計數+結束碼(有 ❌ 即非零退出,CI 據此判紅綠)

admin = client(); mem = client()
call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
grp = next(g for g in north["groups"] if g["name"] == "剪輯組")
gid = grp["id"]

inv = call("POST", admin, "admin.invite", {"email": "p3member@example.com", "teamId": north["id"], "teamRole": "member", "groupId": gid, "groupRole": "member"})
token = inv["inviteUrl"].split("/")[-1]
call("POST", mem, "auth.acceptInvite", {"token": token, "name": "P3 組員", "password": "p3-member-88"})
me = call("GET", mem, "auth.me")
mem_id = me["user"]["id"]

proj = call("POST", mem, "projects.create", {"groupId": gid, "title": "Phase3 測試案", "kind": "witness", "platform": "shorts"})
pid = proj["id"]

# ── 2.3 專案級權限 ──
roles = call("GET", admin, "projects.listMemberRoles", {"projectId": pid})
ok("成員角色清單+canManage", roles["canManage"] is True and any(m["userId"] == mem_id and m["projectRole"] == "editor" for m in roles["members"]))

r = call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "viewer"})
ok("組長把組員設為檢視者", r.get("ok") is True)

blocked = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "x"})
ok("🔒 檢視者不能生成", "檢視者" in blocked.get("__error__", ""))
blocked = call("POST", mem, "knowledge.add", {"projectId": pid, "kind": "note", "title": "t", "content": "c"})
ok("🔒 檢視者不能寫知識庫", "檢視者" in blocked.get("__error__", ""))
blocked = call("POST", mem, "projects.updateWorldview", {"id": pid, "worldview": {"logline": "越權"}})
ok("🔒 檢視者不能改世界觀", "檢視者" in blocked.get("__error__", ""))
blocked = call("POST", mem, "characters.add", {"projectId": pid, "name": "n", "appearance": "a"})
ok("🔒 檢視者不能建角色卡", "檢視者" in blocked.get("__error__", ""))
readable = call("GET", mem, "projects.get", {"id": pid})
ok("檢視者仍可讀專案", readable.get("id") == pid)
msg = call("POST", mem, "messages.post", {"projectId": pid, "body": "檢視者留言 OK"})
ok("檢視者仍可留言", "__error__" not in msg)

deny = call("POST", mem, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "editor"})
ok("🔒 組員不能自改權限", "__error__" in deny)

r = call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "editor"})
g1 = call("POST", mem, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "恢復編輯者後生成"})
ok("恢復編輯者後可生成", g1.get("status") in ("queued", "running"))

# ── 10 筆記 ──
n1 = call("POST", mem, "notes.add", {"groupId": gid, "title": "會議紀錄一", "content": "第一版內容"})
ok("新增筆記", "id" in n1)
n1b = call("POST", mem, "notes.update", {"id": n1["id"], "content": "第二版內容(會存快照)"})
ok("更新筆記", n1b.get("content", "").startswith("第二版"))
nl = call("GET", mem, "notes.list", {"groupId": gid})
ok("筆記清單含摘要", any(x["id"] == n1["id"] and "excerpt" in x and x["creatorName"] for x in nl))
n2 = call("POST", admin, "notes.add", {"groupId": gid, "projectId": pid, "title": "掛專案筆記", "content": "內容"})
nlp = call("GET", mem, "notes.list", {"groupId": gid, "projectId": pid})
ok("按專案過濾筆記", len(nlp) == 1 and nlp[0]["id"] == n2["id"])
deny = call("POST", mem, "notes.remove", {"id": n2["id"]})
ok("🔒 組員不能刪別人筆記", "__error__" in deny)
r = call("POST", admin, "notes.remove", {"id": n2["id"]})
ok("組長可刪筆記", r.get("ok") is True)

# ── 10 排程 + .ics ──
future = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 3 * 24 * 3600))
s1 = call("POST", mem, "schedule.add", {"groupId": gid, "title": "週會", "startsAt": future, "note": "帶進度"})
ok("新增行程", "id" in s1)
bad = call("POST", mem, "schedule.add", {"groupId": gid, "title": "壞", "startsAt": future, "endsAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time()))})
ok("結束早於開始被擋", "__error__" in bad)
sl = call("GET", mem, "schedule.list", {"groupId": gid})
# QA-017 後 list 回 {items, truncated}（截斷不再靜默）；兼容舊陣列形狀
sl_items = sl if isinstance(sl, list) else sl.get("items", [])
ok("行程清單(未來)", any(x["id"] == s1["id"] for x in sl_items))
ok("行程清單帶截斷訊號欄位", isinstance(sl, list) or "truncated" in sl)
code, body = raw_get(mem, f"/api/schedule/{gid}/calendar.ics")
ok(".ics 匯出", code == 200 and b"BEGIN:VCALENDAR" in body and "週會".encode() in body)
other = client()
code, _ = raw_get(other, f"/api/schedule/{gid}/calendar.ics")
ok("🔒 未登入 .ics 401", code == 401)

# ── 12 團隊彙總代理(mock) ──
ta = call("POST", mem, "teamAssistant.ask", {"groupId": gid, "message": "整組狀況如何?"})
ok("組彙總代理回應(mock)", "answer" in ta and ("示範" in ta["answer"] or len(ta["answer"]) > 10))
deny = call("POST", mem, "teamAssistant.ask", {"groupId": "00000000-0000-0000-0000-000000000000", "message": "x"})
ok("🔒 非本組不能問彙總", "__error__" in deny)

# ── 6.6 助手拆分鏡動作鏈 ──
script_text = "第一幕:清晨禪堂,主角緩步走入。第二幕:遞茶陪伴,心安放下來。第三幕:闔上經本,把心交給佛。"
sp = call("POST", mem, "assistant.runAction", {"projectId": pid, "action": {"type": "split_script", "script": script_text}})
ok("助手動作 split_script", sp.get("ok") is True and sp.get("createdScenes", 0) >= 1)
scenes = call("GET", mem, "scenes.listByProject", {"projectId": pid})
ok("拆分鏡確實建立分鏡", len(scenes) >= 1)

# 檢視者也擋助手動作
call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "viewer"})
deny = call("POST", mem, "assistant.runAction", {"projectId": pid, "action": {"type": "create_scene", "title": "越權鏡"}})
ok("🔒 檢視者不能跑助手動作", "檢視者" in deny.get("__error__", ""))

# ── P0 ACL 批次補強：過去漏掛守衛的寫入端點，檢視者現在全擋 ──
pv = call("GET", mem, "projects.get", {"id": pid})
ok("projects.get 回 myProjectRole=viewer", pv.get("myProjectRole") == "viewer")
sid_v = scenes[0]["id"]
deny = call("POST", mem, "approvals.submit", {"sceneId": sid_v})
ok("🔒 檢視者不能送審", "檢視者" in deny.get("__error__", ""))
deny = call("POST", mem, "director.splitScript", {"projectId": pid, "scriptText": "第一段內容。\n\n第二段內容。"})
ok("🔒 檢視者不能拆分鏡(不扣點)", "檢視者" in deny.get("__error__", ""))
deny = call("POST", mem, "scenes.remove", {"sceneId": sid_v})
ok("🔒 檢視者不能刪分鏡", "檢視者" in deny.get("__error__", ""))
deny = call("POST", mem, "scenes.purge", {"sceneId": sid_v})
ok("🔒 檢視者不能永久刪分鏡", "檢視者" in deny.get("__error__", ""))
deny = call("POST", mem, "scenes.restore", {"sceneId": sid_v})
ok("🔒 檢視者不能還原分鏡", "檢視者" in deny.get("__error__", ""))
deny = call("POST", mem, "prompts.save", {"projectId": pid, "text": "越權咒語"})
ok("🔒 檢視者不能存提示詞", "檢視者" in deny.get("__error__", ""))
pr = call("POST", admin, "prompts.save", {"projectId": pid, "text": "組長的咒語"})
deny = call("POST", mem, "prompts.remove", {"id": pr["id"]})
ok("🔒 檢視者不能刪提示詞", "檢視者" in deny.get("__error__", ""))

# ── P0 跨專案待辦彙總（Launchpad 角標＋頂欄計數的資料源）──
call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": mem_id, "role": "editor"})
pv2 = call("GET", mem, "projects.get", {"id": pid})
ok("恢復編輯者後 myProjectRole=editor", pv2.get("myProjectRole") == "editor")
ap = call("POST", mem, "approvals.submit", {"sceneId": sid_v})
ok("編輯者可送審", isinstance(ap, dict) and "__error__" not in ap and ap.get("status") == "pending")
summ = call("GET", mem, "approvals.pendingSummary", {"groupId": gid})
row = next((x for x in summ.get("projects", []) if x["projectId"] == pid), None)
ok("pendingSummary 回本案待審計數", row is not None and row["pendingApprovals"] >= 1)
ok("pendingSummary 組層級總數", summ.get("totalPendingApprovals", 0) >= 1)
deny = call("GET", mem, "approvals.pendingSummary", {"groupId": "00000000-0000-0000-0000-000000000000"})
ok("🔒 非本組不能看待辦彙總", "__error__" in deny)

print("—— e2e-phase3 完成 ——")
