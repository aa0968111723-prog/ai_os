#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# 動畫組・多鏡頭一致性 e2e（Animation team multi-shot consistency）
#
# 動畫組最在意的是「同一個角色/場景/道具，換了鏡頭還是同一個」。這支腳本用一個
# 真的短片腳本（老街紅燈籠，6 個鏡頭）把整條一致性機制跑一遍，並用機器可驗的方式
# 證明：
#
#   1. 故事背景（世界觀）自動注入每一鏡的提示詞（[專案背景]）。
#   2. 角色 / 場景 / 每個細節素材 的「錨點」跨鏡完全一致（同一段文字逐字相同）。
#   3. 角色造型（Identity 不變、Look 逐鏡可換）鎖進一致性快照。
#   4. 逐鏡的鏡頭語言與「角色動作物理」（走位/運鏡/動作）各自不同，但不破壞上面的鎖定。
#   5. 跨鏡 continuity 指紋（fingerprint）逐字相同 = 這批鏡頭真的是同一組卡片凍出來的。
#   6. 換一套造型 = 系統知道那是「另一個一致性狀態」（指紋改變，身份不變）。
#   7. 連戲檢查（continuity checker）會抓到：改了角色外觀 → 舊鏡頭全部過時；
#      改了某一鏡的動作 → 只有那一鏡過時。這正是動畫組要的「不一致會被通知」。
#      （#753：generateInto 只產 Candidate，必須 Adopt 後畫面才回填，連戲檢查才看得到。）
#   8. 三視圖模型選擇：純 text-to-video 參考圖 0/N 且發出 multi_reference_unsupported；
#      多圖 edit 模型才會 attached≥1。這鎖住 SOP 的兩段式建議。
#
# 前置：E2E_MOCK=1（假生成，免 FAL_KEY）、:3199、SEED_ADMIN_*、全新 DB。
# 執行：見 scripts/run-animation-consistency.sh（自帶 DB 重置 + 起假生成伺服器）。
# ─────────────────────────────────────────────────────────────────────────────
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from e2e_lib import ok

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
BASE = f"{HOST}/api/trpc"
# 影片模型：kind=video ⇒ 逐鏡「動作」會被注入提示詞（角色動作物理看得到）。
MODEL = os.environ.get("E2E_MODEL", "fal-ai/wan/v2.2-a14b/text-to-video")


class Client:
    def __init__(self):
        self.cookie = None

    def open(self, req):
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req)


def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if data is None and op == "GET":
        req = urllib.request.Request(url)
    elif op == "GET":
        req = urllib.request.Request(url + "?input=" + urllib.parse.quote(json.dumps({"json": data})))
    else:
        req = urllib.request.Request(
            url,
            data=json.dumps({"json": data}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
    try:
        with opener.open(req) as r:
            sc = r.headers.get("Set-Cookie")
            if sc:
                opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if "error" in body:
        return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]


def wait_gen_done(opener, gen_id, timeout=90):
    """輪詢單筆生成到 done/failed。"""
    st = {}
    for _ in range(timeout):
        st = call("GET", opener, "generation.status", {"id": gen_id})
        if isinstance(st, dict) and st.get("status") in ("done", "failed"):
            return st
        time.sleep(1)
    return st


def anchor_tail(positive_prompt):
    """把提示詞中「使用者/鏡頭那一段」切掉，只留世界觀＋卡片錨點那一段（跨鏡應逐字相同）。"""
    marker = "[專案背景]"
    idx = positive_prompt.find(marker)
    return positive_prompt[idx:] if idx >= 0 else positive_prompt


def upload_tiny_png(opener, project_id, filename):
    """multipart 上傳 1×1 PNG（與 e2e-story 同一顆最小合法圖）。"""
    boundary = "----animconsistency"
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c6360000002000100ffff03000006000557bfabd400000000"
        "49454e44ae426082"
    )
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"projectId\"\r\n\r\n{project_id}\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n".encode(),
        png,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(
        f"{HOST}/api/upload",
        data=b"".join(parts),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    if opener.cookie:
        req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"__error__": e.read().decode()[:200]}


def continuity_note(prev):
    return next((c.get("note") or "" for c in prev.get("context", []) if c.get("type") == "continuity"), "")


def warning_codes(prev):
    return {w.get("code") for w in (prev.get("warnings") or [])}


# ── 0. 登入 → 找到「動畫組」 ─────────────────────────────────────────────
admin = Client()
login = call("POST", admin, "auth.login", {
    "email": os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local"),
    "password": os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123"),
})
ok("開發者登入成功", isinstance(login, dict) and "__error__" not in login)

teams = call("GET", admin, "admin.overview")
anim_group = None
for t in teams:
    for g in t.get("groups", []):
        if g["name"] == "動畫組":
            anim_group = g
            break
ok("找到『動畫組』（種子資料）", anim_group is not None)
gid = anim_group["id"]

# ── 1. 建專案 + 故事背景（世界觀）──────────────────────────────────────
proj = call("POST", admin, "projects.create", {
    "groupId": gid,
    "title": "動畫短片・老街的紅燈籠",
    "kind": "療癒動畫",
    "platform": "shorts",
})
ok("動畫組建立專案", isinstance(proj, dict) and proj.get("id"))
pid = proj["id"]

wv = call("POST", admin, "projects.updateWorldview", {
    "id": pid,
    "worldview": {
        "logline": "一個小女孩在除夕的老街，提著一盞紅燈籠尋找回家的路。",
        "message": "再遠的路，只要有一盞燈，就找得到家。",
        "audience": "闔家觀賞・農曆新年檔",
        "themes": ["思鄉", "團圓", "溫暖"],
        "tones": ["溫暖", "懷舊", "療癒"],
        "styles": ["2D 手繪動畫", "水彩質感"],
    },
})
ok("世界觀寫入（故事背景）", isinstance(wv, dict) and "__error__" not in wv)

# ── 2. 角色 / 場景 / 細節素材 卡（可重用的「聖經」）─────────────────────
lian = call("POST", admin, "characters.add", {
    "projectId": pid,
    "name": "小蓮",
    "appearance": "六歲女孩、圓臉、齊瀏海黑色短髮、圓亮的大眼睛、臉頰兩團紅暈、身形嬌小",
    "notes": "怕黑但很勇敢；聲音軟軟的",
})
afu = call("POST", admin, "characters.add", {
    "projectId": pid,
    "name": "阿福",
    "appearance": "橘白色胖貓、圓臉短毛、琥珀色眼睛、脖子繫一個小銅鈴",
    "notes": "小蓮的貓，總是跟在腳邊",
})
ok("兩個角色卡建立（角色一致性來源）", lian.get("id") and afu.get("id"))

# 造型（Look）：身份不變、造型逐鏡可換
look_day = call("POST", admin, "characterLooks.add", {
    "characterId": lian["id"],
    "name": "日常",
    "costume": "藍色布棉襖、深藍棉褲、黑色布鞋",
})
look_night = call("POST", admin, "characterLooks.add", {
    "characterId": lian["id"],
    "name": "除夕夜",
    "costume": "大紅棉襖、繡花圍巾、紅色虎頭鞋",
})
ok("小蓮兩套造型建立（日常/除夕夜）", look_day.get("id") and look_night.get("id"))

street = call("POST", admin, "scenePresets.add", {
    "projectId": pid,
    "name": "除夕老街",
    "palette": "暖橙與靛藍對比、青石板路、木造老屋、褪色春聯",
    "lighting": "入夜燈籠暖光、遠處煙火冷光",
})
ok("場景卡建立（場景一致性來源）", street.get("id"))

lantern = call("POST", admin, "props.add", {
    "projectId": pid,
    "name": "紅燈籠",
    "appearance": "紅紙燈籠、金色流蘇、深褐竹骨、正面墨字一個「福」、底部微微透光",
    "ownerKind": "character",
    "ownerId": lian["id"],
})
ok("細節素材卡建立（每個細節都要一致：紅燈籠）", lantern.get("id"))

# ── 3. 六個鏡頭（多鏡頭）：同一組卡片 + 逐鏡不同的鏡頭語言/動作物理 ────────
CHAR_IDS = [lian["id"], afu["id"]]
SHOTS = [
    {
        "title": "鏡1・大遠景・出發",
        "prompt": "除夕入夜的老街，小蓮提著紅燈籠站在長長的青石板路起點，阿福蹲在她腳邊",
        "camera": {"shotSize": "大遠景", "angle": "平視", "movement": "固定", "composition": "中央對稱"},
        "performance": {"emotion": "既期待又不安", "gaze": "望向遠方街尾"},
        "action": "小蓮邁開腳步往前走，燈籠隨著步伐輕輕晃動",
    },
    {
        "title": "鏡2・中景・跟拍",
        "prompt": "小蓮走在老街上，兩旁老屋的燈籠一盞盞亮起",
        "camera": {"shotSize": "中景", "angle": "平視", "movement": "側向跟拍", "composition": "三分法"},
        "performance": {"emotion": "專注", "gaze": "看著手中燈籠"},
        "action": "小蓮穩定地向前走，阿福小跑步跟上，尾巴左右擺動",
    },
    {
        "title": "鏡3・特寫・道具物理",
        "prompt": "紅燈籠的特寫，夜風吹過",
        "camera": {"shotSize": "大特寫", "angle": "微仰", "movement": "緩慢推近", "composition": "淺景深"},
        "performance": {"emotion": "—", "gaze": "—"},
        "action": "紅燈籠被夜風吹得左右搖晃，金色流蘇飄動，福字忽明忽暗",
    },
    {
        "title": "鏡4・過肩・對話",
        "prompt": "小蓮蹲下身，低頭看著腳邊的阿福",
        "camera": {"shotSize": "過肩", "angle": "俯視", "movement": "固定", "composition": "前景阿福虛化"},
        "performance": {"emotion": "溫柔", "gaze": "看著阿福"},
        "action": "小蓮蹲下，把燈籠湊近阿福，阿福伸出前掌想碰流蘇",
    },
    {
        "title": "鏡5・仰角・情緒高點",
        "prompt": "小蓮抬起頭，燈籠的暖光映在她臉上，遠處第一朵煙火升空",
        "camera": {"shotSize": "近景", "angle": "仰角", "movement": "手持微晃", "composition": "留白給煙火"},
        "performance": {"emotion": "眼睛發亮的驚喜", "gaze": "仰望煙火"},
        "action": "小蓮抬頭、嘴巴微張，燈籠在手中穩穩舉高",
    },
    {
        "title": "鏡6・大遠景・收尾",
        "prompt": "老街盡頭出現溫暖的家門燈光，小蓮與阿福的剪影往家的方向走去",
        "camera": {"shotSize": "大遠景", "angle": "平視", "movement": "緩慢拉遠", "composition": "引導線指向家門"},
        "performance": {"emotion": "安心", "gaze": "望向家門"},
        "action": "小蓮與阿福並肩往街尾的家門緩緩走遠，燈籠光點越來越小",
    },
]


def bind_and_dress(sid, look_ids):
    call("POST", admin, "scenes.setCards", {
        "sceneId": sid,
        "characterIds": CHAR_IDS,
        "scenePresetIds": [street["id"]],
        "propIds": [lantern["id"]],
        "lookIds": look_ids,
    })


shot_ids = []
for s in SHOTS:
    row = call("POST", admin, "scenes.addDraft", {"projectId": pid, "title": s["title"], "prompt": s["prompt"]})
    ok(f"分鏡建立：{s['title']}", isinstance(row, dict) and row.get("id"))
    sid = row["id"]
    bind_and_dress(sid, [look_day["id"]])  # 六鏡都是「日常」造型 → 應同一致性狀態
    upd = call("POST", admin, "scenes.update", {
        "sceneId": sid,
        "camera": s["camera"],
        "performance": s["performance"],
        "action": s["action"],
    })
    ok(f"鏡頭語言/動作寫入：{s['title']}", isinstance(upd, dict) and "__error__" not in upd)
    shot_ids.append(sid)

ok("多鏡頭建立完成（6 鏡）", len(shot_ids) == 6)

# ── 4. 生成前：用 preview 證明「故事背景 + 角色/場景/道具錨點」跨鏡逐字一致 ──
tails = []
first_preview_pos = None
for s, sid in zip(SHOTS, shot_ids):
    prev = call("POST", admin, "generation.preview", {
        "projectId": pid,
        "modelId": MODEL,
        "prompt": s["prompt"],
        "characterIds": CHAR_IDS,
        "scenePresetIds": [street["id"]],
        "propIds": [lantern["id"]],
        "continuityMode": True,
    })
    if "__error__" in prev:
        ok(f"preview 失敗：{s['title']}", False)
        continue
    pos = prev["request"]["positivePrompt"]
    if first_preview_pos is None:
        first_preview_pos = pos
    tails.append(anchor_tail(pos))

ok("每一鏡都注入了故事背景（[專案背景]）", all("[專案背景]" in t for t in tails) and len(tails) == 6)
ok("每一鏡都鎖定了兩個角色（外觀鎖定 小蓮/阿福）",
   all(("外觀鎖定 小蓮" in t and "外觀鎖定 阿福" in t) for t in tails))
ok("每一鏡都鎖定了場景（光影鎖定 除夕老街）", all("光影鎖定 除夕老街" in t for t in tails))
ok("每一鏡都鎖定了細節素材（紅燈籠）", all("紅燈籠" in t for t in tails))
ok("角色/場景/素材錨點跨 6 鏡逐字完全一致", len(set(tails)) == 1)

# ── 5. 逐鏡假生成，回填素材 ─────────────────────────────────────────────
gen_by_shot = {}
for s, sid in zip(SHOTS, shot_ids):
    g = call("POST", admin, "scenes.generateInto", {"sceneId": sid, "modelId": MODEL})
    ok(f"送出生成：{s['title']}", isinstance(g, dict) and g.get("generationId"))
    gen_by_shot[sid] = g["generationId"]

done_gens = {}
for sid, gen_id in gen_by_shot.items():
    st = wait_gen_done(admin, gen_id)
    ok(f"生成完成（假模式）：{gen_id[:8]}", isinstance(st, dict) and st.get("status") == "done")
    done_gens[sid] = st
    # #753：就地生成是 Candidate，不 silent 改 current。連戲檢查比的是「現用畫面」，
    # 必須明確採用之後分鏡才有 assetId。
    adopted = call("POST", admin, "creativeContext.adoptGeneration", {"generationId": gen_id})
    ok(f"明確採用回填分鏡：{sid[:8]}", isinstance(adopted, dict) and "__error__" not in adopted)

# ── 6. 生成後：continuity 指紋跨鏡一致 + 逐鏡動作物理各自不同 ───────────
fingerprints = []
for sid in shot_ids:
    snap = done_gens[sid].get("continuitySnapshot")
    ok(f"生成凍結了一致性快照：{sid[:8]}", isinstance(snap, dict) and snap.get("fingerprint"))
    if snap:
        fingerprints.append(snap["fingerprint"])

common_fp = fingerprints[0] if fingerprints else None
ok("跨 6 鏡 continuity 指紋逐字相同（同一組卡片凍出來）",
   len(set(fingerprints)) == 1 and len(fingerprints) == 6)

# 凍進快照的卡片內容一致：角色/場景/道具 id 集合相同
char_sets = {tuple(sorted(c["id"] for c in done_gens[sid]["continuitySnapshot"]["characters"])) for sid in shot_ids}
scene_sets = {tuple(sorted(s["id"] for s in done_gens[sid]["continuitySnapshot"]["scenes"])) for sid in shot_ids}
prop_sets = {tuple(sorted(p["id"] for p in done_gens[sid]["continuitySnapshot"]["props"])) for sid in shot_ids}
ok("跨鏡角色綁定一致", len(char_sets) == 1)
ok("跨鏡場景綁定一致", len(scene_sets) == 1)
ok("跨鏡道具綁定一致", len(prop_sets) == 1)

# 造型鎖進快照：六鏡都是「日常」布棉襖
day_costumes = set()
for sid in shot_ids:
    for c in done_gens[sid]["continuitySnapshot"]["characters"]:
        if c["id"] == lian["id"]:
            day_costumes.add(c.get("lookCostume"))
ok("小蓮六鏡造型一致（日常・藍色布棉襖）",
   len(day_costumes) == 1 and "藍色布棉襖" in (next(iter(day_costumes)) or ""))

# 逐鏡動作物理各自不同、但都真的注入了（影片模型 → 提示詞含「動作：」）
prompts = {sid: (done_gens[sid].get("prompt") or "") for sid in shot_ids}
ok("每一鏡都注入了角色動作物理（提示詞含『動作：』）", all("動作：" in p for p in prompts.values()))
ok("鏡3 特寫凍住了『道具物理』動作（燈籠搖晃）", "搖晃" in prompts[shot_ids[2]])
ok("鏡5 凍住了自己的鏡頭語言（仰角）", "仰角" in prompts[shot_ids[4]])
ok("六鏡的鏡頭/動作提示詞彼此不同（多鏡頭有變化）", len(set(prompts.values())) == 6)

# ── 7. 換一套造型 = 另一個一致性狀態（身份不變、指紋改變）────────────────
night_shot = call("POST", admin, "scenes.addDraft", {
    "projectId": pid, "title": "鏡5b・同一鏡・改除夕夜造型",
    "prompt": SHOTS[4]["prompt"],
})
bind_and_dress(night_shot["id"], [look_night["id"]])
call("POST", admin, "scenes.update", {
    "sceneId": night_shot["id"], "camera": SHOTS[4]["camera"], "performance": SHOTS[4]["performance"],
    "action": SHOTS[4]["action"],
})
gn = call("POST", admin, "scenes.generateInto", {"sceneId": night_shot["id"], "modelId": MODEL})
night_done = wait_gen_done(admin, gn["generationId"])
ok("換造型鏡生成完成", night_done.get("status") == "done")
night_adopted = call("POST", admin, "creativeContext.adoptGeneration", {"generationId": gn["generationId"]})
ok("換造型鏡明確採用", isinstance(night_adopted, dict) and "__error__" not in night_adopted)
night_snap = night_done.get("continuitySnapshot") or {}
night_lian = next((c for c in night_snap.get("characters", []) if c["id"] == lian["id"]), {})
ok("換造型：造型鎖定變成除夕夜（大紅棉襖）", "大紅棉襖" in (night_lian.get("lookCostume") or ""))
ok("換造型：角色身份（外觀）不變", night_lian.get("appearance") == lian["appearance"])
ok("換造型：這是另一個一致性狀態（指紋與日常六鏡不同）", night_snap.get("fingerprint") != common_fp)

# ── 8. 連戲檢查：卡片沒動 → 不誤報；動作改一鏡 → 只那一鏡過時；改外觀 → 全部過時 ──
base = call("GET", admin, "story.continuityCheck", {"projectId": pid})
ok("卡片未改動時，連戲檢查不誤報（total=0）", base.get("total") == 0)

# 8a. 只改鏡2 的動作（角色動作物理漂移）→ 只有鏡2 過時
call("POST", admin, "scenes.update", {"sceneId": shot_ids[1], "action": "小蓮突然停下腳步、轉身往回跑"})
after_action = call("GET", admin, "story.continuityCheck", {"projectId": pid})
outdated_ids = {o["shotId"] for o in after_action.get("outdated", [])}
ok("改動作後：連戲檢查只標這一鏡過時", after_action.get("total") == 1 and shot_ids[1] in outdated_ids)
ok("過時原因指出是『動作』", any("動作" in o["reason"] for o in after_action.get("outdated", [])))
# 還原 → 不再過時
call("POST", admin, "scenes.update", {"sceneId": shot_ids[1], "action": SHOTS[1]["action"]})
reverted = call("GET", admin, "story.continuityCheck", {"projectId": pid})
ok("還原動作後：連戲檢查回到 0", reverted.get("total") == 0)

# 8b. 改角色外觀（改角色設計）→ 所有用到小蓮的鏡頭全部過時（設計改動的爆炸半徑）
call("POST", admin, "characters.update", {
    "id": lian["id"],
    "appearance": "六歲女孩、圓臉、齊瀏海黑色短髮、圓亮的大眼睛、臉頰兩團紅暈、身形嬌小、頭上多戴一個紅色蝴蝶結",
})
after_design = call("GET", admin, "story.continuityCheck", {"projectId": pid})
outdated_after = after_design.get("outdated", [])
ok("改角色外觀後：所有用到小蓮的鏡頭全部被標過時（含換造型鏡=7 鏡）", after_design.get("total") == 7)
ok("過時原因指出是『外觀』", all("外觀" in o["reason"] for o in outdated_after))

# ── 9. 三視圖模型選擇（SOP 實測）：純影片 0/N；多圖 edit 才 attached≥1 ──
EDIT_MODEL = os.environ.get("E2E_EDIT_MODEL", "fal-ai/nano-banana-2/edit")
up = upload_tiny_png(admin, pid, "小蓮三視圖_OK.png")
ok("定裝參考圖上傳成功", isinstance(up, dict) and (up.get("ok") or up.get("duplicate")))
ref_id = (up.get("asset") or up.get("duplicate") or {}).get("id")
bound = call("POST", admin, "characters.update", {"id": lian["id"], "referenceAssetId": ref_id}) if ref_id else {"__error__": "no asset"}
ok("小蓮綁定定裝參考圖", isinstance(bound, dict) and "__error__" not in bound)

preview_payload = {
    "projectId": pid,
    "prompt": SHOTS[0]["prompt"],
    "characterIds": CHAR_IDS,
    "scenePresetIds": [street["id"]],
    "propIds": [lantern["id"]],
    "continuityMode": True,
}
wan_prev = call("POST", admin, "generation.preview", {**preview_payload, "modelId": MODEL})
edit_prev = call("POST", admin, "generation.preview", {**preview_payload, "modelId": EDIT_MODEL})
ok("純影片模型仍可預覽（文字錨點弱鎖）", isinstance(wan_prev, dict) and "__error__" not in wan_prev)
ok("多圖 edit 模型可預覽", isinstance(edit_prev, dict) and "__error__" not in edit_prev)
ok("純影片模型：參考圖 0/N（三視圖沒被帶進）", "參考圖 0/" in continuity_note(wan_prev))
ok("純影片模型發出 multi_reference_unsupported", "multi_reference_unsupported" in warning_codes(wan_prev))
ok("純影片模型建議兩段式（edit＋三視圖 → i2v）", any(
    "兩段式" in (w.get("suggestion") or "") for w in (wan_prev.get("warnings") or [])
    if w.get("code") == "multi_reference_unsupported"
))
ok("多圖 edit 模型：參考圖帶進去了（attached≥1）",
   "參考圖 0/" not in continuity_note(edit_prev) and "參考圖 " in continuity_note(edit_prev))
ok("多圖 edit 模型沒有誤報 multi_reference_unsupported",
   "multi_reference_unsupported" not in warning_codes(edit_prev))

# ── 10. Temporal/Board/Pipeline：只讀投影，不打 evaluator/provider ──────────
packets = call("GET", admin, "creativeContext.listShotPackets", {"projectId": pid})
ok("每鏡都有 server-authoritative Shot Packet", len(packets) >= 7)
ok("Shot Packet 同時凍結 expected start/end（不是只驗 prompt）",
   all(p.get("packet", {}).get("continuity", {}).get("currentStart") is not None
       and p.get("packet", {}).get("continuity", {}).get("currentEnd") is not None
       for p in packets))

board = call("GET", admin, "creativeContext.animationBoard", {"projectId": pid})
ok("動畫製作看板由既有鏡頭/素材投影", board.get("summary", {}).get("total") == 7)
ok("看板只回一個主要下一步", board.get("primaryAction") is None or (
   board["primaryAction"].get("shotId") and board["primaryAction"].get("label")))

plan = call("GET", admin, "creativeContext.animationPlan", {
    "projectId": pid,
    "shotId": shot_ids[0],
    "keyframeModelId": "fal-ai/nano-banana-2/edit",
    "videoModelId": "fal-ai/wan/v2.2-a14b/image-to-video",
})
ok("Keyframe-first 計畫明列 6 階段與成本、不自動執行",
   len(plan.get("stages", [])) == 6
   and all("estimatedPoints" in stage for stage in plan.get("stages", [])))
ok("兩個 Adopt 都是獨立人工階段", {
   stage["kind"] for stage in plan.get("stages", []) if stage.get("kind", "").endswith("_adopt")
} == {"keyframe_adopt", "video_adopt"})

# ── 11. 給人看的證據摘要 ─────────────────────────────────────────────────
print("\n──────── 證據摘要（一鏡的完整組裝提示詞）────────")
if first_preview_pos:
    print(first_preview_pos[:1200])
print("\n──────── 跨鏡 continuity 指紋 ────────")
for s, sid in zip(SHOTS, shot_ids):
    fp = done_gens[sid]["continuitySnapshot"]["fingerprint"]
    print(f"  {s['title']:<22} fp={fp[:16]}…")
print(f"  {'鏡5b（除夕夜造型）':<22} fp={(night_snap.get('fingerprint') or '')[:16]}…  ← 造型不同，指紋刻意不同")
print("\n──────── 三視圖模型選擇 ────────")
print(f"  {MODEL:<42} {continuity_note(wan_prev)}")
print(f"  {EDIT_MODEL:<42} {continuity_note(edit_prev)}")
print("──────────────────────────────────────────\n")
