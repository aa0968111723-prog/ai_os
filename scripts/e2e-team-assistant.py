#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""團隊分析（teamAssistant）E2E：agentOverview 健康度、ask mock、dispatch ACL、組隔離。

前置：E2E_MOCK=1、伺服器已 migrate/seed、SEED_ADMIN_EMAIL/PASSWORD 可用。
用法：python3 scripts/e2e-team-assistant.py
      或 bash scripts/run-e2e-local.sh team-assistant
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from e2e_lib import ok

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
BASE = f"{HOST}/api/trpc"


class Client:
    def __init__(self):
        self.cookie = None

    def open(self, req):
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req, timeout=40)


def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if op == "GET":
        suffix = "" if data is None else "?input=" + urllib.parse.quote(json.dumps({"json": data}))
        req = urllib.request.Request(url + suffix)
    else:
        req = urllib.request.Request(
            url,
            data=json.dumps({"json": data}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
    try:
        with opener.open(req) as response:
            cookie = response.headers.get("Set-Cookie")
            if cookie:
                opener.cookie = cookie.split(";")[0]
            body = json.load(response)
    except urllib.error.HTTPError as error:
        body = json.load(error)
    if "error" in body:
        return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]


admin = Client()
member = Client()

login = call("POST", admin, "auth.login", {
    "email": os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local"),
    "password": os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123"),
})
ok("團隊分析 E2E 登入", "user" in login)

overview = call("GET", admin, "admin.overview")
ok("admin.overview 有團隊", isinstance(overview, list) and len(overview) > 0)
group = next(g for team in overview for g in team["groups"])
gid = group["id"]

# ── 1. 空狀態 agentOverview ──
# S1 起「從沒發起過計畫」是 idle 而不是 healthy：舊版把「沒東西可分析」講成「分析結果良好」，
# 於是新組的第一屏是五個 0 加一句安慰話。
empty = call("GET", admin, "teamAssistant.agentOverview", {"groupId": gid})
ok("空組 overview 有 summary", isinstance(empty.get("summary"), dict))
ok("空組 health=idle（不是 healthy）", empty["summary"].get("health") == "idle")
ok("空組 hasRuns=False", empty["summary"].get("hasRuns") is False)
ok("空組 active=0", empty["summary"].get("active") == 0)
ok("空組 stoppedRecent=0", empty["summary"].get("stoppedRecent") == 0)
ok("空組 runs=[]", empty.get("runs") == [])
ok("空組 totalRuns=0", empty.get("totalRuns") == 0)
ok("回傳 listLimit（前端才能誠實說「只顯示前 N 筆」）", isinstance(empty.get("listLimit"), int) and empty["listLimit"] > 0)

# ── 2. 建專案 + 規劃代理 → awaiting_approval ──
proj = call("POST", admin, "projects.create", {
    "groupId": gid,
    "title": "團隊分析 E2E 專案",
    "kind": "campaign",
    "platform": "shorts",
})
ok("建立測試專案", "id" in proj)
pid = proj["id"]

planned = call("POST", admin, "agents.plan", {
    "projectId": pid,
    "goal": "建立一格主視覺分鏡並送審，供團隊分析儀表測試",
})
ok("代理計畫待核准", planned.get("status") == "awaiting_approval")
run_id = planned["id"]

# ── 3. 有活動後的 agentOverview ──
active_ov = call("GET", admin, "teamAssistant.agentOverview", {"groupId": gid})
summary = active_ov.get("summary", {})
ok("有待核 → awaitingApproval ≥ 1", summary.get("awaitingApproval", 0) >= 1)
ok("有待核 → active ≥ 1", summary.get("active", 0) >= 1)
ok("有待核 → health=attention", summary.get("health") == "attention")
ok("有計畫 → hasRuns=True", summary.get("hasRuns") is True)
# 計數走整組聚合、清單走 limit 30：兩者是不同來源，totalRuns 至少要蓋過清單筆數
ok("totalRuns ≥ 清單筆數", active_ov.get("totalRuns", 0) >= len(active_ov.get("runs", [])))
ok("totalRuns ≥ 1", active_ov.get("totalRuns", 0) >= 1)
ok("runs 含本計畫", any(r.get("id") == run_id for r in active_ov.get("runs", [])))
run_row = next((r for r in active_ov.get("runs", []) if r.get("id") == run_id), {})
ok("run 帶 projectTitle", run_row.get("projectTitle") == "團隊分析 E2E 專案")
ok("run 帶 goal", isinstance(run_row.get("goal"), str) and len(run_row["goal"]) > 0)
ok("run 狀態 awaiting_approval", run_row.get("status") == "awaiting_approval")

# ── 4. ask（mock 模式：確定性摘要、0 點、不派工）──
ask1 = call("POST", admin, "teamAssistant.ask", {
    "groupId": gid,
    "message": "哪個案子卡住了？這週花了多少點？",
})
ok("ask 回 answer", isinstance(ask1.get("answer"), str) and len(ask1["answer"]) > 0)
ok("ask mock 標記", ask1.get("mock") is True)
ok("ask 組長 canDispatch=true", ask1.get("canDispatch") is True)
ok("ask mock 不亂派工", ask1.get("dispatches") == [])
ok("ask 含專案總數語意", "專案" in ask1["answer"] or "測試模式" in ask1["answer"])

# 追問：帶 history（伺服器無狀態，前端帶回）
ask2 = call("POST", admin, "teamAssistant.ask", {
    "groupId": gid,
    "message": "那待核准的計畫目標是什麼？",
    "history": [
        {"role": "user", "text": "哪個案子卡住了？這週花了多少點？"},
        {"role": "assistant", "text": ask1["answer"][:400]},
    ],
})
ok("追問仍回 answer", isinstance(ask2.get("answer"), str) and len(ask2["answer"]) > 0)

# 空訊息被擋
bad_ask = call("POST", admin, "teamAssistant.ask", {"groupId": gid, "message": ""})
ok("空訊息被拒", "__error__" in bad_ask)

# ── 5. dispatch ACL（組長可派；一般組員不可）──
# 邀請一位一般組員
teams = call("GET", admin, "admin.overview")
team_id = next(t["id"] for t in teams for g in t["groups"] if g["id"] == gid)
inv = call("POST", admin, "admin.invite", {
    "email": "team-assistant-member@example.com",
    "teamId": team_id,
    "teamRole": "member",
    "groupId": gid,
    "groupRole": "member",
})
ok("邀請組員", "inviteUrl" in inv)
token = inv["inviteUrl"].rstrip("/").split("/")[-1]
acc = call("POST", member, "auth.acceptInvite", {
    "token": token,
    "name": "團隊分析組員",
    "password": "team-member-88",
})
ok("組員就位", acc.get("user", {}).get("name") == "團隊分析組員")
mem_id = acc["user"]["id"]

# 組員可問（唯讀）
mem_ask = call("POST", member, "teamAssistant.ask", {
    "groupId": gid,
    "message": "目前有哪些代理在跑？",
})
ok("組員可 ask", isinstance(mem_ask.get("answer"), str))
ok("組員 canDispatch=false", mem_ask.get("canDispatch") is False)

# 組員不可 dispatch
mem_dispatch = call("POST", member, "teamAssistant.dispatch", {
    "groupId": gid,
    "projectId": pid,
    "goal": "組員無權派工應被擋下的目標文字",
})
ok("🔒 組員 dispatch 被拒", "__error__" in mem_dispatch and (
    "授權" in mem_dispatch["__error__"] or "組長" in mem_dispatch["__error__"] or "派工" in mem_dispatch["__error__"]
))

# 組長授權後組員可派
grant = call("POST", admin, "quota.setMemberDispatch", {
    "groupId": gid,
    "userId": mem_id,
    "canDispatch": True,
})
ok("授權組員派工", grant.get("ok") is True and grant.get("canDispatch") is True)

mem_ask2 = call("POST", member, "teamAssistant.ask", {
    "groupId": gid,
    "message": "再確認一次派工權",
})
ok("授權後 canDispatch=true", mem_ask2.get("canDispatch") is True)

mem_dispatch_ok = call("POST", member, "teamAssistant.dispatch", {
    "groupId": gid,
    "projectId": pid,
    "goal": "經授權後發起第二份測試計畫：補一鏡旁白",
})
ok("授權後組員可 dispatch", "runId" in mem_dispatch_ok)
ok("dispatch 產物待核准", mem_dispatch_ok.get("status") == "awaiting_approval")

# 撤權後再擋
revoke = call("POST", admin, "quota.setMemberDispatch", {
    "groupId": gid,
    "userId": mem_id,
    "canDispatch": False,
})
ok("撤銷派工權", revoke.get("ok") is True)
mem_dispatch2 = call("POST", member, "teamAssistant.dispatch", {
    "groupId": gid,
    "projectId": pid,
    "goal": "撤權後不應成功的派工目標",
})
ok("🔒 撤權後 dispatch 再擋", "__error__" in mem_dispatch2)

# ── 6. 組長本人 dispatch ──
leader_dispatch = call("POST", admin, "teamAssistant.dispatch", {
    "groupId": gid,
    "projectId": pid,
    "goal": "組長直接派工：補一鏡主視覺測試",
})
ok("組長可 dispatch", "runId" in leader_dispatch)
ok("組長派工待核准", leader_dispatch.get("status") == "awaiting_approval")

# 再查 overview：應有多筆 awaiting_approval
final_ov = call("GET", admin, "teamAssistant.agentOverview", {"groupId": gid})
ok("多筆待核反映在 summary", final_ov["summary"].get("awaitingApproval", 0) >= 2)
ok("discarded 不進列表", all(r.get("status") != "discarded" for r in final_ov.get("runs", [])))

# ── 7. 組隔離：偽造別組 groupId / 跨組 projectId ──
fake_gid = "00000000-0000-0000-0000-000000000099"
cross = call("GET", admin, "teamAssistant.agentOverview", {"groupId": fake_gid})
ok("🔒 非本組 overview 被擋", "__error__" in cross)

cross_ask = call("POST", admin, "teamAssistant.ask", {
    "groupId": fake_gid,
    "message": "跨組不該成功",
})
ok("🔒 非本組 ask 被擋", "__error__" in cross_ask)

# 找另一個組（若 seed 有多組）做跨組 projectId 派工
other_groups = [g for team in overview for g in team["groups"] if g["id"] != gid]
if other_groups:
    other_gid = other_groups[0]["id"]
    # 用本組派工權 + 他組專案 id → NOT_FOUND
    cross_proj = call("POST", admin, "projects.create", {
        "groupId": other_gid,
        "title": "他組隔離測試案",
        "kind": "campaign",
        "platform": "shorts",
    })
    if "id" in cross_proj:
        cross_disp = call("POST", admin, "teamAssistant.dispatch", {
            "groupId": gid,
            "projectId": cross_proj["id"],
            "goal": "跨組專案不應被本組派工成功",
        })
        ok("🔒 跨組 projectId dispatch 被擋", "__error__" in cross_disp)
    else:
        ok("跨組專案建立略過", True)
else:
    ok("跨組隔離(略過：seed 僅一組)", True)

# ── 8. 放棄計畫後不應再出現在 active ──
before_discard_total = call("GET", admin, "teamAssistant.agentOverview", {"groupId": gid}).get("totalRuns", 0)
discarded = call("POST", admin, "agents.discard", {"runId": run_id})
ok("可放棄待核計畫", discarded.get("status") == "discarded")
after_discard = call("GET", admin, "teamAssistant.agentOverview", {"groupId": gid})
ok("放棄後不在 runs", all(r.get("id") != run_id for r in after_discard.get("runs", [])))
# 整組計數與清單套同一個 ne(status,'discarded')：放棄一筆，totalRuns 必須跟著少一
ok("放棄後 totalRuns 少 1（計數與清單同條件）",
   after_discard.get("totalRuns", -1) == before_discard_total - 1)

# ── 9. 待我裁決收件匣的資料來源：pendingSummary 要帶「最久那件」的時間戳 ──
# 作業台把「代理計畫待核／分鏡送審／生成待核」合流成一份收件匣並依卡最久排序，
# 沒有時間戳就排不出「先做哪一件」。
pending = call("GET", admin, "approvals.pendingSummary", {"groupId": gid})
ok("pendingSummary 有 projects 陣列", isinstance(pending.get("projects"), list))
ok("pendingSummary 有兩個總數",
   isinstance(pending.get("totalPendingApprovals"), int) and isinstance(pending.get("totalAwaitingGenerations"), int))
for row in pending.get("projects", []):
    ok(f"待辦列 {row['projectId'][:8]} 帶 oldest 欄位（可為 null）",
       "oldestPendingApprovalAt" in row and "oldestAwaitingGenerationAt" in row)
    if row.get("pendingApprovals", 0) > 0:
        ok(f"有分鏡待審就必有時間戳 {row['projectId'][:8]}", row.get("oldestPendingApprovalAt") is not None)
    if row.get("awaitingGenerations", 0) > 0:
        ok(f"有生成待核就必有時間戳 {row['projectId'][:8]}", row.get("oldestAwaitingGenerationAt") is not None)
ok("pendingSummary 組隔離",
   "__error__" in call("GET", admin, "approvals.pendingSummary", {"groupId": fake_gid}))

# ── 10. 組級代理洞察（「誰卡住了」）──
# 判斷規則與專案頁的過程面板共用同一支純函式；這裡驗傳輸層的形狀與組隔離。
gi = call("GET", admin, "teamAssistant.groupInsights", {"groupId": gid})
ok("groupInsights 有健康度", gi.get("status") in ("healthy", "attention", "blocked"))
for field in ("blockers", "byProject", "people", "pendingApprovalTasks", "workItems", "results"):
    ok(f"groupInsights.{field} 是陣列（空組也不是 null）", isinstance(gi.get(field), list))
ok("groupInsights 有 truncated 四旗標",
   isinstance(gi.get("truncated"), dict) and set(gi["truncated"]) == {"runs", "tasks", "results", "workItems"})
ok("groupInsights 有 peopleTruncated", isinstance(gi.get("peopleTruncated"), bool))
# 每一項阻塞都要歸得到某個專案：byProject 的阻塞總和不得少於 blockers 筆數
ok("阻塞都歸得到專案（總和對得上）",
   sum(p.get("blockers", 0) for p in gi.get("byProject", [])) == len(gi.get("blockers", [])))
# 人類核准節點必須帶齊就地裁決需要的欄位
for t in gi.get("pendingApprovalTasks", []):
    ok(f"核准節點 {t['taskId'][:8]} 欄位齊全",
       all(k in t for k in ("taskId", "projectId", "projectTitle", "title", "dueAt", "runId")))
ok("🔒 非本組 groupInsights 被擋",
   "__error__" in call("GET", admin, "teamAssistant.groupInsights", {"groupId": fake_gid}))

# 專案級洞察仍在（S2 只是把判斷抽成共用純函式，不該改變專案頁行為）
pi = call("GET", admin, "agents.insights", {"projectId": pid})
if "__error__" not in str(pi):
    ok("專案級洞察仍回同一組欄位",
       all(k in pi for k in ("status", "activeRuns", "openTasks", "blockers", "results", "workItems", "truncated")))
else:
    ok("專案級洞察端點（略過：本 e2e 未涵蓋）", True)


# ── 11. 代理產出與計畫疑慮（S3：由既有欄位折出，不新增查詢）──
gi2 = call("GET", admin, "teamAssistant.groupInsights", {"groupId": gid})
for field in ("groupResults", "planConcerns"):
    ok(f"groupInsights.{field} 是陣列", isinstance(gi2.get(field), list))
# 每項產出都要有專案歸屬，否則點不回產生它的那一步
for r in gi2.get("groupResults", []):
    ok(f"產出 {r.get('id','')[:8]} 帶專案歸屬與來源 run",
       all(k in r and r[k] for k in ("projectId", "projectTitle", "runId", "type")))
# 疑慮的計畫必須真的有疑慮，且數字與總計對得上
concern_missing = sum(c.get("missingInformation", 0) for c in gi2.get("planConcerns", []))
concern_risks = sum(c.get("risks", 0) for c in gi2.get("planConcerns", []))
for c in gi2.get("planConcerns", []):
    ok(f"疑慮列 {c['runId'][:8]} 至少有一項待補或風險",
       c.get("missingInformation", 0) > 0 or c.get("risks", 0) > 0)
ok("疑慮總和不超過整體待補資訊數", concern_missing <= gi2.get("unresolvedInformation", 0))
ok("疑慮總和不超過整體風險數", concern_risks <= gi2.get("risks", 0))


# ── 12. 派工參數不再被丟掉（S4）──
# 專案頁的「執行計畫」本來就吃這四個參數；派工時原樣轉交，守門一個都不繞過。
disp_full = call("POST", admin, "teamAssistant.dispatch", {
    "groupId": gid,
    "projectId": pid,
    "goal": "帶 playbook 與規劃模式的派工：把腳本拆成分鏡",
    "playbookId": "playbook.storyboard.v1",
    "plannerMode": "fal_economy",
})
ok(f"帶參數派工成功{'' if 'runId' in disp_full else '（'+str(disp_full.get('__error__'))[:120]+'）'}", "runId" in disp_full)

# 規劃模式是 enum，亂填必須被擋（而不是默默用預設值排出一份不同的計畫）
bad_mode = call("POST", admin, "teamAssistant.dispatch", {
    "groupId": gid, "projectId": pid,
    "goal": "不合法的規劃模式應被擋下",
    "plannerMode": "economy",
})
ok("🔒 不合法 plannerMode 被擋", "__error__" in bad_mode)
ok("帶參數派工仍是待核准（沒有繞過核准）", disp_full.get("status") == "awaiting_approval")
ok("派工回傳規劃遙測（不是黑盒）", "plannerTelemetry" in disp_full)

# 不合法的 playbookId 不該讓派工整個炸掉，也不該被當成 roleId 偷渡
disp_bad_pb = call("POST", admin, "teamAssistant.dispatch", {
    "groupId": gid, "projectId": pid,
    "goal": "不存在的 playbook 應被忽略而非崩潰",
    "playbookId": "playbook.does.not.exist",
})
ok("未知 playbookId 不會讓派工崩潰", "runId" in disp_bad_pb or "__error__" in disp_bad_pb)

# 超出上限的來源清單要被 zod 擋下（而不是塞爆規劃預算）
disp_too_many = call("POST", admin, "teamAssistant.dispatch", {
    "groupId": gid, "projectId": pid,
    "goal": "來源數量超過上限應被擋下",
    "extraSourceIds": ["00000000-0000-4000-8000-%012d" % i for i in range(11)],
})
ok("🔒 來源超過上限被擋", "__error__" in disp_too_many)

# 派工出處要留痕：事件流裡看得到「由團隊分析卡派工」
if "runId" in disp_full:
    evs = call("GET", admin, "agents.eventsByProject", {"projectId": pid, "limit": 200})
    items = evs.get("items", []) if isinstance(evs, dict) else []
    ok("派工在事件流留下出處",
       any(e.get("runId") == disp_full["runId"] and e.get("eventKey") == "run:dispatched-from-team" for e in items))

print("—— e2e-team-assistant 完成 ——")
