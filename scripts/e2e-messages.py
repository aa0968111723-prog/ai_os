# 組內留言協作強化 e2e:回覆串/表情回應/@提及/引用作品卡/釘選/未讀水位/檢視者參與/私訊上線狀態。
# 前置:E2E_MOCK=1、:3199(可用 E2E_PORT 覆蓋)、SEED_ADMIN_EMAIL=admin@aidirector.local、
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

import time

def upload(opener, project_id, filename, content, content_type):
    """multipart/form-data 上傳(urllib 手組 boundary):回傳 (status, json)"""
    boundary = "----e2emsgboundary"
    parts = []
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"projectId\"\r\n\r\n{project_id}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode())
    parts.append(content)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    data = b"".join(parts)
    req = urllib.request.Request(f"{HOST}/api/upload", data=data, method="POST",
                                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)

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
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
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
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
rx = next(r for r in rows if r["id"] == m1["id"])["reactions"]
ok("表情彙總數量正確(2 人 🙏)", any(x["emoji"] == "🙏" and x["count"] == 2 for x in rx))
rows_b = call("GET", b, "messages.list", {"projectId": pid})
rows_b = rows_b["items"] if isinstance(rows_b, dict) and "items" in rows_b else rows_b
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
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
ok("列表帶釘選狀態", next(r for r in rows if r["id"] == m1["id"])["pinned"] is True)
bad = call("POST", b, "messages.setPinned", {"messageId": m1["id"], "pinned": False})
ok("🔒 一般組員不能釘選", "__error__" in bad)

# ── @提及 ──
m3 = call("POST", a, "messages.post", {"projectId": pid, "body": "@留言乙 請看第三鏡", "mentions": [b_id]})
ok("提及同組夥伴可送出", "__error__" not in m3)
rows = call("GET", b, "messages.list", {"projectId": pid})
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
ok("列表帶提及名單", b_id in (next(r for r in rows if r["id"] == m3["id"])["mentions"] or []))
bad = call("POST", a, "messages.post", {"projectId": pid, "body": "@路人", "mentions": ["00000000-0000-4000-8000-000000000000"]})
ok("🔒 不能提及組外的人", "同組" in bad.get("__error__", ""))

# ── 引用作品卡 ──
m4 = call("POST", b, "messages.post", {"projectId": pid, "body": "這一鏡構圖如何?", "refType": "scene", "refId": scene_id})
ok("引用分鏡可送出", "__error__" not in m4)
rows = call("GET", a, "messages.list", {"projectId": pid})
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
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

# ── 語音留言:上傳音檔(webm MIME 白名單)→ postVoice 建語音留言 ──
# 極小的合法 webm 檔頭位元組(EBML 魔數);後端只認 MIME 與副檔名,不解碼內容
webm_bytes = bytes.fromhex("1a45dfa3") + b"\x00" * 64
st, up = upload(a, pid, "語音留言.webm", webm_bytes, "audio/webm")
ok("音檔上傳成功(webm 進 MIME 白名單)", st == 200 and up.get("asset", {}).get("kind") == "audio")
audio_id = up["asset"]["id"]
vm = call("POST", a, "messages.postVoice", {"projectId": pid, "assetId": audio_id})
ok("語音留言建立(pending)", vm.get("kind") == "voice" and vm.get("voiceStatus") == "pending")
rows = call("GET", a, "messages.list", {"projectId": pid})
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
vrow = next((r for r in rows if r["id"] == vm["id"]), None)
ok("語音留言帶可播放網址", vrow and vrow.get("voiceUrl", "").endswith(f"/api/assets/{audio_id}/file"))
# 拿別的(圖片)素材當語音 → 擋;拿別專案音檔 → 擋
st2, up2 = upload(a, pid2, "他案音檔.mp3", b"ID3" + b"\x00" * 32, "audio/mpeg")
cross = call("POST", a, "messages.postVoice", {"projectId": pid, "assetId": up2["asset"]["id"]})
ok("🔒 不能用別專案的音檔發語音", "本專案" in cross.get("__error__", ""))

# ── @助手:留言 @助手 → 背景 AI 回一則(假模式即時插入;輪詢等它出現) ──
call("POST", a, "messages.post", {"projectId": pid, "body": "@助手 這個專案在講什麼?"})
assistant_reply = None
for _ in range(20):
    rows = call("GET", a, "messages.list", {"projectId": pid})
    rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
    assistant_reply = next((r for r in rows if r["kind"] == "assistant"), None)
    if assistant_reply: break
    time.sleep(0.5)
ok("@助手 觸發 AI 回覆(kind=assistant)", assistant_reply is not None)
ok("助手回覆有內容", bool((assistant_reply or {}).get("body", "").strip()))

# ── 留言轉待辦:前端把某句留言 → schedule.add(組內成員可加) ──
todo = call("POST", a, "schedule.add", {"groupId": gid, "projectId": pid, "title": "週五前交件(由留言轉待辦)", "startsAt": "2026-08-01T10:00:00.000Z"})
ok("留言可轉排程待辦", bool(todo.get("id")))
sched = call("GET", a, "schedule.list", {"groupId": gid})
items = sched if isinstance(sched, list) else sched.get("items", [])
ok("待辦出現在排程清單", any(i.get("title", "").startswith("週五前交件") for i in items))

# ── 留言×排程筆記連動 ──
# 留言轉筆記(帶 sourceMessageId 回連)
src = call("POST", a, "messages.post", {"projectId": pid, "body": "決議:週五前完成第一版剪輯"})
note = call("POST", a, "notes.add", {"groupId": gid, "projectId": pid, "title": "週會決議", "content": "週五前完成第一版剪輯", "sourceMessageId": src["id"]})
ok("留言可轉筆記(帶來源留言)", bool(note.get("id")) and note.get("sourceMessageId") == src["id"])
notes = call("GET", a, "notes.list", {"groupId": gid})
nrow = next((x for x in notes if x["id"] == note["id"]), None)
ok("筆記清單帶 sourceMessageId 回連", nrow and nrow.get("sourceMessageId") == src["id"])

# 轉待辦也帶 sourceMessageId
todo2 = call("POST", a, "schedule.add", {"groupId": gid, "projectId": pid, "title": "剪輯交件", "startsAt": "2026-08-08T10:00:00.000Z", "sourceMessageId": src["id"]})
ok("轉待辦帶來源留言回連", todo2.get("sourceMessageId") == src["id"])

# @引用筆記/排程進留言(refType note/schedule)
mnote = call("POST", a, "messages.post", {"projectId": pid, "body": "看這份紀錄", "refType": "note", "refId": note["id"]})
ok("留言可引用筆記", "__error__" not in mnote)
msch = call("POST", a, "messages.post", {"projectId": pid, "body": "這個排程", "refType": "schedule", "refId": todo2["id"]})
ok("留言可引用排程", "__error__" not in msch)
rows = call("GET", a, "messages.list", {"projectId": pid})
rows = rows["items"] if isinstance(rows, dict) and "items" in rows else rows
mnrow = next((r for r in rows if r["id"] == mnote["id"]), None)
ok("引用筆記卡解析出標題", (mnrow.get("ref") or {}).get("title") == "週會決議")
msrow = next((r for r in rows if r["id"] == msch["id"]), None)
ok("引用排程卡解析出標題(含日期)", "剪輯交件" in ((msrow.get("ref") or {}).get("title") or ""))

# 跨組防護:別組的來源留言不能接到本組筆記
bad_src = call("POST", a, "notes.add", {"groupId": gid, "projectId": pid, "title": "壞來源", "content": "x", "sourceMessageId": "00000000-0000-4000-8000-000000000000"})
ok("🔒 來源留言不存在被擋", "__error__" in bad_src)

# Planner @人:notes.add / schedule.add 帶 mentions
gm = call("GET", a, "projects.groupMembers", {"groupId": gid})
ok("組成員清單可讀(供 Planner @人)", isinstance(gm, list) and any(m["userId"] == b_id for m in gm))
nmention = call("POST", a, "notes.add", {"groupId": gid, "title": "@留言乙 請看", "content": "內文", "mentions": [b_id]})
ok("筆記可 @提及同組夥伴", b_id in (nmention.get("mentions") or []))
smention = call("POST", a, "schedule.add", {"groupId": gid, "title": "@留言乙 週會", "startsAt": "2026-08-09T10:00:00.000Z", "mentions": [b_id]})
ok("排程可 @提及同組夥伴", b_id in (smention.get("mentions") or []))
bad_m = call("POST", a, "notes.add", {"groupId": gid, "title": "壞提及", "content": "x", "mentions": ["00000000-0000-4000-8000-000000000000"]})
ok("🔒 筆記不能提及組外的人", "同組" in bad_m.get("__error__", ""))

# ── 私訊「誰在線上」(dm.presence) ──
# 心跳沒有專屬 API:所有登入後的呼叫都會更新最後活躍時刻,所以三個人跑完上面整套之後必然都在線。
pres = call("GET", a, "dm.presence")
ok("私訊上線清單可讀", isinstance(pres, list))
pres_by = {p["userId"]: p for p in pres if isinstance(p, dict)}
peers = call("GET", a, "dm.peers")
ok("上線清單的界＝可私訊對象(不會多報任何人)", set(pres_by) == {p["userId"] for p in peers})
ok("清單只列對象、不列自己", a_id not in pres_by)
ok("同組夥伴帶著最後活躍時刻(=上線中)", isinstance(pres_by.get(b_id, {}).get("lastActiveAt"), str))
# name 是頂欄「誰在線」顯示名（#301）；仍禁止 email 等個資欄
ok(
    "只回 userId／name／lastActiveAt（不外洩 email 等個資）",
    all(set(p) <= {"userId", "name", "lastActiveAt"} and "userId" in p and "lastActiveAt" in p for p in pres)
    and all("email" not in p for p in pres),
)
ok("上線清單帶顯示名（頂欄不必再打 peers）", all(isinstance(p.get("name"), str) and p["name"] for p in pres))

print("—— e2e-messages 完成 ——")
