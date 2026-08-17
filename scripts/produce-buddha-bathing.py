#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# 實際製作：佛傳動畫〈九龍浴太子〉一場戲，直接在 Aios（動畫組）建成可生成的分鏡。
#
# 腳本（旁白）：
#   難陀龍王、優波難陀龍王，於虛空中，吐清淨水，一溫一涼，灌浴太子之身。
#   《註：過去現在因果經》。諸天人演奏妙音，灑下繽紛香花供養。此時十方大地現六種震動，
#   所有眾生都感受到前所未有的喜悅。
# 畫面說明：(1) 七彩光照到小世尊身上　(2) 兩股水隨即從天而瀉，沐浴在王子的身上
#
# 這支腳本會：
#   1. 從動畫組雲端下載「已確認(OK)」的角色三視圖當定裝參考圖（鎖長相）。
#   2. 在動畫組建立專案、世界觀（畫風＝暖色系手繪水彩、金色頭光）。
#   3. 建角色卡（嬰兒太子/天人 綁參考圖；難陀・優波難陀龍王＝文字卡，因為雲端還沒有 OK 的龍王三視圖）。
#   4. 建場景卡、細節素材卡（清淨水一溫一涼／七彩光／香花）。
#   5. 依畫面說明＋旁白拆 6 個分鏡，逐鏡綁卡＋鏡頭語言＋角色/水的動作物理。
#   6. 對每一鏡跑「生成前預覽」，印出 AI 實際會收到的、鎖好一致性的完整提示詞。
#
# 用法（對真實開發站 :3000）：
#   E2E_PORT=3000 SEED_ADMIN_PASSWORD=dev-admin-123456 python3 scripts/produce-buddha-bathing.py
# 沒有 FAL_KEY 時只到「可生成」為止（預覽即為交付物）；填了 FAL_KEY 後在站上按生成即出圖。
# ─────────────────────────────────────────────────────────────────────────────
import json
import mimetypes
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
import uuid

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3000')}"
BASE = f"{HOST}/api/trpc"
EMAIL = os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local")
PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD", "dev-admin-123456")
REF_DIR = os.environ.get("REF_DIR", "/tmp/refs")

# 動畫組雲端「角色三視圖」中，檔名標了 OK＝宛鶯確認可用的定裝
DRIVE_REFS = {
    "baby_prince_OK.png": "1QQRmQuOTlpzT1zIUg5CSC5YQgohSxKMW",   # 三視圖_嬰兒太子_OK
    "deva_drummer_OK.png": "1g4lswd7VXLrr7PuAFCSkpqndOk10B7DJ",  # 三視圖_印度天人-打鼓_OK
    "concept_miaoyin.png": "1nUawStqtV4SrsdsWIhwzr6orcX1uEDKA",  # 諸法緣起-天人演奏妙音（場景氛圍）
}


class Client:
    def __init__(self):
        self.cookie = None

    def open(self, req):
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req, context=ssl.create_default_context())


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
            if sc:
                opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if isinstance(body, dict) and "error" in body:
        return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]


def ensure_refs():
    os.makedirs(REF_DIR, exist_ok=True)
    for name, fid in DRIVE_REFS.items():
        path = os.path.join(REF_DIR, name)
        if os.path.exists(path) and os.path.getsize(path) > 10000:
            continue
        url = f"https://drive.google.com/uc?export=download&id={fid}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, context=ssl.create_default_context()) as r:
                open(path, "wb").write(r.read())
            print(f"  ↓ 下載參考圖 {name} ({os.path.getsize(path)} bytes)")
        except Exception as e:
            print(f"  ⚠ 下載 {name} 失敗：{e}（該卡改為文字卡）")


def upload_image(opener, project_id, path):
    """multipart 上傳一張圖到專案，回傳 asset id。"""
    if not (os.path.exists(path) and os.path.getsize(path) > 1000):
        return None
    boundary = "----aios" + uuid.uuid4().hex
    fname = os.path.basename(path)
    ctype = mimetypes.guess_type(fname)[0] or "image/png"
    body = bytearray()

    def field(name, value):
        body.extend((f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").encode())

    field("projectId", project_id)
    field("title", fname)
    body.extend((f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{fname}\"\r\n"
                 f"Content-Type: {ctype}\r\n\r\n").encode())
    body.extend(open(path, "rb").read())
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    req = urllib.request.Request(f"{HOST}/api/upload", data=bytes(body),
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    try:
        with opener.open(req) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        print(f"  ⚠ 上傳 {fname} 失敗：{e.read().decode()[:160]}")
        return None
    if res.get("ok") and res.get("asset"):
        print(f"  ↑ 上傳素材 {fname} → asset {res['asset']['id'][:8]}")
        return res["asset"]["id"]
    if res.get("duplicate"):
        return res["duplicate"]["id"]
    return None


def main():
    print("下載已確認的角色三視圖…")
    ensure_refs()

    admin = Client()
    login = call("POST", admin, "auth.login", {"email": EMAIL, "password": PASSWORD})
    assert "__error__" not in login, f"登入失敗：{login}"
    print(f"登入成功（{EMAIL}）")

    teams = call("GET", admin, "admin.overview")
    gid = None
    for t in teams:
        for g in t.get("groups", []):
            if g["name"] == "動畫組":
                gid = g["id"]
    assert gid, "找不到『動畫組』"

    TITLE = "佛傳動畫・九龍浴太子"
    existing = call("GET", admin, "projects.list", {"groupId": gid})
    found = next((p for p in (existing or []) if p.get("title") == TITLE), None)
    if found and os.environ.get("FORCE_REBUILD") != "1":
        print(f"專案已存在 id={found['id'][:8]} — 沿用，不重複建立。設 FORCE_REBUILD=1 會再建一個。")
        print(f"開啟：{HOST.replace(':3000', ':5173')}/p/{found['id']}")
        print(f"PROJECT_ID={found['id']}")
        return

    proj = call("POST", admin, "projects.create", {
        "groupId": gid, "title": TITLE, "kind": "佛傳動畫",
        "platform": "youtube", "format": "16:9",
    })
    assert proj.get("id"), f"建專案失敗：{proj}"
    pid = proj["id"]
    print(f"建立專案：{TITLE}（16:9）  id={pid[:8]}")

    call("POST", admin, "projects.updateWorldview", {"id": pid, "worldview": {
        "logline": "難陀與優波難陀龍王於虛空吐一溫一涼二水，灌浴初生的悉達多太子。",
        "message": "諸法緣起、天地同慶——佛陀降生，眾生法喜。",
        "audience": "佛教弘法動畫・闔家",
        "themes": ["佛陀降生", "九龍浴太子", "莊嚴", "法喜"],
        "tones": ["莊嚴", "神聖", "溫暖", "祥和"],
        "styles": ["2D 手繪水彩插畫", "暖色系、柔和線條", "人物帶金色頭光"],
        "taboos": ["血腥", "現代物品", "文字浮水印"],
    }})
    print("世界觀（故事背景＋畫風）已寫入")

    # 參考圖上傳
    ref_baby = upload_image(admin, pid, os.path.join(REF_DIR, "baby_prince_OK.png"))
    ref_deva = upload_image(admin, pid, os.path.join(REF_DIR, "deva_drummer_OK.png"))
    ref_scene = upload_image(admin, pid, os.path.join(REF_DIR, "concept_miaoyin.png"))

    # 角色卡
    baby = call("POST", admin, "characters.add", {
        "projectId": pid, "name": "小世尊（嬰兒太子）",
        "appearance": "初生男嬰、圓潤臉龐、額前一撮黑髮、雙眼微闔、神情安詳、身裹橘紅色錦襁褓、頭後有柔和金色圓光",
        "notes": "本場被灌浴的主體；始終安詳、法相莊嚴。定裝以雲端『三視圖_嬰兒太子_OK』為準。",
        **({"referenceAssetId": ref_baby} if ref_baby else {}),
    })
    deva = call("POST", admin, "characters.add", {
        "projectId": pid, "name": "天人（奏樂）",
        "appearance": "印度天人、藍色天衣、金色錐形寶冠、耳環瓔珞、結跏趺坐、頭後金色圓光、手持雙面鼓",
        "notes": "諸天人之一，演奏妙音。定裝以雲端『三視圖_印度天人-打鼓_OK』為準。",
        **({"referenceAssetId": ref_deva} if ref_deva else {}),
    })
    nanda = call("POST", admin, "characters.add", {
        "projectId": pid, "name": "難陀龍王",
        "appearance": "東方神龍、修長蛇身、鹿角、金鱗泛青、鬣毛與長鬚、五爪、雙目炯然；此為溫水之龍，鱗色偏暖金",
        "notes": "⚠ 雲端尚無『OK』的龍王三視圖——此為暫定文字設定，須經宛鶯定裝後補三視圖再鎖圖。吐『溫水』。",
    })
    upananda = call("POST", admin, "characters.add", {
        "projectId": pid, "name": "優波難陀龍王",
        "appearance": "東方神龍、修長蛇身、鹿角、銀鱗泛藍、鬣毛與長鬚、五爪、雙目炯然；此為涼水之龍，鱗色偏冷藍",
        "notes": "⚠ 雲端尚無『OK』的龍王三視圖——暫定文字設定，須補三視圖再鎖圖。與難陀龍王對稱，吐『涼水』。",
    })
    print("角色卡：小世尊、天人（皆綁定裝參考圖）、難陀/優波難陀龍王（文字卡，待補三視圖）")

    # 場景卡
    scene = call("POST", admin, "scenePresets.add", {
        "projectId": pid, "name": "藍毗尼園・虛空",
        "palette": "暖橙金與天青對比、祥雲繚繞、遠處無憂樹與園林、水彩暈染",
        "lighting": "自天而降的七彩祥光為主光、雲間金色逆光、整體柔和高明度",
        **({"referenceAssetId": ref_scene} if ref_scene else {}),
    })
    print("場景卡：藍毗尼園・虛空（綁氛圍參考圖）")

    # 細節素材卡（每個細節都要一致）
    water = call("POST", admin, "props.add", {
        "projectId": pid, "name": "清淨二水（一溫一涼）",
        "appearance": "兩股自天而瀉的清澈水柱、一道暖金（溫）一道清藍（涼）、水花帶細碎光點、半透明水彩質感",
        "ownerKind": "character", "ownerId": baby["id"],
    })
    light = call("POST", admin, "props.add", {
        "projectId": pid, "name": "七彩祥光",
        "appearance": "自天而降的七彩柱狀祥光、彩虹漸層、邊緣柔化發光、光中飄浮金色微粒",
        "ownerKind": "scene", "ownerId": scene["id"],
    })
    flowers = call("POST", admin, "props.add", {
        "projectId": pid, "name": "繽紛香花",
        "appearance": "自空中灑落的曼陀羅花瓣、粉白與金黃、花瓣飄墜帶淡淡光暈",
        "ownerKind": "scene", "ownerId": scene["id"],
    })
    print("細節素材卡：清淨二水（一溫一涼）、七彩祥光、繽紛香花")

    # ── 6 個分鏡（依畫面說明＋旁白）──────────────────────────────
    C_ALL = [baby["id"]]
    SHOTS = [
        {
            "title": "鏡1・七彩光罩身",  # 畫面說明(1)
            "prompt": "虛空祥雲之中，初生的小世尊安詳現身；一道七彩祥光自天而降，恰恰籠罩在祂身上",
            "chars": [baby["id"]], "props": [light["id"]],
            "camera": {"shotSize": "中景", "angle": "微俯", "movement": "緩緩下降", "composition": "中央對稱、光柱居中"},
            "performance": {"emotion": "安詳莊嚴", "gaze": "雙眼微闔"},
            "action": "七彩祥光自天緩緩灑落、逐漸包覆小世尊，光中金粒浮動",
        },
        {
            "title": "鏡2・二龍現身",
            "prompt": "難陀龍王與優波難陀龍王自虛空祥雲間盤旋現身，一暖金一冷藍，昂首相對、蓄勢欲吐清淨水",
            "chars": [nanda["id"], upananda["id"]],
            "camera": {"shotSize": "大遠景", "angle": "仰角", "movement": "環繞", "composition": "左右對稱雙龍"},
            "performance": {"emotion": "威儀慈和", "gaze": "俯視太子"},
            "action": "兩條神龍在雲間盤旋交錯、龍身起伏、昂首張口凝聚水氣",
        },
        {
            "title": "鏡3・二水灌浴",  # 畫面說明(2)
            "prompt": "兩股清淨水自天而瀉——一溫一涼、一金一藍——交會沐浴在王子身上，水花四濺化為光點",
            "chars": [baby["id"], nanda["id"], upananda["id"]], "props": [water["id"]],
            "camera": {"shotSize": "中近景", "angle": "平視", "movement": "固定微震", "composition": "太子居中、雙水柱入畫"},
            "performance": {"emotion": "安詳受浴", "gaze": "闔目"},
            "action": "兩道水柱自上方傾瀉、於太子頭頂交會流下，水面泛起漣漪與光暈",
        },
        {
            "title": "鏡4・天人妙音",
            "prompt": "雲端諸天人結跏趺坐、演奏妙音（鼓、笛、箜篌），同時自空中灑下繽紛香花供養",
            "chars": [deva["id"]], "props": [flowers["id"]],
            "camera": {"shotSize": "遠景", "angle": "平視", "movement": "橫向平移", "composition": "群像排列、花瓣前景"},
            "performance": {"emotion": "歡喜恭敬", "gaze": "望向太子"},
            "action": "天人擊鼓奏樂、身姿微擺，香花花瓣自上方紛紛飄墜",
        },
        {
            "title": "鏡5・大地六震",
            "prompt": "十方大地現六種震動，光波自太子所在向四方擴散，山河草木同感震動",
            "chars": [baby["id"]],
            "camera": {"shotSize": "大遠景", "angle": "俯瞰", "movement": "緩緩拉遠", "composition": "以太子為中心的同心光波"},
            "performance": {"emotion": "莊嚴", "gaze": "—"},
            "action": "地面泛起同心圓光波向外擴散、遠山微微震顫、塵光揚起",
        },
        {
            "title": "鏡6・眾生法喜",
            "prompt": "園中眾生仰望天空這一幕，臉上流露前所未有的喜悅，合掌讚歎",
            "chars": [deva["id"]],
            "camera": {"shotSize": "中景", "angle": "微仰", "movement": "緩推", "composition": "仰望群像、天光入畫"},
            "performance": {"emotion": "前所未有的喜悅", "gaze": "仰望天空"},
            "action": "眾生仰頭、合掌、面露微笑，天光灑在臉上",
        },
    ]

    print("\n建立分鏡並綁卡…")
    shot_ids = []
    for s in SHOTS:
        row = call("POST", admin, "scenes.addDraft", {"projectId": pid, "title": s["title"], "prompt": s["prompt"]})
        assert row.get("id"), f"建分鏡失敗：{row}"
        sid = row["id"]
        call("POST", admin, "scenes.setCards", {
            "sceneId": sid,
            "characterIds": s["chars"],
            "scenePresetIds": [scene["id"]],
            "propIds": s.get("props", []),
        })
        call("POST", admin, "scenes.update", {
            "sceneId": sid, "camera": s["camera"], "performance": s["performance"], "action": s["action"],
        })
        shot_ids.append(sid)
        print(f"  ✓ {s['title']}")

    # ── 生成前預覽：印出 AI 實際會收到、鎖好一致性的完整提示詞 ──────────
    print("\n════════ 生成前預覽（AI 會怎麼理解每一鏡）════════")
    for s, sid in zip(SHOTS, shot_ids):
        # 用「多圖參考」的 edit 模型當預設：三視圖才會真的被帶進生成（image_urls）鎖住長相。
        # 純 text-to-image/video 不吃參考圖（參考圖 0/N），只能靠文字錨點弱鎖。
        # 動畫實務兩段式：① nano-banana/seedream edit＋三視圖 → 鎖好的關鍵影格；
        #                ② image-to-video（wan/kling 影生影）→ 讓關鍵影格動起來。
        prev = call("POST", admin, "generation.preview", {
            "projectId": pid,
            "modelId": os.environ.get("E2E_MODEL", "fal-ai/nano-banana-2/edit"),
            "prompt": s["prompt"],
            "characterIds": s["chars"],
            "scenePresetIds": [scene["id"]],
            "propIds": s.get("props", []),
            "continuityMode": True,
        })
        print(f"\n──── {s['title']} ────")
        if "__error__" in prev:
            print("  預覽失敗：", prev["__error__"]); continue
        cont = next((c for c in prev.get("context", []) if c["type"] == "continuity"), {})
        print("  一致性：", cont.get("note", "—"), "｜預估點數：", prev.get("estimatedPoints"))
        for w in prev.get("warnings") or []:
            print(f"  ⚠ {w.get('title')}: {w.get('suggestion') or w.get('detail')}")
        print(prev["request"]["positivePrompt"])

    # 對照：同一鏡用純影片模型預覽，證明三視圖不會被帶進（參考圖 0/N）
    contrast = call("POST", admin, "generation.preview", {
        "projectId": pid,
        "modelId": "fal-ai/wan/v2.2-a14b/text-to-video",
        "prompt": SHOTS[0]["prompt"],
        "characterIds": SHOTS[0]["chars"],
        "scenePresetIds": [scene["id"]],
        "propIds": SHOTS[0].get("props", []),
        "continuityMode": True,
    })
    if "__error__" not in contrast:
        cont = next((c for c in contrast.get("context", []) if c["type"] == "continuity"), {})
        print(f"\n──── 對照・鏡1・純影片模型（應為參考圖 0/N）────")
        print("  一致性：", cont.get("note", "—"))
        for w in contrast.get("warnings") or []:
            if w.get("code") in ("multi_reference_unsupported", "card_images_not_sent"):
                print(f"  ⚠ {w.get('title')}: {w.get('suggestion') or w.get('detail')}")

    print(f"\n專案已建好：{HOST.replace(':3000', ':5173')}  →  動畫組 →「佛傳動畫・九龍浴太子」")
    print("沒有 FAL_KEY 時，站上按生成會回明確錯誤並退點；填入 FAL_KEY 後即可直接出圖/出片。")
    print(f"PROJECT_ID={pid}")


if __name__ == "__main__":
    main()
