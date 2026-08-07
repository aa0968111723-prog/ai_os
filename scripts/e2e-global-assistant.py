# 全站助手（globalAssistant）e2e：ASK（mock）＋trace 落庫＋runSiteAction 五動作真寫入＋
# 組隔離負例＋SSE 串流＋限流。
# 前置：E2E_MOCK=1、伺服器 :3199（可用 E2E_PORT 換埠）、SEED_ADMIN_EMAIL/PASSWORD 種子帳密、全新資料庫。
# 用法：python3 scripts/e2e-global-assistant.py
import json, time, urllib.request, urllib.parse, urllib.error

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

from e2e_lib import ok

admin = client()
r = call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
ok("開發者登入", r.get("user", {}).get("isSuperAdmin") is True)

teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
grp = next(g for g in north["groups"] if g["name"] == "剪輯組")
gid = grp["id"]
# 另一組（跨組隔離負例用）：種子只有一個組就自己建一個——負例不可以因環境而假通過
other = next((g for g in north["groups"] if g["id"] != gid), None)
if other is None:
    other = call("POST", admin, "admin.createGroup", {"teamId": north["id"], "name": "隔離驗證組"})
assert other and other.get("id"), "無法取得第二個組，跨組負例無法誠實驗證"

# 一位純組員（限流與 FORBIDDEN 負例用；只加入剪輯組）
mem = client()
inv = call("POST", admin, "admin.invite", {"email": "ga-member@example.com", "teamId": north["id"], "teamRole": "member", "groupId": gid, "groupRole": "member"})
acc = call("POST", mem, "auth.acceptInvite", {"token": inv["inviteUrl"].split("/")[-1], "name": "全站助手組員", "password": "ga-member-88"})
ok("組員就位", acc["user"]["name"] == "全站助手組員")

# ── ASK（mock 短路）＋trace 落庫 ──
a1 = call("POST", admin, "globalAssistant.ask", {"groupId": gid, "message": "目前全組進度如何？"})
ok("ASK：mock 回覆", a1.get("mock") is True and "測試模式" in a1.get("answer", ""))
ok("ASK：不在 mock 提議任何動作", a1.get("siteActions") == [] and a1.get("dispatches") == [])
ok("ASK：帶回 traceSessionId", bool(a1.get("traceSessionId")))

traces = call("GET", admin, "globalAssistant.traces", {"groupId": gid})
ok("trace 落庫（分表）", any(t["id"] == a1["traceSessionId"] for t in traces))
tr = call("GET", admin, "globalAssistant.trace", {"sessionId": a1["traceSessionId"]})
kinds = [e["eventType"] for e in tr["events"]]
ok("trace 事件（prepared→completed）", tr["session"]["status"] == "completed" and "prepared" in kinds and "completed" in kinds)

# 軌跡 owner-scoped：組員看不到管理員的軌跡
peek = call("GET", mem, "globalAssistant.trace", {"sessionId": a1["traceSessionId"]})
ok("🔒 軌跡只有發問者本人可看", "__error__" in peek)

# ── ACT：runSiteAction 五動作真寫入 ──
p = call("POST", admin, "globalAssistant.runSiteAction", {"type": "create_project", "groupId": gid, "title": "全站助手建立的案子", "kind": "witness", "platform": "shorts"})
ok("ACT：建立專案（真寫入）", p.get("type") == "create_project" and bool(p.get("projectId")))
pid = p["projectId"]
plist = call("GET", admin, "projects.list", {"groupId": gid})
ok("ACT：專案出現在列表", any(x["id"] == pid for x in plist))

n = call("POST", admin, "globalAssistant.runSiteAction", {"type": "add_note", "groupId": gid, "title": "全站助手筆記", "content": "由確認卡寫入的組層級筆記"})
ok("ACT：組層級筆記", n.get("type") == "add_note" and bool(n.get("noteId")))

s = call("POST", admin, "globalAssistant.runSiteAction", {"type": "add_schedule_item", "groupId": gid, "projectId": pid, "title": "交片死線", "startsAt": "2026-08-15T10:00:00+08:00"})
ok("ACT：行程", s.get("type") == "add_schedule_item" and bool(s.get("scheduleItemId")))

t = call("POST", admin, "globalAssistant.runSiteAction", {"type": "create_task", "groupId": gid, "projectId": pid, "title": "剪 A 版", "assigneeId": acc["user"]["id"], "dueAt": "2026-08-14T18:00:00+08:00", "priority": "high"})
ok("ACT：任務（executeTaskCommand 首個呼叫者）", t.get("type") == "create_task" and bool(t.get("taskId")))
tasks = call("GET", admin, "tasks.listByProject", {"projectId": pid})
ok("ACT：任務出現在專案任務清單", any(x["id"] == t["taskId"] for x in (tasks if isinstance(tasks, list) else tasks.get("items", []))))

d = call("POST", admin, "globalAssistant.runSiteAction", {"type": "send_dm", "peerId": acc["user"]["id"], "body": "明早十點對稿，帶腳本"})
ok("ACT：私訊", d.get("type") == "send_dm" and bool(d.get("messageId")))

# 時間格式負例：壞 startsAt 要被擋（不是寫進去一筆壞資料）
bad = call("POST", admin, "globalAssistant.runSiteAction", {"type": "add_schedule_item", "groupId": gid, "title": "壞時間", "startsAt": "明天早上"})
ok("🔒 壞時間格式被擋", "__error__" in bad)

# ── 組隔離負例 ──
# 開發者（isSuperAdmin）對全組都有權，跨組借道要用「只在剪輯組」的組員來驗
cross = call("POST", mem, "globalAssistant.runSiteAction", {"type": "create_task", "groupId": other["id"], "projectId": pid, "title": "跨組借道"})
ok("🔒 跨組 projectId 借道被擋", "__error__" in cross)
forbidden = call("POST", mem, "globalAssistant.ask", {"groupId": other["id"], "message": "偷看別組"})
ok("🔒 非組員 ask 被擋", "__error__" in forbidden)

# ── SSE 串流（/api/assistant/site-ask）──
req = urllib.request.Request(
    f"{HOST}/api/assistant/site-ask",
    data=json.dumps({"groupId": gid, "message": "SSE 測試：進度？"}).encode(),
    headers={"Content-Type": "application/json", "Cookie": admin.cookie},
    method="POST",
)
events = []
with urllib.request.urlopen(req, timeout=30) as resp:
    ok("SSE：content-type", "text/event-stream" in resp.headers.get("Content-Type", ""))
    buf = b""
    for _ in range(200):
        chunk = resp.read(4096)
        if not chunk: break
        buf += chunk
    for block in buf.decode("utf-8").split("\n\n"):
        lines = [l for l in block.split("\n") if l]
        ev = next((l[6:].strip() for l in lines if l.startswith("event:")), None)
        data = next((l[5:].strip() for l in lines if l.startswith("data:")), None)
        if ev: events.append((ev, data))
names = [e for e, _ in events]
ok("SSE：open→done", names[0] == "open" and "done" in names)
done_payload = json.loads(next(d for e, d in events if e == "done"))
ok("SSE：done 帶 mock 回覆與 trace", done_payload.get("mock") is True and bool(done_payload.get("traceSessionId")))

# ── 限流（6/分/人；用組員帳號避免影響前面）──
last = None
for i in range(7):
    last = call("POST", mem, "globalAssistant.ask", {"groupId": gid, "message": f"限流測試 {i}"})
ok("🔒 第 7 次觸發限流", "__error__" in last and "頻繁" in last["__error__"])

print("—— e2e-global-assistant 完成 ——")
