# Story-first e2e（PE 計畫 §19 Golden Path）：貼故事→自動解析→確認卡→產生分鏡→Shot 綁定生成→改故事差異→Undo→版本。
# 前置：E2E_MOCK=1、:3199、SEED_ADMIN_EMAIL=admin@aidirector.local、SEED_ADMIN_PASSWORD=test-admin-123、全新 DB。
# 假模式解析契約（services/storyParse.ts mockStoryExtract）：「角色：」「場景：」「道具：」= 0.95、「疑似道具：」= 0.6（走確認卡）。
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

from e2e_lib import ok

admin = client()
call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
gid = north["groups"][0]["id"]

proj = call("POST", admin, "projects.create", {"groupId": gid, "title": "Story-first 金路徑", "kind": "healing", "platform": "shorts"})
pid = proj["id"]

# ── 1. 貼上故事 → 自動保存 ──
st = call("GET", admin, "story.get", {"projectId": pid})
ok("新專案故事為空", st["story"] is None and st["summary"]["shots"] == 0)

STORY = "\n".join([
    "角色：安倢（黑髮、柔和五官）、師父（灰袍長者）",
    "場景：克難坡（石階、老樹、灰藍色調）",
    "道具：紅傘（紅色油紙傘）",
    "疑似道具：帆布包",
    "造型：安倢＝米白外套",
    "",
    "清晨的克難坡下著雨。安倢撐著紅傘走下石階。",
    "",
    "師父在坡頂等她。安倢停下腳步，回頭看了一眼。",
])
saved = call("POST", admin, "story.save", {"projectId": pid, "content": STORY})
ok("故事已保存", "__error__" not in saved)
st = call("GET", admin, "story.get", {"projectId": pid})
ok("保存後內容一致且待解析", st["story"]["content"] == STORY and st["story"]["isDirty"] is True)

# ── 2. AI 解析（假模式確定性）→ 自動建立角色/場景/道具＋低信心確認卡 ──
parsed = call("POST", admin, "story.parse", {"projectId": pid})
ok("解析完成（mock）", parsed.get("mock") is True and parsed["stats"]["characters"]["created"] == 2)
ok("場景/道具自動建立", parsed["stats"]["locations"]["created"] == 1 and parsed["stats"]["props"]["created"] == 1)
ok("低信心項只出確認卡", parsed["stats"]["props"]["pending"] == 1 and parsed["pendingCount"] == 1)
run1 = parsed["runId"]

chars = call("GET", admin, "characters.list", {"projectId": pid})
ok("角色卡就位（安倢/師父）", sorted(c["name"] for c in chars) == ["安倢", "師父"])
anjie = next(c for c in chars if c["name"] == "安倢")
ok("外觀寫進 Identity", "黑髮" in anjie["appearance"])
locs = call("GET", admin, "scenePresets.list", {"projectId": pid})
ok("場景卡就位（克難坡）", [l["name"] for l in locs] == ["克難坡"])
props = call("GET", admin, "props.list", {"projectId": pid})
ok("道具卡就位（紅傘）", [p["name"] for p in props] == ["紅傘"])

# ── 3. 確認卡：建立「帆布包」──
st = call("GET", admin, "story.get", {"projectId": pid})
cand = next(c for c in st["pending"] if c["name"] == "帆布包")
r = call("POST", admin, "story.confirmCandidate", {"candidateId": cand["id"], "action": "create"})
ok("確認卡建立道具", r.get("ok") is True)
props = call("GET", admin, "props.list", {"projectId": pid})
ok("帆布包入庫", {p["name"] for p in props} == {"紅傘", "帆布包"})
st = call("GET", admin, "story.get", {"projectId": pid})
ok("確認卡清空", st["summary"]["pending"] == 0)

# ── 4. 冪等：同文重解不重複建卡（「她／安倢」「那把傘／紅傘」防重複的基線） ──
re1 = call("POST", admin, "story.parse", {"projectId": pid})
ok("同文重解走快取短路", re1.get("skipped") is True)
re2 = call("POST", admin, "story.parse", {"projectId": pid, "force": True})
ok("強制重解全部連結、零新建", re2["stats"]["characters"]["created"] == 0 and re2["stats"]["characters"]["linked"] == 2 and re2["stats"]["props"]["created"] == 0)
chars = call("GET", admin, "characters.list", {"projectId": pid})
ok("重解後角色數不變", len(chars) == 2)

# ── 5. 產生分鏡：Scene/Shot 落地＋環境繼承＋冪等 ──
pv = call("GET", admin, "story.storyboardPreview", {"projectId": pid})
ok("轉分鏡預覽就緒", pv["ready"] is True and pv["planScenes"] == 2 and pv["existingShots"] == 0)
board_run = pv["runId"]  # 分鏡掛在「最新完成的解析 run」上；撤分鏡要撤這個 run
board = call("POST", admin, "story.generateStoryboard", {"projectId": pid})
ok("建立 2 場分鏡", len(board["storySceneIds"]) == 2 and len(board["sceneIds"]) >= 3)
again = call("POST", admin, "story.generateStoryboard", {"projectId": pid})
ok("重按轉分鏡冪等（同一批）", again["reused"] is True and again["sceneIds"] == board["sceneIds"])

sscenes = call("GET", admin, "story.scenesList", {"projectId": pid})
ok("第一場環境＝雨天清晨", sscenes[0]["environment"]["weather"] == "雨天" and sscenes[0]["environment"]["timeOfDay"] == "清晨")
shots = call("GET", admin, "scenes.listByProject", {"projectId": pid})
ok("所有鏡都歸屬到場", all(s["storySceneId"] in board["storySceneIds"] for s in shots))
with_anjie = [s for s in shots if s["characterIds"] and anjie["id"] in s["characterIds"]]
ok("鏡引用角色（Reference 不是 Copy）", len(with_anjie) >= 1)
ok("鏡繼承場的地點卡", any(s["scenePresetIds"] and locs[0]["id"] in s["scenePresetIds"] for s in shots))

# ── 6. 鏡頭語言／表演（Shot Override 層）──
shot0 = shots[0]
upd = call("POST", admin, "scenes.update", {"sceneId": shot0["id"], "camera": {"shotSize": "特寫", "movement": "緩推"}, "performance": {"emotion": "若有所思"}})
ok("鏡頭語言寫入", upd["camera"]["shotSize"] == "特寫" and upd["performance"]["emotion"] == "若有所思")
blocked = call("POST", admin, "scenes.update", {"sceneId": shot0["id"], "storySceneId": pid})
ok("🔒 跨表亂指場被擋", "__error__" in blocked)

# ── 7. 生成從 Shot 出發：綁定 sceneId、可追溯 ──
gen = call("POST", admin, "scenes.generateInto", {"sceneId": shot0["id"], "modelId": "fal-ai/flux/schnell"})
ok("逐鏡生成送出", "generationId" in gen)
glist = call("GET", admin, "generation.listByProject", {"projectId": pid})
grow = next(g for g in glist if g["id"] == gen["generationId"])
ok("生成綁定 Shot（sceneId）", grow["sceneId"] == shot0["id"])
ok("生成提示詞含鏡頭語言（Context Builder）", "特寫" in (grow.get("prompt") or ""))
ok("生成提示詞含場景狀態（環境繼承）", "雨天" in (grow.get("prompt") or ""))

# ── 8. 造型（Look）與 Identity 分層：解析出的外套建為 Look ──
looks = call("GET", admin, "characterLooks.list", {"projectId": pid})
ok("造型自動建立（米白外套→Look）", any(l["characterId"] == anjie["id"] for l in looks))
lk = call("POST", admin, "characterLooks.add", {"characterId": anjie["id"], "name": "短髮時期", "costume": "俐落短髮、深色大衣"})
ok("手動建立造型", lk["name"] == "短髮時期")
upd = call("POST", admin, "scenes.update", {"sceneId": shot0["id"], "lookIds": [lk["id"]]})
ok("鏡採用造型（lookIds）", upd["lookIds"] == [lk["id"]])
ok("Identity 未被造型污染", call("GET", admin, "characters.list", {"projectId": pid})[0]["appearance"] != "俐落短髮、深色大衣")

# ── 8.5 連戲檢查（§23 雙向影響 / P3 Continuity Checker）：改了卡片，既有畫面要被標成過時 ──
# 要挑「真的引用紅傘」的那一鏡：純寫景的鏡（「清晨的克難坡下著雨」）本來就沒有角色與道具錨點，
# 拿它來測會測不到東西——這正是第一版斷言挑錯鏡踩到的坑。
import time as _time
umbrella = next(p for p in call("GET", admin, "props.list", {"projectId": pid}) if p["name"] == "紅傘")
shot_umbrella = next((s for s in shots if umbrella["id"] in (s.get("propIds") or [])), None)
ok("有鏡引用紅傘（錨點鏈的起點）", shot_umbrella is not None)

if shot_umbrella:
    g2 = call("POST", admin, "scenes.generateInto", {"sceneId": shot_umbrella["id"], "modelId": "fal-ai/flux/schnell"})
    landed = None
    for _ in range(40):
        _rows = call("GET", admin, "scenes.listByProject", {"projectId": pid})
        _s = next((r for r in _rows if r["id"] == shot_umbrella["id"]), None)
        if _s and _s.get("assetId"):
            landed = _s
            break
        _time.sleep(1)
    ok("生成落地回填分鏡畫面", landed is not None)

    grow2 = next(g for g in call("GET", admin, "generation.listByProject", {"projectId": pid}) if g["id"] == g2["generationId"])
    ok("生成凍結了道具卡（錨點可回溯）", umbrella["id"] in (grow2.get("propIds") or []))

    fresh = call("GET", admin, "story.continuityCheck", {"projectId": pid})
    ok("卡片沒動時不誤報過時", fresh["total"] == 0)

    # 紅傘 → 黃傘：正是 PDF §23 的例子
    call("POST", admin, "props.update", {"id": umbrella["id"], "appearance": "鮮黃色油紙傘、竹骨"})
    stale = call("GET", admin, "story.continuityCheck", {"projectId": pid})
    ok("改道具外觀後畫面標成過時", stale["total"] >= 1)
    ok("過時原因指名是哪張卡的哪個欄位", any("紅傘" in o["reason"] and "外觀" in o["reason"] for o in stale["outdated"]))

    impact = call("GET", admin, "story.entityImpact", {"projectId": pid, "kind": "prop", "entityId": umbrella["id"]})
    ok("影響查詢回報過時鏡數", impact["outdatedShots"] >= 1 and impact["shots"] >= 1)

    # 只改備註不影響畫面——誤報會讓提示變雜訊，這條守住「不亂叫」
    char0 = call("GET", admin, "characters.list", {"projectId": pid})[0]
    call("POST", admin, "characters.update", {"id": char0["id"], "notes": "備註改一下，不該影響畫面"})
    after_notes = call("GET", admin, "story.continuityCheck", {"projectId": pid})
    ok("只改備註不新增過時項", after_notes["total"] == stale["total"])

# ── 8.8 Shot 相關素材（§13）：名稱／標籤對得上才推薦，且要說得出理由 ──
def upload_asset(opener, project_id, filename):
    """multipart 上傳一張小圖（與 e2e-messages 同一套手組 boundary 寫法）"""
    boundary = "----e2estoryboundary"
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082")
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"projectId\"\r\n\r\n{project_id}\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n".encode(),
        png,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(f"{HOST}/api/upload", data=b"".join(parts), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        return {"__error__": e.read().decode()[:200]}

if shot_umbrella:
    empty = call("GET", admin, "story.shotAssetSuggestions", {"sceneId": shot_umbrella["id"]})
    ok("素材庫沒對得上的東西時不硬推", empty["items"] == [] and len(empty["terms"]) >= 1)
    up1 = upload_asset(admin, pid, "克難坡實景參考.png")
    up2 = upload_asset(admin, pid, "完全無關的東西.png")
    ok("素材上傳成功（推薦的前提）", "__error__" not in up1 and "__error__" not in up2)
    sug = call("GET", admin, "story.shotAssetSuggestions", {"sceneId": shot_umbrella["id"]})
    titles = [i["title"] for i in sug["items"]]
    ok("名稱對得上的素材被推薦", any("克難坡" in t for t in titles))
    ok("對不上的不推薦（不要讓人自己過濾雜訊）", not any("完全無關" in t for t in titles))
    ok("推薦說得出理由（命中哪些詞）", all(i["matched"] for i in sug["items"]))

# ── 9. 修改故事 → 差異訊號（不整部重算） ──
saved = call("POST", admin, "story.save", {"projectId": pid, "content": STORY + "\n\n三年後，她剪了短髮回到克難坡。"})
st = call("GET", admin, "story.get", {"projectId": pid})
ok("改故事後標記待重解", st["story"]["isDirty"] is True)
re3 = call("POST", admin, "story.parse", {"projectId": pid})
ok("增量重解不重複建卡", re3["stats"]["characters"]["created"] == 0)
shots_after = call("GET", admin, "scenes.listByProject", {"projectId": pid})
ok("既有分鏡不被重解洗掉", len(shots_after) == len(shots))

# ── 9.5 逐場套用（§22）：重解之後再產生分鏡，同名的場不重建、也不覆蓋 ──
scenes_before = call("GET", admin, "story.scenesList", {"projectId": pid})
prev = call("GET", admin, "story.storyboardPreview", {"projectId": pid})
ok("預覽有逐場計畫", "summary" in prev and prev["summary"]["reuseScenes"] >= 1)
ok("已有鏡的場計畫為沿用", any(d["action"] == "reuse" for d in prev["diff"]))
call("POST", admin, "story.generateStoryboard", {"projectId": pid})
scenes_after2 = call("GET", admin, "story.scenesList", {"projectId": pid})
ok("同名場不重建（不會出現兩個「第 1 場」）",
   len([s for s in scenes_after2 if s["title"] == scenes_before[0]["title"]]) == 1)
shot_titles_before = {s["id"]: s["title"] for s in shots_after}
shots_after2 = call("GET", admin, "scenes.listByProject", {"projectId": pid})
ok("沿用的場底下的鏡原封不動",
   all(s["title"] == shot_titles_before[s["id"]] for s in shots_after2 if s["id"] in shot_titles_before))

# ── 10. Undo：撤銷最新一次解析（無新建→無移除；run 標記 undone） ──
undo = call("POST", admin, "story.undoRun", {"runId": re3["runId"]})
ok("撤銷解析成功", undo.get("ok") is True)
ok("未誤刪既有實體", len(call("GET", admin, "characters.list", {"projectId": pid})) == 2)

# ── 11. 版本：大改自動快照、可還原 ──
call("POST", admin, "story.save", {"projectId": pid, "content": "全新版本的故事開頭。" * 50})  # 內容差 >200 字才觸發版本快照
vers = call("GET", admin, "story.listVersions", {"projectId": pid})
ok("大改留版本快照", len(vers) >= 1)
r = call("POST", admin, "story.restoreVersion", {"projectId": pid, "versionId": vers[0]["id"]})
ok("版本可還原", "__error__" not in r)

# ── 12. 守門：空故事不可解析 ──
call("POST", admin, "story.save", {"projectId": pid, "content": ""})
blocked = call("POST", admin, "story.parse", {"projectId": pid})
ok("🔒 空故事解析被擋", "故事" in blocked.get("__error__", ""))

# ── 13. Undo 語義：每個 run 只撤「自己做過的事」──
# 先撤「掛著分鏡」的 run：Shot 軟刪進回收桶、場移除；角色是 run1 建的，這裡不動
undo_b = call("POST", admin, "story.undoRun", {"runId": board_run})
ok("撤銷轉分鏡的 run（Shot 進回收桶）", undo_b.get("ok") is True and undo_b["removed"]["shots"] >= 3 and undo_b["removed"]["storyScenes"] == 2)
shots_now = call("GET", admin, "scenes.listByProject", {"projectId": pid})
ok("分鏡列表清空（回收桶可還原）", len(shots_now) == 0)
# 再撤首次解析：分鏡已撤、無活鏡引用 → AI 建的角色/造型可安全移除；使用者確認建立的保留
undo1 = call("POST", admin, "story.undoRun", {"runId": run1})
ok("撤銷首次解析", undo1.get("ok") is True and undo1["removed"]["characters"] == 2)
ok("AI 建的角色隨 Undo 撤掉", len(call("GET", admin, "characters.list", {"projectId": pid})) == 0)
props_now = call("GET", admin, "props.list", {"projectId": pid})
ok("使用者確認建立的道具保留", [p["name"] for p in props_now] == ["帆布包"])
looks_now = call("GET", admin, "characterLooks.list", {"projectId": pid})
ok("手動造型保留、AI 造型撤掉", [l["name"] for l in looks_now] == ["短髮時期"])

# ── 14. 舊專案相容（§63 CURRENT PROJECTS MUST SURVIVE）──
# 「舊方式」的專案＝重構前就長這樣：有世界觀／角色／場景／道具／分鏡，
# 但沒有 story、沒有 story_scenes、鏡上沒有 storySceneId／camera／lookIds。
# 這種專案打開新的四段 IA 不能空白、不能報錯、資料一項都不能少。
legacy = call("POST", admin, "projects.create",
              {"groupId": gid, "title": "重構前的舊專案", "kind": "healing", "platform": "shorts"})
lpid = legacy["id"]
call("POST", admin, "projects.updateWorldview",
     {"projectId": lpid, "worldview": {"themes": ["禪修日常"], "tones": ["溫暖"], "styles": ["寫實攝影"]}})
lc = call("POST", admin, "characters.add", {"projectId": lpid, "name": "舊角色", "appearance": "灰袍、白眉"})
ls = call("POST", admin, "scenePresets.add", {"projectId": lpid, "name": "舊場景", "palette": "低飽和暖灰"})
lp = call("POST", admin, "props.add", {"projectId": lpid, "name": "舊道具", "appearance": "木魚"})
lshot = call("POST", admin, "scenes.addDraft", {"projectId": lpid, "title": "舊分鏡", "prompt": "舊的畫面描述", "durationSec": 5})
ok("舊專案的卡片與分鏡建立成功",
   all("__error__" not in x for x in (lc, ls, lp, lshot)))

lstory = call("GET", admin, "story.get", {"projectId": lpid})
ok("舊專案打開故事頁不報錯、故事為空", "__error__" not in lstory and lstory["story"] is None)
ok("舊專案的既有資料在摘要裡看得到",
   lstory["summary"]["characters"] == 1 and lstory["summary"]["locations"] == 1
   and lstory["summary"]["props"] == 1 and lstory["summary"]["shots"] == 1)
ok("舊專案沒有場（story_scenes 為空）", lstory["summary"]["storyScenes"] == 0)

lscenes = call("GET", admin, "story.scenesList", {"projectId": lpid})
ok("場清單為空但不報錯", lscenes == [])
lshots = call("GET", admin, "scenes.listByProject", {"projectId": lpid})
ok("舊分鏡讀得到，且為「未分場」（storySceneId 為空）",
   len(lshots) == 1 and lshots[0]["storySceneId"] is None)
ok("舊分鏡的新欄位為空而非壞值",
   lshots[0]["camera"] is None and lshots[0]["performance"] is None and lshots[0]["lookIds"] is None)

ok("舊專案的連戲檢查不誤報（沒有生成過就沒有過時）",
   call("GET", admin, "story.continuityCheck", {"projectId": lpid})["total"] == 0)
limp = call("GET", admin, "story.entityImpact", {"projectId": lpid, "kind": "character", "entityId": lc["id"]})
ok("舊專案的影響查詢可用（沒有鏡引用就回 0，不炸）", limp["shots"] == 0 and limp["outdatedShots"] == 0)
ok("舊專案的素材推薦可用（沒綁卡的鏡回空詞）",
   call("GET", admin, "story.shotAssetSuggestions", {"sceneId": lshots[0]["id"]})["terms"] == [])
lprev = call("GET", admin, "story.storyboardPreview", {"projectId": lpid})
ok("舊專案還沒解析過：預覽回未就緒而不是壞掉", lprev["ready"] is False and lprev["existingShots"] == 1)
lgen = call("POST", admin, "scenes.generateInto",
            {"sceneId": lshots[0]["id"], "modelId": "fal-ai/flux/schnell", "prompt": "舊分鏡照樣能生成"})
ok("舊分鏡照樣能就地生成（沒有場也不擋）", "generationId" in lgen)

# ── 15. 唯讀權限（§56-F）：檢視者讀得到、改不了 ──
viewer = client()
inv = call("POST", admin, "admin.invite",
           {"email": "storyviewer@example.com", "teamId": north["id"], "teamRole": "member",
            "groupId": gid, "groupRole": "member"})
call("POST", viewer, "auth.acceptInvite",
     {"token": inv["inviteUrl"].split("/")[-1], "name": "故事檢視者", "password": "story-viewer-88"})
vid = call("GET", viewer, "auth.me")["user"]["id"]
call("POST", admin, "projects.setProjectRole", {"projectId": lpid, "userId": vid, "role": "viewer"})

ok("檢視者讀得到故事頁", "__error__" not in call("GET", viewer, "story.get", {"projectId": lpid}))
ok("檢視者讀得到連戲檢查", "__error__" not in call("GET", viewer, "story.continuityCheck", {"projectId": lpid}))
ok("檢視者讀得到影響查詢",
   "__error__" not in call("GET", viewer, "story.entityImpact",
                           {"projectId": lpid, "kind": "character", "entityId": lc["id"]}))
for label, path, payload in [
    ("存故事", "story.save", {"projectId": lpid, "content": "檢視者不該能寫"}),
    ("解析故事", "story.parse", {"projectId": lpid}),
    ("產生分鏡", "story.generateStoryboard", {"projectId": lpid}),
]:
    r = call("POST", viewer, path, payload)
    # 要求「就是唯讀擋下的那句」——只斷言「有錯」的話，500 或參數錯也會讓這條變綠燈
    ok(f"🔒 檢視者不能{label}", "檢視者" in r.get("__error__", ""))
ok("🔒 檢視者不能新增造型",
   "檢視者" in call("POST", viewer, "characterLooks.add",
                    {"characterId": lc["id"], "name": "偷改", "costume": "不該成功"}).get("__error__", ""))
ok("🔒 檢視者不能就地生成",
   "檢視者" in call("POST", viewer, "scenes.generateInto",
                    {"sceneId": lshots[0]["id"], "modelId": "fal-ai/flux/schnell"}).get("__error__", ""))
ok("檢視者的越權沒有真的改到資料",
   call("GET", admin, "story.get", {"projectId": lpid})["story"] is None)
