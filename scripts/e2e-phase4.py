# Phase 4 基礎工程 e2e:MOCK_BILLING 扣點驗證/成本監控/錯誤觀測與 selftest/個資匯出/下載區新文件。
# 前置:E2E_MOCK=1 **且 MOCK_BILLING=1**、:3199、SEED_ADMIN_EMAIL=admin@aidirector.local、
#       SEED_ADMIN_PASSWORD=test-admin-123、全新 DB。
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

admin = client()
call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
teams = call("GET", admin, "admin.overview")
grp = next(g for t in teams for g in t["groups"] if g["name"] == "剪輯組")

proj = call("POST", admin, "projects.create", {"groupId": grp["id"], "title": "Phase4 測試案", "kind": "witness", "platform": "shorts"})
pid = proj["id"]

# ── MOCK_BILLING=1:假生成、真扣點 ──
before = call("GET", admin, "quota.my", {"groupId": grp["id"]})
g1 = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "扣點驗證"})
ok("mock+billing 可生成", g1.get("status") in ("queued", "running"))
after = call("GET", admin, "quota.my", {"groupId": grp["id"]})
ok("mock+billing 真扣點(weeklyUsed +1)", after["weeklyUsed"] == before["weeklyUsed"] + 1)
ok("totalUsed > 0", after["totalUsed"] > 0)

# ── 成本監控 ──
stats = call("GET", admin, "quota.consumptionStats", {})
ok("consumptionStats 形狀", isinstance(stats.get("perDay"), list) and "todayPoints" in stats and "alert" in stats and isinstance(stats.get("byGroup"), list))
ok("今日消耗已入帳", stats["todayPoints"] >= 1)

# ── 錯誤觀測與 selftest ──
code, body = raw_get(admin, "/api/selftest")
st = json.loads(body)
names = [c["name"] for c in st.get("checks", [])]
ok("selftest 含「近期錯誤」", any("近期錯誤" in n for n in names))
ok("selftest 含「認證模式」", any("認證模式" in n for n in names))
code, body = raw_get(admin, "/api/ready")
ready = json.loads(body)
# 安全（資安稽核）：/api/ready 未認證即可存取，只回存活訊號（ok/db/boot），
# 不外洩內部組態（mockMode／authMode 後門偵察面）——那兩項改到需開發者登入的 /api/selftest（見上方「認證模式」）。
ok("/api/ready 回存活訊號 boot", "boot" in ready)
ok("/api/ready 不外洩 authMode／mockMode", "authMode" not in ready and "mockMode" not in ready)

# ── 個資自助匯出 ──
code, body = raw_get(admin, "/api/me/export")
ok("匯出 200 且為 JSON", code == 200 and body.lstrip()[:1] == b"{")
data = json.loads(body)
ok("匯出含本人 email 與 generations", data.get("user", {}).get("email") == "admin@aidirector.local" and isinstance(data.get("generations"), list) and len(data["generations"]) >= 1)
ok("匯出不含密碼雜湊", b"passwordHash" not in body and b"password_hash" not in body)
anon = client()
code, _ = raw_get(anon, "/api/me/export")
ok("🔒 未登入匯出 401", code == 401)

# ── 下載區新文件(維運手冊/隱私/條款) ──
code, body = raw_get(admin, "/api/downloads")
d = json.loads(body)
files = [i["file"] for i in d.get("items", [])]
ok("下載區含維運手冊", "docs/維運手冊.md" in files)
ok("下載區含隱私權政策(草稿)", "docs/隱私權政策.md" in files)
ok("下載區含使用條款(草稿)", "docs/使用條款.md" in files)
legal = [i for i in d.get("items", []) if i["category"] == "legal"]
ok("legal 分類不再是空的", len(legal) >= 2)

print("—— e2e-phase4 完成 ——")
