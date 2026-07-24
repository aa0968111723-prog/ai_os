# 跨裝置通知（Web Push）e2e：VAPID 公鑰穩定性／訂閱 SSRF＋https 守衛／裝置清單本人隔離／
# 裝置上限淘汰／sync 只更新不新增＋金鑰輪替就地換訂／解除與移除的本人界／測試推播回傳。
# 前置：E2E_MOCK=1、:3199（可用 E2E_PORT 覆蓋）、SEED_ADMIN_EMAIL=admin@aidirector.local、
#       SEED_ADMIN_PASSWORD=test-admin-123、全新 DB。
#
# 端點策略（讓本機與 CI 都能過）：
#   - 「合法訂閱」用真實可解析的公開主機（fcm.googleapis.com）——CI 直連會做 DNS 解析，
#     本機有出口代理則 SSRF 的 DNS 分支自動跳過（見 databaseFiles.assertPublicHostOrError）。
#   - 「SSRF 應被擋」用字面內網位址（127.0.0.1／169.254.169.254）——ssrfGuardError 在 DNS 前就快篩擋下，
#     不依賴網路，任何環境都一致。
# 不花錢：push.test 會真的呼叫 web-push 對 fcm 發推送，但金鑰是假的、必然失敗（delivered=0），
#   attempted 反映的是資料庫裡的裝置數；全程不碰付費 API。
import json, os, urllib.request, urllib.parse, urllib.error

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
BASE = f"{HOST}/api/trpc"
EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local")
PW = os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123")
MAX_DEVICES = 10  # 對齊 server/services/webPush.ts 的 MAX_DEVICES_PER_USER

from e2e_lib import ok  # 共用斷言：計數＋結束碼（有 ❌ 即非零退出，CI 據此判紅綠）


class Client:
    def __init__(self):
        self.cookie = None

    def open(self, req):
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req, timeout=40)


def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if op == "GET" and data is None:
        req = urllib.request.Request(url)
    elif op == "GET":
        req = urllib.request.Request(url + "?input=" + urllib.parse.quote(json.dumps({"json": data})))
    else:
        req = urllib.request.Request(url, data=json.dumps({"json": data}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req) as r:
            sc = r.headers.get("Set-Cookie")
            if sc and sc.startswith("aidos_session="):
                opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if "error" in body:
        return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]


# 假但格式合理的裝置金鑰（伺服器只驗長度；web-push 用假金鑰必然推送失敗，不影響 attempted 計數）
FAKE_P256DH = "BJ" + "A" * 85  # ~87 字，落在 1..256
FAKE_AUTH = "Zm9vYmFyZm9vYmFyMTI=".rstrip("=")


def fcm(tok):
    """真實可解析的公開端點（每個 token 一個唯一 endpoint）。"""
    return f"https://fcm.googleapis.com/fcm/send/e2e-push-{tok}"


def subscribe(cli, endpoint, label=None):
    return call("POST", cli, "push.subscribe",
                {"endpoint": endpoint, "keys": {"p256dh": FAKE_P256DH, "auth": FAKE_AUTH}, **({"label": label} if label else {})})


def sync(cli, endpoint, label=None, old=None):
    payload = {"endpoint": endpoint, "keys": {"p256dh": FAKE_P256DH, "auth": FAKE_AUTH}}
    if label:
        payload["label"] = label
    if old:
        payload["oldEndpoint"] = old
    return call("POST", cli, "push.sync", payload)


def devices(cli):
    r = call("GET", cli, "push.devices")
    return r if isinstance(r, list) else []


# ─── 準備：開發者登入（U1）＋邀請一位受限成員（U2）驗跨人隔離 ───
u1 = Client()
login = call("POST", u1, "auth.login", {"email": EMAIL, "password": PW})
ok("開發者登入（U1）", login.get("user", {}).get("isSuperAdmin") is True)

teams = call("GET", u1, "admin.overview")
anim_team = next(t for t in teams if any(g["name"] == "動畫組" for g in t["groups"]))
anim = next(g for g in anim_team["groups"] if g["name"] == "動畫組")
inv = call("POST", u1, "admin.invite",
           {"email": "pushuser@example.com", "teamId": anim_team["id"], "teamRole": "member",
            "groupId": anim["id"], "groupRole": "member"})
u2 = Client()
acc = call("POST", u2, "auth.acceptInvite",
           {"token": inv["inviteUrl"].rsplit("/", 1)[-1], "name": "推播小測", "password": "push-pass-2026"})
ok("邀請並登入第二使用者（U2）", acc.get("user", {}).get("name") == "推播小測")

# ─── VAPID 公鑰：非空且跨呼叫穩定（金鑰漂移＝既有訂閱全數失效）───
pk1 = call("GET", u1, "push.publicKey")
pk2 = call("GET", u2, "push.publicKey")
ok("VAPID 公鑰非空且跨使用者/跨呼叫一致",
   isinstance(pk1.get("publicKey"), str) and len(pk1["publicKey"]) > 20 and pk1["publicKey"] == pk2["publicKey"])

# ─── 訂閱守衛：非 https 與字面內網位址一律被擋，且不留任何裝置列 ───
bad_http = subscribe(u1, "http://fcm.googleapis.com/fcm/send/insecure")
ok("🔒 非 https 端點被擋", "__error__" in bad_http)
for ip in ("https://127.0.0.1/wpush", "https://169.254.169.254/latest/meta-data"):
    r = subscribe(u1, ip)
    ok(f"🔒 SSRF 內網端點被擋（{ip.split('//')[1].split('/')[0]}）", r.get("__error__") == "訂閱端點無效")
ok("被擋的訂閱未污染裝置清單", len(devices(u1)) == 0)

# ─── 合法訂閱＋裝置清單＋標籤保留 ───
ok("U1 訂閱本機（帶標籤）", subscribe(u1, fcm("u1-a"), "U1 手機").get("ok") is True)
d1 = devices(u1)
ok("U1 裝置清單=1 且標籤保留", len(d1) == 1 and d1[0]["label"] == "U1 手機" and d1[0]["endpoint"] == fcm("u1-a"))

# ─── 跨人隔離：U2 的裝置只屬於 U2，U1 看不到 ───
ok("U2 訂閱本機", subscribe(u2, fcm("u2-a"), "U2 電腦").get("ok") is True)
ok("🔒 U1 裝置清單看不到 U2 的裝置", all(x["endpoint"] != fcm("u2-a") for x in devices(u1)))
ok("U2 裝置清單只有自己的", [x["endpoint"] for x in devices(u2)] == [fcm("u2-a")])

# ─── sync：既有端點只更新（不長列）───
ok("U1 sync 既有端點（改標籤）", sync(u1, fcm("u1-a"), "U1 手機・更新").get("ok") is True)
d1 = devices(u1)
ok("sync 既有端點＝更新不新增（仍 1 列、標籤已改）",
   len(d1) == 1 and d1[0]["label"] == "U1 手機・更新")

# ─── sync：全新端點不新增（設定頁移除過的裝置不得被開 App 偷偷復活）───
ok("U1 sync 全新端點", sync(u1, fcm("u1-ghost")).get("ok") is True)
ok("sync 全新端點＝不復活（裝置仍只有 1 列）", len(devices(u1)) == 1)

# ─── sync：金鑰輪替 oldEndpoint 就地換訂（舊列改寫成新 endpoint，不長列、標籤留存）───
ok("U1 sync 換訂（oldEndpoint→新 endpoint）", sync(u1, fcm("u1-rotated"), old=fcm("u1-a")).get("ok") is True)
d1 = devices(u1)
ok("換訂＝就地改寫（仍 1 列、endpoint 換新、標籤留存）",
   len(d1) == 1 and d1[0]["endpoint"] == fcm("u1-rotated") and d1[0]["label"] == "U1 手機・更新")

# ─── 裝置上限淘汰：超過 MAX 只保留最新 MAX 台 ───
for i in range(MAX_DEVICES + 3):  # U2 已有 1 台，再灌 13 台 → 應淘汰到 10
    subscribe(u2, fcm(f"u2-bulk-{i:02d}"), f"U2 裝置{i}")
d2 = devices(u2)
ok(f"裝置數上限＝{MAX_DEVICES}（超額淘汰最舊）", len(d2) == MAX_DEVICES)
ok("最早的裝置（u2-a）已被淘汰", all(x["endpoint"] != fcm("u2-a") for x in d2))

# ─── removeDevice：只能移除自己的（拿別人的 id 無效）───
victim_id = devices(u1)[0]["id"]
ok("🔒 U2 用 U1 的裝置 id 移除＝無效（回 ok 但不動別人的列）",
   call("POST", u2, "push.removeDevice", {"id": victim_id}).get("ok") is True and len(devices(u1)) == 1)
own_id = devices(u2)[0]["id"]
call("POST", u2, "push.removeDevice", {"id": own_id})
ok("removeDevice 移除自己的裝置生效", all(x["id"] != own_id for x in devices(u2)))

# ─── unsubscribe：以 endpoint 解除本裝置 ───
call("POST", u1, "push.unsubscribe", {"endpoint": fcm("u1-rotated")})
ok("unsubscribe 以 endpoint 解除本裝置", len(devices(u1)) == 0)

# ─── push.test：對本人所有裝置發測試推播，回傳 attempted 反映裝置數（假金鑰必然 delivered=0，不花錢）───
subscribe(u1, fcm("u1-final"))
res = call("POST", u1, "push.test", None)
ok("push.test 回 attempted 反映裝置數（delivered 因假金鑰為 0）",
   isinstance(res, dict) and res.get("attempted") == 1 and res.get("delivered") == 0)
