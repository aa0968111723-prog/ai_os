# -*- coding: utf-8 -*-
# 交付匯出端到端 e2e（剪輯軟體實際可用性）：建專案→假生成圖/影→加入分鏡→下載交付 ZIP，
# 解壓後逐一驗證「時間軸檔（FCPXML/Premiere XML/EDL）引用的每個媒體都真的在包內」（QA-006），
# 剪映草稿包 draft_content.json 合法且結構完整（比照 pyJianYingDraft），
# 並驗證直式(9:16)專案的畫布/序列解析度確實轉成 1080×1920（修 jianying/fcpxml 硬編橫向）。
# 前置：E2E_MOCK=1、:3199、全新 DB。建議 E2E_MOCK_DELAY_MS=800 讓生成快點完成。
import io, json, os, re, time, urllib.request, urllib.parse, urllib.error, zipfile, xml.etree.ElementTree as ET

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
BASE = f"{HOST}/api/trpc"


class Client:
    def __init__(self): self.cookie = None
    def open(self, req):
        if self.cookie: req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req, timeout=60)


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


def raw_get(opener, path):
    req = urllib.request.Request(f"{HOST}{path}")
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with opener.open(req) as r: return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


import e2e_lib

def ok(name, cond, detail=""):  # 本地版：支援 detail（e2e_lib.ok 只吃兩參數）
    e2e_lib.ok(name + (f"  — {detail}" if detail else ""), cond)


admin = Client()
call("POST", admin, "auth.login", {"email": os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local"),
                                   "password": os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123")})
teams = call("GET", admin, "admin.overview")
grp = next(g for t in teams for g in t["groups"] if g["name"] == "剪輯組")


def gen_and_wait(pid, model, prompt):
    g = call("POST", admin, "generation.submit", {"projectId": pid, "modelId": model, "prompt": prompt})
    gid = g["id"]
    for _ in range(60):
        st = call("GET", admin, "generation.status", {"id": gid})
        if isinstance(st, dict) and st.get("status") == "done":
            return gid
        if isinstance(st, dict) and st.get("status") == "failed":
            raise RuntimeError(f"生成失敗 {model}: {st.get('error')}")
        time.sleep(1)
    raise RuntimeError(f"生成逾時 {model}")


def build_project(title, platform, want_video=True):
    proj = call("POST", admin, "projects.create", {"groupId": grp["id"], "title": title, "kind": "witness", "platform": platform})
    pid = proj["id"]
    img_gen = gen_and_wait(pid, "fal-ai/flux/schnell", "開場圖像")
    s1 = call("POST", admin, "scenes.addFromGeneration", {"generationId": img_gen, "title": "開場"})
    call("POST", admin, "scenes.update", {"sceneId": s1["id"], "voiceover": "一碗乳糜，帶來慈悲的轉機。"})
    if want_video:
        vid_gen = gen_and_wait(pid, "fal-ai/kling-video/v2.1/standard/text-to-video", "第二鏡影片")
        s2 = call("POST", admin, "scenes.addFromGeneration", {"generationId": vid_gen, "title": "第二鏡"})
        call("POST", admin, "scenes.update", {"sceneId": s2["id"], "voiceover": "尼連禪河畔，清晨微光。"})
    return pid


def resolve_rel(ref, base_dir="交付/"):
    ref = urllib.parse.unquote(ref)
    parts = (base_dir + ref).split("/")
    stack = []
    for p in parts:
        if p in ("", "."): continue
        if p == "..":
            if stack: stack.pop()
        else:
            stack.append(p)
    return "/".join(stack)


# ══ 16:9 專案：交付 ZIP 媒體參照全對得上 + 剪映草稿合法 ══
pid = build_project("交付匯出測試案-橫式", "youtube", want_video=True)

code, zbytes = raw_get(admin, f"/api/export/{pid}")
ok("交付 ZIP 下載 200", code == 200)
ok("交付 ZIP 為合法 zip", zbytes[:2] == b"PK")
zf = zipfile.ZipFile(io.BytesIO(zbytes))
names = set(zf.namelist())
for f in ["交付/時間軸.fcpxml", "交付/Premiere時間軸.xml", "交付/剪輯表.edl", "交付/字幕.srt", "05_文件/腳本與鏡頭表.md"]:
    ok(f"包內含 {f}", f in names)
media_in_zip = [n for n in names if n.startswith("01_視頻素材/") or n.startswith("03_圖像/")]
ok("媒體檔確實入包（影片/圖像）", len(media_in_zip) >= 2)

fx = zf.read("交付/時間軸.fcpxml").decode("utf-8")
fx_root = ET.fromstring(fx)
srcs = [mr.get("src") for mr in fx_root.iter("media-rep")]
ok("FCPXML 有 media-rep（非純 gap 佔位）", len(srcs) >= 2)
fx_bad = [s for s in srcs if resolve_rel(s) not in names]
ok("FCPXML 每個 media-rep 媒體都在包內", not fx_bad, f"對不上：{fx_bad}" if fx_bad else "")
ok("FCPXML 16:9 序列為橫向 1920×1080", 'width="1920" height="1080"' in fx)

px = zf.read("交付/Premiere時間軸.xml").decode("utf-8")
px_root = ET.fromstring(px)
pathurls = [p.text for p in px_root.iter("pathurl") if p.text]
ok("Premiere XML 有 pathurl", len(pathurls) >= 2)
px_bad = [p for p in pathurls if resolve_rel(p) not in names]
ok("Premiere XML 每個 pathurl 媒體都在包內", not px_bad, f"對不上：{px_bad}" if px_bad else "")

edl = zf.read("交付/剪輯表.edl").decode("utf-8")
srcfiles = re.findall(r"\* SOURCE FILE:\s*(.+)", edl)
ok("EDL 有 SOURCE FILE relink 資訊", len(srcfiles) >= 2)
edl_bad = [s.strip() for s in srcfiles if s.strip() not in names]
ok("EDL 每個 SOURCE FILE 媒體都在包內", not edl_bad, f"對不上：{edl_bad}" if edl_bad else "")

code, jbytes = raw_get(admin, f"/api/export/{pid}/jianying")
ok("剪映草稿包下載 200", code == 200)
ok("剪映草稿包為合法 zip", jbytes[:2] == b"PK")
jz = zipfile.ZipFile(io.BytesIO(jbytes))
dc_name = next((n for n in jz.namelist() if n.endswith("draft_content.json")), None)
ok("含 draft_content.json", dc_name is not None)
dc = json.loads(jz.read(dc_name).decode("utf-8"))
mats = dc.get("materials", {})
ok("draft materials 有 videos", isinstance(mats.get("videos"), list) and len(mats["videos"]) >= 1)
ok("draft 有 tracks", isinstance(dc.get("tracks"), list) and len(dc["tracks"]) >= 1)
speed_ids = {s["id"] for s in mats.get("speeds", []) if isinstance(s, dict) and "id" in s}
seg_refs_ok = True
for tr in dc["tracks"]:
    if tr.get("type") in ("video", "audio"):
        for seg in tr.get("segments", []):
            if not any(r in speed_ids for r in seg.get("extra_material_refs", [])):
                seg_refs_ok = False
ok("每個 video/audio segment 都引用已登記的 speed 素材", seg_refs_ok)
ok("16:9 剪映畫布為橫向 1920×1080", dc["canvas_config"]["width"] == 1920 and dc["canvas_config"]["height"] == 1080)

# ══ 9:16 直式專案：驗證畫布/序列解析度確實轉直式（修 jianying/fcpxml 硬編橫向）══
pid_v = build_project("交付匯出測試案-直式", "shorts", want_video=False)
code, zbv = raw_get(admin, f"/api/export/{pid_v}")
ok("直式專案交付 ZIP 200", code == 200)
zfv = zipfile.ZipFile(io.BytesIO(zbv))
fxv = zfv.read("交付/時間軸.fcpxml").decode("utf-8")
ok("FCPXML 9:16 序列為直式 1080×1920", 'width="1080" height="1920"' in fxv)
ok("FCPXML 9:16 不掛 1080p30 preset 名", 'name="FFVideoFormat1080p30"' not in fxv)
pxv = zfv.read("交付/Premiere時間軸.xml").decode("utf-8")
ok("Premiere XML 9:16 為直式 1080×1920", "<width>1080</width><height>1920</height>" in pxv)

code, jbv = raw_get(admin, f"/api/export/{pid_v}/jianying")
jzv = zipfile.ZipFile(io.BytesIO(jbv))
dcv_name = next((n for n in jzv.namelist() if n.endswith("draft_content.json")), None)
dcv = json.loads(jzv.read(dcv_name).decode("utf-8"))
ok("剪映草稿 9:16 畫布為直式 1080×1920",
   dcv["canvas_config"]["width"] == 1080 and dcv["canvas_config"]["height"] == 1920)

print("—— e2e-export 完成 ——")
