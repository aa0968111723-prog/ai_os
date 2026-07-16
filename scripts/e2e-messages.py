# 組內留言協作強化 e2e:回覆串/表情回應/@提及/引用作品卡/釘選/未讀水位/檢視者參與。
# 前置:FAL_MOCK=1、:3199(可用 E2E_PORT 覆蓋)、SEED_ADMIN_EMAIL=admin@aidirector.local、
#       SEED_ADMIN_PASSWORD=test-admin-123、全新 DB。
import json, urllib.request, urllib.parse, urllib.error

import os as _os
HOST = f"http://localhost:{_os.environ.get('E2E_PORT', '3199')}"
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

from e2e_lib import ok  # 共用斷言:計數+結束碼(有 ❌ 即非零退出,CI 據此判紅綠)

# ── 建置:管理員+兩位組員(甲=留言主角、乙=之後降為檢視者),一個專案、一個分鏡 ──
admin = client(); a = client(); b = client()
call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
grp = next(g for g in north["groups"] if g["name"] == "剪輯組")
gid = grp["id"]
admin_me = call("GET", admin, "auth.me"); admin_id = admin_me["user"]["id"]

def join(cli, email, name, pw):
    inv = call("POST", admin, "admin.invite", {"email": email, "teamId": north["id"], "teamRole": "member", "groupId": gid, "groupRole": "member"})
    call("POST", cli, "auth.acceptInvite", {"token": inv["inviteUrl"].split("/")[-1], "name": name, "password": pw})
    return call("GET", cli, "auth.me")["user"]["id"]

a_id = join(a, "msg-a@example.com", "留言甲", "msg-a-8888")
b_id = join(b, "msg-b@example.com", "留言乙", "msg-b-8888")

proj = call("POST", a, "projects.create", {"groupId": gid, "title": "留言協作測試案", "kind": "witness", "platform": "shorts"})
pid = proj["id"]
proj2 = call("POST", a, "projects.create", {"groupId": gid, "title": "另一個專案", "kind": "witness", "platform": "shorts"})
pid2 = proj2["id"]
call("POST", a, "assistant.runAction", {"projectId": pid, "action": {"type": "create_scene", "title": "留言引用鏡"}})
scenes = call("GET", a, "scenes.listByProject", {"projectId": pid})
scene_id = scenes[0]["id"]

# ── 基本留言與回覆串 ──
m1 = call("POST", a, "messages.post", {"projectId": pid, "body": "第一則:今天開拍 🙏"})
ok("基本留言可送出", "__error__" not in m1)
m2 = call("POST", b, "messages.post", {"projectId": pid, "body": "回你:收到", "replyToId": m1["id"]})
ok("回覆留言可送出", "__error__" not in m2)
rows = call("GET", a, "messages.list", {"projectId": pid})
r2 = next(r for r in rows if r["id"] == m2["id"])
ok("回覆帶原句摘要+原作者", r2["replyTo"]["snippet"].startswith("第一則") and r2["replyTo"]["userName"] == "留言甲")

other = call("POST", a, "messages.post", {"projectId": pid2, "body": "別專案的留言"})
bad = call("POST", a, "messages.post", {"projectId": pid, "body": "跨案回覆", "replyToId": other["id"]})
ok("🔒 不能回覆別專案的留言", "本專案" in bad.get("__error__", ""))

# ── 表情回應(開/收回/彙總) ──
r = call("POST", b, "messages.react", {"messageId": m1["id"], "emoji": "🙏"})
ok("表情回應可按", r.get("on") is True)
call("POST", admin, "messages.react", {"messageId": m1["id"], "emoji": "🙏"})
rows = call("GET", a, "messages.list", {"projectId": pid})
rx = next(r for r in rows if r["id"] == m1["id"])["reactions"]
ok("表情彙總數量正確(2 人 🙏)", any(x["emoji"] == "🙏" and x["count"] == 2 for x in rx))
rows_b = call("GET", b, "messages.list", {"projectId": pid})
rx_b = next(r for r in rows_b if r["id"] == m1["id"])["reactions"]
ok("我按過的表情有標記(mine)", any(x["emoji"] == "🙏" and x["mine"] for x in rx_b))
r = call("POST", b, "messages.react", {"messageId": m1["id"], "emoji": "🙏"})
ok("再按一次=收回", r.get("on") is False)
bad = call("POST", b, "messages.react", {"messageId": m1["id"], "emoji": "😱"})
ok("🔒 白名單外表情被擋", "__error__" in bad)

# ── 釘選(組長以上) ──
r = call("POST", admin, "messages.setPinned", {"messageId": m1["id"], "pinned": True})
ok("組長可釘選", r.get("ok") is True)
rows = call("GET", a, "messages.list", {"projectId": pid})
ok("列表帶釘選狀態", next(r for r in rows if r["id"] == m1["id"])["pinned"] is True)
bad = call("POST", b, "messages.setPinned", {"messageId": m1["id"], "pinned": False})
ok("🔒 一般組員不能釘選", "__error__" in bad)

# ── @提及 ──
m3 = call("POST", a, "messages.post", {"projectId": pid, "body": "@留言乙 請看第三鏡", "mentions": [b_id]})
ok("提及同組夥伴可送出", "__error__" not in m3)
rows = call("GET", b, "messages.list", {"projectId": pid})
ok("列表帶提及名單", b_id in (next(r for r in rows if r["id"] == m3["id"])["mentions"] or []))
bad = call("POST", a, "messages.post", {"projectId": pid, "body": "@路人", "mentions": ["00000000-0000-4000-8000-000000000000"]})
ok("🔒 不能提及組外的人", "同組" in bad.get("__error__", ""))

# ── 引用作品卡 ──
m4 = call("POST", b, "messages.post", {"projectId": pid, "body": "這一鏡構圖如何?", "refType": "scene", "refId": scene_id})
ok("引用分鏡可送出", "__error__" not in m4)
rows = call("GET", a, "messages.list", {"projectId": pid})
ok("引用卡解析出標題", (next(r for r in rows if r["id"] == m4["id"])["ref"] or {}).get("title") == "留言引用鏡")
bad = call("POST", b, "messages.post", {"projectId": pid, "body": "壞引用", "refType": "scene", "refId": "00000000-0000-4000-8000-000000000000"})
ok("🔒 引用不存在/他案作品被擋", "本專案" in bad.get("__error__", ""))
bad = call("POST", b, "messages.post", {"projectId": pid, "body": "半套引用", "refType": "scene"})
ok("🔒 引用參數不完整被擋", "不完整" in bad.get("__error__", ""))

# ── 未讀水位 ──
u = call("GET", b, "messages.unread", {"projectId": pid})
ok("乙有未讀(含被提及)", u["count"] >= 1 and u["mentioned"] is True)
call("POST", b, "messages.markRead", {"projectId": pid})
u = call("GET", b, "messages.unread", {"projectId": pid})
ok("標記已讀後歸零", u["count"] == 0 and u["mentioned"] is False)
call("POST", a, "messages.post", {"projectId": pid, "body": "已讀之後的新留言"})
u = call("GET", b, "messages.unread", {"projectId": pid})
ok("新留言再度計入未讀", u["count"] == 1)
u_a = call("GET", a, "messages.unread", {"projectId": pid})
ok("未讀只算他人留言且未被提及不標記", u_a["count"] >= 1 and u_a["mentioned"] is False)

# ── 檢視者仍能完整參與留言(這是唯讀者唯一的參與出口) ──
call("POST", admin, "projects.setProjectRole", {"projectId": pid, "userId": b_id, "role": "viewer"})
m5 = call("POST", b, "messages.post", {"projectId": pid, "body": "檢視者也能討論", "refType": "scene", "refId": scene_id})
ok("檢視者可留言+引用作品", "__error__" not in m5)
r = call("POST", b, "messages.react", {"messageId": m3["id"], "emoji": "✅"})
ok("檢視者可表情回應", r.get("on") is True)

# ── 審計豁免:markRead 不進 audit_log(高頻);post 有進 ──
au = call("GET", admin, "audit.list", {"action": "messages"})
acts = [i["action"] for i in au["items"]]
ok("留言送出有進審計", any(x == "messages.post" for x in acts))
ok("markRead 豁免不灌審計", not any(x == "messages.markRead" for x in acts))

print("—— e2e-messages 完成 ——")
