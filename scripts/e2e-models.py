"""多模態模型環境 e2e:模型目錄/挑選/來源輸入/四種輸出型態/自檢端點。
前置:伺服器跑在 :3199、FAL_MOCK=1、FAL_MOCK_DELAY_MS 低(建議 800)、
     SEED_ADMIN_EMAIL=admin@aidirector.local SEED_ADMIN_PASSWORD=test-admin-123
"""
import json, time, urllib.request, urllib.parse, urllib.error

import os as _os
HOST = f"http://localhost:{_os.environ.get('E2E_PORT', '3199')}"  # E2E_PORT 可換埠(與研究/其他行程共存)
BASE = f"{HOST}/api/trpc"

class Client:
    def __init__(self): self.cookie = None
    def open(self, req):
        if self.cookie: req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req)

def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if data is None and op == "GET":
        req = urllib.request.Request(url)
    elif op == "GET":
        req = urllib.request.Request(url + "?input=" + urllib.parse.quote(json.dumps({"json": data})))
    else:
        req = urllib.request.Request(url, data=json.dumps({"json": data}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req) as r:
            sc = r.headers.get("Set-Cookie")
            if sc: opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if "error" in body: return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]

def wait_done(opener, gen_id, tries=40):
    for _ in range(tries):
        g = call("GET", opener, "generation.status", {"id": gen_id})
        if g.get("status") in ("done", "failed"): return g
        time.sleep(1)
    return {"status": "timeout"}

from e2e_lib import ok  # 共用斷言:計數+結束碼(有 ❌ 即非零退出,CI 據此判紅綠)
admin = Client()

r = call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
ok("超管登入", r.get("user", {}).get("isSuperAdmin") is True)

# ── 模型目錄 ──
cats = call("GET", admin, "models.categories")
ok("11 個創作類別", len(cats) == 11)
# 目錄會持續擴充(W2:300+ 規劃中),寫死總數會讓每次上新模型都弄壞 e2e——
# 改驗「只增不減」下限＋每檔位齊備的結構不變量(PR #16 上 77 模型時實際踩過)
allm = call("GET", admin, "models.search", {})
ok("目錄 ≥77 模型(只增不減)", len(allm) >= 77)
t2i = call("GET", admin, "models.byCategory", {"category": "text-to-image"})
t2i_tiers = [m["tier"] for m in t2i]
ok("文生圖每檔位齊備(旗艦≥3/經濟≥3/最低≥1)",
   t2i_tiers.count("flagship") >= 3 and t2i_tiers.count("economy") >= 3 and t2i_tiers.count("budget") >= 1)
hit = call("GET", admin, "models.search", {"q": "中文"})
ok("關鍵字搜尋(中文)", len(hit) >= 3)
wfs = call("GET", admin, "models.workflows")
ok("7 條工作流", len(wfs) == 7)

# ── 建專案 ──
teams = call("GET", admin, "admin.overview")
group = teams[0]["groups"][0]
proj = call("POST", admin, "projects.create", {"groupId": group["id"], "title": "多模態測試", "kind": "short", "platform": "shorts"})
ok("建專案", proj.get("format") == "9:16")
pid = proj["id"]

# ── 文生圖(圖像輸出) ──
g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/flux/schnell", "prompt": "晨光禪堂"})
g = wait_done(admin, g["id"])
ok("文生圖 → 圖像 URL", g.get("status") == "done" and bool(g.get("resultUrl")))

# ── 圖生圖(需要來源;用素材庫成品) ──
assets = call("GET", admin, "projects.assets", {"projectId": pid})
ok("素材庫有成品", len(assets) >= 1)
noSrc = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/nano-banana-2/edit", "prompt": "改成夕陽"})
ok("圖生圖缺來源被擋", "__error__" in noSrc and "來源" in noSrc["__error__"])
# 素材庫成品走 sourceAssetId(與 UI 一致);sourceUrl 只收外部絕對網址(相對 /api/assets/... 會被 zod url() 擋)
g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/nano-banana-2/edit", "prompt": "改成夕陽", "sourceAssetId": assets[0]["id"]})
g = wait_done(admin, g["id"])
ok("圖生圖(來源=素材庫)完成", g.get("status") == "done" and bool(g.get("resultUrl")))

# ── LLM(文字輸出) ──
g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/any-llm#claude-sonnet-4.5", "prompt": "寫一句 15 字內的影片標語"})
g = wait_done(admin, g["id"])
ok("LLM → 文字輸出(不入素材庫)", g.get("status") == "done" and bool(g.get("resultText")) and not g.get("resultUrl"))

# ── TTS(音訊輸出) ──
g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/kokoro/mandarin-chinese", "prompt": "把心安住於當下"})
g = wait_done(admin, g["id"])
audio_url = g.get("resultUrl") or ""
ok("TTS → 音訊 URL", g.get("status") == "done" and "audio" in audio_url)
req = urllib.request.Request(audio_url)
with urllib.request.urlopen(req) as r:
    wav = r.read()
ok("音訊可下載且為 WAV", wav[:4] == b"RIFF")

# ── 語音轉文字(需要音訊來源) ──
g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": "fal-ai/wizper", "prompt": "轉錄", "sourceUrl": audio_url})
g = wait_done(admin, g["id"])
ok("語音轉文字 → 文字", g.get("status") == "done" and bool(g.get("resultText")))

# ── 工作流步驟模型全部存在 ──
missing = []
for w in wfs:
    for s in w["steps"]:
        found = call("GET", admin, "models.search", {"q": ""})
        if not any(m["id"] == s["modelId"] for m in allm): missing.append(s["modelId"])
ok("工作流引用的模型都在目錄", not missing)

# ── 點數帳本(扣點有紀錄) ──
quota = call("GET", admin, "quota.my", {"groupId": group["id"]})
ok("點數已扣(totalUsed>0)", quota.get("totalUsed", 0) > 0)

# ── 自檢端點 ──
req = urllib.request.Request(f"{HOST}/api/selftest")
req.add_header("Cookie", admin.cookie)
with urllib.request.urlopen(req) as r:
    st = json.load(r)
ok("系統自檢全綠", st.get("ok") is True and len(st.get("checks", [])) >= 7)

# ── 交付包含音訊資料夾(把音訊加入分鏡再打包) ──
gens = call("GET", admin, "generation.listByProject", {"projectId": pid})
audio_gen = next(g for g in gens if g["kind"] == "audio" and g["status"] == "done")
sc = call("POST", admin, "scenes.addFromGeneration", {"generationId": audio_gen["id"], "title": "旁白"})
ok("音訊加入分鏡", bool(sc.get("id")))
req = urllib.request.Request(f"{HOST}/api/export/{pid}")
req.add_header("Cookie", admin.cookie)
with urllib.request.urlopen(req) as r:
    zipdata = r.read()
ok("交付包可下載(zip)", zipdata[:2] == b"PK" and len(zipdata) > 500)

print("—— e2e-models 完成 ——")
