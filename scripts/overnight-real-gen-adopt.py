#!/usr/bin/env python3
"""
One cheap real generateInto + Adopt on a disposable overnight-test-* project.

Hard rules:
  - 動畫組 only (never 總會短影音／動畫／卉庭)
  - title prefix overnight-test-
  - default model fal-ai/flux/schnell (1 point, image) — not Veo/video
  - assert preserveScenePointer: assetId stays empty until Adopt
  - no mass jobs (default 1 shot)

  HOST=http://localhost:3000 SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... \\
  python3 scripts/overnight-real-gen-adopt.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from e2e_lib import ok

HOST = (os.environ.get("TARGET_URL") or os.environ.get("HOST") or "http://localhost:3000").rstrip("/")
BASE = f"{HOST}/api/trpc"
MODEL = os.environ.get("E2E_MODEL", "fal-ai/flux/schnell")
EMAIL = os.environ.get("SEED_ADMIN_EMAIL") or os.environ.get("TEST_EMAIL") or ""
PASSWORD = os.environ.get("SEED_ADMIN_PASSWORD") or os.environ.get("TEST_PW") or ""
FORBIDDEN_GROUPS = {"總會短影音", "動畫", "卉庭"}
SHOTS = int(os.environ.get("REAL_GEN_SHOTS", "1"))
WAIT_SEC = int(os.environ.get("REAL_GEN_WAIT", "180"))

if SHOTS > 3:
    sys.exit("REAL_GEN_SHOTS>3 refused — do not mass-burn points")
if not EMAIL or not PASSWORD:
    sys.exit("SEED_ADMIN_EMAIL/TEST_EMAIL and SEED_ADMIN_PASSWORD/TEST_PW are required")


class Client:
    def __init__(self) -> None:
        self.cookie = None

    def open(self, req):
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req, timeout=60)


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


def wait_gen_done(opener, gen_id, timeout=WAIT_SEC):
    st = {}
    for _ in range(timeout):
        st = call("GET", opener, "generation.status", {"id": gen_id})
        if isinstance(st, dict) and st.get("status") in ("done", "failed"):
            return st
        time.sleep(1)
    return st


admin = Client()
login = call("POST", admin, "auth.login", {"email": EMAIL, "password": PASSWORD})
ok("登入", isinstance(login, dict) and "__error__" not in login)
if "__error__" in login:
    sys.exit(login["__error__"])

teams = call("GET", admin, "admin.overview")
anim = None
for team in teams if isinstance(teams, list) else []:
    for group in team.get("groups") or []:
        if group.get("name") == "動畫組":
            anim = group
            break
ok("找到動畫組", bool(anim) and anim.get("name") == "動畫組")
if not anim:
    sys.exit("找不到動畫組")
if anim["name"] in FORBIDDEN_GROUPS:
    sys.exit(f"拒絕寫入正式組「{anim['name']}」")

stamp = datetime.now(timezone.utc).strftime("%m%d-%H%M")
title = os.environ.get("REAL_GEN_TITLE") or f"overnight-test-real-gen-{stamp}"
if not title.startswith("overnight-test-"):
    sys.exit("title must start with overnight-test-")

proj = call("POST", admin, "projects.create", {
    "groupId": anim["id"],
    "title": title,
    "kind": "animation",
    "platform": "youtube",
    "format": "16:9",
})
ok("建立 overnight-test 專案", isinstance(proj, dict) and proj.get("id") and proj.get("title", "").startswith("overnight-test-"))
if "__error__" in proj:
    sys.exit(proj["__error__"])
pid = proj["id"]
print(f"project {pid} {title} group={anim['name']} model={MODEL} shots={SHOTS}")

results = []
for i in range(SHOTS):
    draft = call("POST", admin, "scenes.addDraft", {
        "projectId": pid,
        "title": f"overnight 實生成 {i+1}",
        "prompt": "a quiet temple courtyard at dusk, warm lantern light, cinematic still, no text",
    })
    ok(f"分鏡 {i+1} 建立", isinstance(draft, dict) and draft.get("id"))
    sid = draft["id"]
    gen = call("POST", admin, "scenes.generateInto", {"sceneId": sid, "modelId": MODEL})
    ok(f"generateInto 送出 {i+1}", isinstance(gen, dict) and gen.get("generationId"))
    if "__error__" in gen:
        print("generateInto error:", gen["__error__"])
        continue
    gen_id = gen["generationId"]
    st = wait_gen_done(admin, gen_id)
    ok(f"生成結束 {i+1} status={st.get('status')}", st.get("status") == "done")
    if st.get("status") != "done":
        print("status payload keys:", list(st)[:20], "error=", st.get("error") or st.get("message"))
        continue
    listed = call("GET", admin, "scenes.listByProject", {"projectId": pid})
    shot = next(s for s in listed if s["id"] == sid)
    ok("generateInto done 後 assetId 仍空（preserveScenePointer）", not shot.get("assetId"))
    adopted = call("POST", admin, "creativeContext.adoptGeneration", {"generationId": gen_id})
    ok("Adopt 回填", isinstance(adopted, dict) and adopted.get("adopted") and adopted.get("assetId"))
    listed2 = call("GET", admin, "scenes.listByProject", {"projectId": pid})
    shot2 = next(s for s in listed2 if s["id"] == sid)
    ok("Adopt 後分鏡才有 assetId", shot2.get("assetId") == adopted.get("assetId"))
    results.append({
        "sceneId": sid,
        "generationId": gen_id,
        "assetId": adopted.get("assetId") if isinstance(adopted, dict) else None,
        "status": st.get("status"),
    })

out = {
    "host": HOST,
    "projectId": pid,
    "title": title,
    "group": anim["name"],
    "model": MODEL,
    "results": results,
}
path = os.environ.get("OUT_JSON") or "/opt/cursor/artifacts/overnight_real_gen_adopt.json"
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("wrote", path)
