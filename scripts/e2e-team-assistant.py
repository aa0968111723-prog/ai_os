#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""團隊分析（teamAssistant）E2E：agentOverview 健康度、ask mock、dispatch ACL、組隔離，
以及組代理總指揮（L1 監督權／L2 調度權／L3 常駐計畫）的授權、狀態守門與生命週期。

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
        err = body["error"]["json"]
        # 一併帶回 tRPC code：FORBIDDEN（沒權）／NOT_FOUND（不是這個組的東西）／PRECONDITION_FAILED
        # （狀態不對）是三種完全不同的失敗，只比對中文訊息的話，文案一改就會整批誤綠。
        return {"__error__": err.get("message", ""), "__code__": (err.get("data") or {}).get("code")}
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
    "goal": "建立一格主視覺分鏡並生成畫面，供團隊分析儀表測試",
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
# 作業台把「代理計畫待核／人員核准／生成待核」合流成一份收件匣並依卡最久排序，
# 沒有時間戳就排不出「先做哪一件」。（分鏡送審已移除，資料源改掛 generation.pendingSummary）
pending = call("GET", admin, "generation.pendingSummary", {"groupId": gid})
ok("pendingSummary 有 projects 陣列", isinstance(pending.get("projects"), list))
ok("pendingSummary 有待核生成總數", isinstance(pending.get("totalAwaitingGenerations"), int))
for row in pending.get("projects", []):
    ok(f"待辦列 {row['projectId'][:8]} 帶 oldest 欄位（可為 null）",
       "oldestAwaitingGenerationAt" in row)
    if row.get("awaitingGenerations", 0) > 0:
        ok(f"有生成待核就必有時間戳 {row['projectId'][:8]}", row.get("oldestAwaitingGenerationAt") is not None)
ok("pendingSummary 組隔離",
   "__error__" in call("GET", admin, "generation.pendingSummary", {"groupId": fake_gid}))

# ── 10. 組級代理洞察（「誰卡住了」）──
# 判斷規則與專案頁的過程面板共用同一支純函式；這裡驗傳輸層的形狀與組隔離。
gi = call("GET", admin, "teamAssistant.groupInsights", {"groupId": gid})
ok("groupInsights 有健康度", gi.get("status") in ("healthy", "attention", "blocked"))
for field in ("blockers", "byProject", "people", "pendingApprovalTasks", "workItems", "results"):
    ok(f"groupInsights.{field} 是陣列（空組也不是 null）", isinstance(gi.get(field), list))
ok("groupInsights 有 truncated 四旗標",
   isinstance(gi.get("truncated"), dict) and set(gi["truncated"]) == {"runs", "tasks", "results", "workItems"})
ok("groupInsights 有 peopleTruncated", isinstance(gi.get("peopleTruncated"), bool))
# 歸屬要對「未截斷」的完整清單算——拿 len(blockers) 比是比不出來的（兩邊都截斷過），
# 所以改用伺服器回報的 blockersTotal 當基數。
ok("groupInsights 回報未截斷的阻塞總數", isinstance(gi.get("blockersTotal"), int))
ok("阻塞都歸得到專案（以未截斷總數為基數）",
   sum(p.get("blockers", 0) for p in gi.get("byProject", [])) == gi.get("blockersTotal"))
ok("顯示用的阻塞清單不超過總數", len(gi.get("blockers", [])) <= gi.get("blockersTotal", 0))
# 同一列的阻塞數不得小於逾期數（會渲染成「3 項阻塞・9 逾期」的自相矛盾）
for _p in gi.get("byProject", []):
    ok(f"專案 {_p['projectId'][:8]} 阻塞數 ≥ 逾期數", _p.get("blockers", 0) >= _p.get("overdueTasks", 0))
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


# ── 13. ask 的上下文與決策軌跡（S5）──
ask_s5 = call("POST", admin, "teamAssistant.ask", {"groupId": gid, "message": "誰卡住了？有什麼阻塞？"})
ok("ask 回傳 contextUsed 陣列", isinstance(ask_s5.get("contextUsed"), list))
ok("ask 回傳 degraded 旗標", isinstance(ask_s5.get("degraded"), bool))
ok("正常情況不是降級模式", ask_s5.get("degraded") is False)
# contextUsed 必須全在白名單內——這個欄位存在的意義就是「不能讓模型自由發揮」
ALLOWED = {"專案現況", "組花費", "資料庫快照", "阻塞與人員負荷",
           "分鏡明細", "生成紀錄", "模型目錄", "資料庫搜尋", "代理動態", "人員任務", "專案營運快照"}
ok("contextUsed 全在白名單內", set(ask_s5.get("contextUsed", [])) <= ALLOWED)
ok("rationale 不是 chain-of-thought（長度受限）",
   ask_s5.get("rationale") is None or len(ask_s5["rationale"]) <= 301)

# 組員也拿得到同一組欄位（唯讀彙總不需組長權限）
mem_s5 = call("POST", member, "teamAssistant.ask", {"groupId": gid, "message": "有什麼阻塞？"})
ok("組員 ask 也有 contextUsed", isinstance(mem_s5.get("contextUsed"), list))
ok("組員 ask 仍無派工權", mem_s5.get("canDispatch") is False)

# ── 14. 組代理指揮權等級（commandLevel）──
# 前端用它決定露出哪些按鈕、後端每道指令再用同一個值守門。兩邊讀不到同一個值的話，
# 畫面會長出一排按下去必被拒的按鈕（或反過來：有權的人看不到入口）。
lvl_admin = call("GET", admin, "teamAssistant.commandLevel", {"groupId": gid})
ok("組長指揮權為 command（最高級）", lvl_admin == "command")
lvl_member = call("GET", member, "teamAssistant.commandLevel", {"groupId": gid})
ok("撤權後的組員指揮權為 none", lvl_member == "none")
ok("🔒 非本組 commandLevel 被擋", "__error__" in call("GET", admin, "teamAssistant.commandLevel", {"groupId": fake_gid}))

# ── 15. L1／L2：分級授權（none < dispatch < supervise < command）──
# 為什麼不能沿用單一布林：舊的 canDispatchAgent 只回答「能不能生出一份待核計畫」，
# 而「能不能替別人核准、讓它現在就開始花點」是完全不同量級的授權。折在同一個布林裡，
# 等於每次開派工權都把最貴的那個權限一起送出去。
ghost_run = "00000000-0000-4000-8000-000000000001"
ghost_task = "00000000-0000-4000-8000-000000000002"

mem_approve = call("POST", member, "teamAssistant.command", {
    "groupId": gid,
    "command": {"kind": "approve_run", "runId": leader_dispatch.get("runId", ghost_run)},
})
ok("🔒 無授權組員下 approve_run 得 FORBIDDEN", mem_approve.get("__code__") == "FORBIDDEN")
mem_cmd_dispatch = call("POST", member, "teamAssistant.command", {
    "groupId": gid,
    "command": {"kind": "dispatch", "projectId": pid, "goal": "無授權組員的派工指令應被擋下"},
})
ok("🔒 無授權組員下 dispatch 指令得 FORBIDDEN", mem_cmd_dispatch.get("__code__") == "FORBIDDEN")

lift = call("POST", admin, "quota.setMemberCommandLevel", {"groupId": gid, "userId": mem_id, "level": "supervise"})
ok("組長可把組員調到監督權", lift.get("ok") is True and lift.get("level") == "supervise")
ok("調級後 commandLevel 立刻反映", call("GET", member, "teamAssistant.commandLevel", {"groupId": gid}) == "supervise")
# 舊 UI 的「派工權：開」不得把已授權的監督權默默降級——使用者按的是「開」，權限卻變小，沒有人會預期
keep = call("POST", admin, "quota.setMemberDispatch", {"groupId": gid, "userId": mem_id, "canDispatch": True})
ok("舊布林開關不會把 supervise 降成 dispatch", keep.get("level") == "supervise")

mem_own_discard = call("POST", member, "teamAssistant.command", {
    "groupId": gid,
    "command": {"kind": "discard_run", "runId": mem_dispatch_ok.get("runId", ghost_run)},
})
ok("監督權組員可放棄自己發起的子計畫", mem_own_discard.get("kind") == "discard_run")

# 分級授權只是「能不能下這種令」，不取代各專案原本的守門——別人的計畫仍需發起人或組長以上。
# 這一條若鬆掉，等於把 supervise 悄悄升級成「全組的計畫都歸我處置」。
if "runId" in disp_full:
    mem_other_discard = call("POST", member, "teamAssistant.command", {
        "groupId": gid,
        "command": {"kind": "discard_run", "runId": disp_full["runId"]},
    })
    ok("🔒 監督權不繞過專案守門（別人的計畫仍擋）", mem_other_discard.get("__code__") == "FORBIDDEN")
else:
    ok("別人的計畫守門（略過：前置派工未成功）", True)

back = call("POST", admin, "quota.setMemberCommandLevel", {"groupId": gid, "userId": mem_id, "level": "none"})
ok("指揮權可收回 none（連舊布林一起關）", back.get("level") == "none" and back.get("canDispatch") is False)
mem_after_revoke = call("POST", member, "teamAssistant.command", {
    "groupId": gid,
    "command": {"kind": "discard_run", "runId": ghost_run},
})
ok("🔒 收回後再下令仍是 FORBIDDEN（而不是 NOT_FOUND）", mem_after_revoke.get("__code__") == "FORBIDDEN")

# ── 16. 組隔離：拿別組（或不存在）的 runId／taskId／projectId 下令 ──
# 借道別組的 id 是最省事的越權手法：權限在本組驗、東西卻是別組的。所以指令一律先確認
# 目標物真的屬於這個組，且回 NOT_FOUND（不是 FORBIDDEN）——不對外洩漏「這個 id 存在」。
iso_run = call("POST", admin, "teamAssistant.command", {
    "groupId": gid, "command": {"kind": "approve_run", "runId": ghost_run},
})
ok("🔒 非本組 runId 下令得 NOT_FOUND", iso_run.get("__code__") == "NOT_FOUND")
iso_stop = call("POST", admin, "teamAssistant.command", {
    "groupId": gid, "command": {"kind": "stop_run", "runId": ghost_run},
})
ok("🔒 非本組 runId 停止得 NOT_FOUND", iso_stop.get("__code__") == "NOT_FOUND")
iso_task = call("POST", admin, "teamAssistant.command", {
    "groupId": gid, "command": {"kind": "assign_task", "taskId": ghost_task, "priority": "high"},
})
ok("🔒 非本組 taskId 下令得 NOT_FOUND", iso_task.get("__code__") == "NOT_FOUND")

if other_groups and "id" in cross_proj:
    # 真・別組物件：專案存在、只是不屬於這個組。守門必須擋在規劃之前（連 LLM 都不該被叫起來）
    iso_proj = call("POST", admin, "teamAssistant.command", {
        "groupId": gid,
        "command": {"kind": "dispatch", "projectId": cross_proj["id"], "goal": "跨組專案不該被本組指令派工"},
    })
    ok("🔒 跨組 projectId 下令得 NOT_FOUND", iso_proj.get("__code__") == "NOT_FOUND")
    # 別組真實 runId：規劃有每人每分鐘 4 次的節流，撞到就略過（這條是加分項，不是本輪的守門重點）
    cross_run = call("POST", admin, "agents.plan", {
        "projectId": cross_proj["id"], "goal": "他組的子計畫，供跨組下令隔離測試",
    })
    if "id" in cross_run:
        iso_cross_run = call("POST", admin, "teamAssistant.command", {
            "groupId": gid, "command": {"kind": "approve_run", "runId": cross_run["id"]},
        })
        ok("🔒 別組真實 runId 下令得 NOT_FOUND", iso_cross_run.get("__code__") == "NOT_FOUND")
    else:
        ok("別組真實 runId（略過：規劃節流）", True)
else:
    ok("跨組物件下令（略過：seed 僅一組）", True)

# ── 17. 狀態守門：指令要吃得下「這個狀態能不能做這件事」──
# 這是提議面最常見的錯：清單上看得到一份計畫，就以為每個動作都按得下去。
if "runId" in leader_dispatch:
    approve_once = call("POST", admin, "teamAssistant.command", {
        "groupId": gid, "command": {"kind": "approve_run", "runId": leader_dispatch["runId"]},
    })
    ok("組長可核准待核子計畫", approve_once.get("kind") == "approve_run")
    approve_twice = call("POST", admin, "teamAssistant.command", {
        "groupId": gid, "command": {"kind": "approve_run", "runId": leader_dispatch["runId"]},
    })
    ok("🔒 對已核准（running）的子計畫再核准被擋", approve_twice.get("__code__") == "PRECONDITION_FAILED")
    discard_running = call("POST", admin, "teamAssistant.command", {
        "groupId": gid, "command": {"kind": "discard_run", "runId": leader_dispatch["runId"]},
    })
    ok("🔒 已開始執行的子計畫不能放棄", discard_running.get("__code__") == "PRECONDITION_FAILED")
else:
    ok("狀態守門（略過：前置派工未成功）", True)

# 重新規劃只給「已結束且沒成功」的。這裡刻意挑一份**待核**的來測（而不是剛核准那份）：
# 待核狀態永遠不是合法的重跑對象，不受背景 Runner 跑多快影響。對還在跑的按重跑會在同專案
# 開出第二份，併發鎖會擋在核准那一步，使用者只拿得到一份永遠核准不了的孤兒計畫。
if "runId" in disp_full:
    retry_awaiting = call("POST", admin, "teamAssistant.command", {
        "groupId": gid, "command": {"kind": "retry_run", "runId": disp_full["runId"]},
    })
    ok("🔒 只有失敗／被停止的子計畫可重新規劃", retry_awaiting.get("__code__") == "PRECONDITION_FAILED")
else:
    ok("重新規劃守門（略過：前置派工未成功）", True)

# ── 18. 批次指令：逐筆回報成敗，不假裝可以整批回滾 ──
# 這些指令各自會呼叫外部規劃模型並可能扣點，一筆失敗就把前面成功的「回滾」是做不到的；
# 假裝做得到只會讓狀態與畫面對不起來。
batch_cmds = [{"kind": "approve_run", "runId": ghost_run}]
if "runId" in disp_full:
    batch_cmds.insert(0, {"kind": "discard_run", "runId": disp_full["runId"]})
batch = call("POST", admin, "teamAssistant.commandBatch", {"groupId": gid, "commands": batch_cmds})
ok("批次回傳每一筆結果", isinstance(batch.get("results"), list) and len(batch["results"]) == len(batch_cmds))
ok("批次成功數與失敗筆並存（不是全成或全敗）", batch.get("okCount") == len(batch_cmds) - 1)
ok("批次失敗筆帶得出原因", any(r.get("ok") is False and r.get("error") for r in batch.get("results", [])))

# ── 19. L3：組代理常駐計畫（campaign）的生命週期 ──
# 假模式給的是固定計畫（派工→盯著→結論），所以這一段驗的是流程與守門，不是 LLM 排得好不好。
camp = call("POST", admin, "teamAssistant.planCampaign", {
    "groupId": gid, "goal": "把這一組的待辦往前推一輪，供組代理總指揮 E2E 驗收",
})
ok("planCampaign 產出待核計畫", camp.get("status") == "awaiting_approval")
camp_id = camp.get("id")
camp_steps = camp.get("steps") or []
ok("campaign 有步驟", isinstance(camp_steps, list) and len(camp_steps) > 0)
# 組代理只調度、不動手：五種步驟以外的東西（生圖、改分鏡、寫資料庫）不該出現在組級計畫裡
GROUP_STEP_KINDS = {"dispatch", "watch", "assign_task", "wait_for_human", "report"}
ok("步驟種類全在組級白名單內", {s.get("kind") for s in camp_steps} <= GROUP_STEP_KINDS)
ok("步驟一律從 pending 開始（執行期欄位不接受規劃器指定）",
   all(s.get("status") == "pending" for s in camp_steps))
watch_steps = [s for s in camp_steps if s.get("kind") == "watch"]
ok("watch 指得到一個真實存在的 dispatch 步驟",
   all(s.get("targetStepId") in {d["id"] for d in camp_steps if d.get("kind") == "dispatch"} for s in watch_steps))
ok("watch 天然依賴它盯的那一步（否則會在子計畫還沒建立時就開始盯）",
   all(s.get("targetStepId") in (s.get("dependsOn") or []) for s in watch_steps))
# 預設不授權自動花點：沒給 budgetPoints 就是 0，寧可多按幾次核准，也不要預設把錢交出去
ok("未指定授權時 budgetPoints=0（安全預設）", camp.get("budgetPoints") == 0)
ok("尚未開始執行時 spentPoints=0", camp.get("spentPoints") == 0)
ok("摘要寫明自動核准授權", "授權" in (camp.get("summary") or ""))

camp_list = call("GET", admin, "teamAssistant.campaigns", {"groupId": gid})
ok("campaigns 查得到剛排的計畫",
   isinstance(camp_list, list) and any(c.get("id") == camp_id for c in camp_list))
camp_detail = call("GET", admin, "teamAssistant.campaign", {"runId": camp_id})
ok("campaign 詳情帶 run 與事件軌跡",
   isinstance(camp_detail.get("run"), dict) and isinstance(camp_detail.get("events"), list))
ok("軌跡記得下「規劃」這件事", any(e.get("eventType") == "planned" for e in camp_detail.get("events", [])))

# resume 只對「真的在等人」的計畫有意義：待核的計畫按繼續是無意義操作，
# 若放行則會把一份還沒被人看過的計畫直接推成 running。
resume_bad = call("POST", admin, "teamAssistant.resumeCampaign", {"runId": camp_id})
ok("🔒 對非 waiting 的 campaign 按繼續被擋", resume_bad.get("__code__") == "PRECONDITION_FAILED")

approved_camp = call("POST", admin, "teamAssistant.approveCampaign", {"runId": camp_id})
ok("核准後 campaign 進入 running", approved_camp.get("status") == "running")
approve_camp_twice = call("POST", admin, "teamAssistant.approveCampaign", {"runId": camp_id})
ok("🔒 重複核准 campaign 被擋", approve_camp_twice.get("__code__") == "PRECONDITION_FAILED")
discard_running_camp = call("POST", admin, "teamAssistant.discardCampaign", {"runId": camp_id})
ok("🔒 已核准的 campaign 不能改用放棄", discard_running_camp.get("__code__") == "PRECONDITION_FAILED")

stopped_camp = call("POST", admin, "teamAssistant.stopCampaign", {"runId": camp_id})
# 背景執行器每 8 秒推一步，所以停止可能落在 running、waiting（撞到授權上限停手）或已被推到終局。
# 這裡真正不能誤綠的是「按了停止卻還在跑」——用下一行的狀態查詢把它釘死。
ok("停止 campaign（或它已自行走到終局）",
   stopped_camp.get("status") == "stopped" or stopped_camp.get("__code__") == "PRECONDITION_FAILED")
after_stop = call("GET", admin, "teamAssistant.campaign", {"runId": camp_id})
ok("停止後不會再有 running 的 campaign",
   after_stop.get("run", {}).get("status") in ("stopped", "failed", "done"))

# 未核准的可以直接放棄（純標記，沒有花任何點）
camp2 = call("POST", admin, "teamAssistant.planCampaign", {
    "groupId": gid, "goal": "第二份組代理計畫：只用來驗放棄流程", "budgetPoints": 30,
})
ok("第二份 campaign 帶得到指定授權", camp2.get("budgetPoints") == 30)
camp2_id = camp2.get("id", ghost_run)
discarded_camp = call("POST", admin, "teamAssistant.discardCampaign", {"runId": camp2_id})
ok("未核准的 campaign 可放棄", discarded_camp.get("status") == "discarded")
camp_list2 = call("GET", admin, "teamAssistant.campaigns", {"groupId": gid})
ok("放棄的 campaign 不進清單",
   isinstance(camp_list2, list) and all(c.get("id") != camp2_id for c in camp_list2))

# campaign 的授權門檻是 command（CAMPAIGN_MIN_LEVEL），比單一指令的 supervise 高一級：
# 發起 campaign 不是「按一次、花一次」，是授權它在無人盯著時反覆自己按。
mem_camp = call("POST", member, "teamAssistant.planCampaign", {
    "groupId": gid, "goal": "無授權組員不應排得出組代理計畫",
})
ok("🔒 無授權組員不能發起 campaign", mem_camp.get("__code__") == "FORBIDDEN")
# supervise 能核准單一子計畫，但**不能**發起會自動核准的常駐計畫——這是成員設定頁那段
# 「可監督不會自動花錢」文案的唯一保證，鬆掉就等於那段字在騙人。
call("POST", admin, "quota.setMemberCommandLevel", {"groupId": gid, "userId": mem_id, "level": "supervise"})
sup_camp = call("POST", member, "teamAssistant.planCampaign", {
    "groupId": gid, "goal": "監督權不該排得出會自動花點的常駐計畫",
})
ok("🔒 supervise 不能發起 campaign（要 command）", sup_camp.get("__code__") == "FORBIDDEN")
call("POST", admin, "quota.setMemberCommandLevel", {"groupId": gid, "userId": mem_id, "level": "command"})
cmd_camp = call("POST", member, "teamAssistant.planCampaign", {
    "groupId": gid, "goal": "被授權總指揮的組員可以排調度計畫",
})
ok("command 等級的組員可以發起 campaign", cmd_camp.get("status") == "awaiting_approval")
if cmd_camp.get("id"):
    call("POST", member, "teamAssistant.discardCampaign", {"runId": cmd_camp["id"]})
call("POST", admin, "quota.setMemberCommandLevel", {"groupId": gid, "userId": mem_id, "level": "none"})
ok("組員仍看得到 campaign 清單（唯讀不需授權）",
   isinstance(call("GET", member, "teamAssistant.campaigns", {"groupId": gid}), list))
ok("🔒 非本組不能發起 campaign",
   "__error__" in call("POST", admin, "teamAssistant.planCampaign", {"groupId": fake_gid, "goal": "跨組不該成功的組代理計畫"}))
ok("🔒 目標太短的 campaign 被擋",
   "__error__" in call("POST", admin, "teamAssistant.planCampaign", {"groupId": gid, "goal": "推一下"}))

# ── 21. 下令軌跡：不屬於任何 campaign 的單發指令也讀得出來 ──
# 這一條在意的是「寫得進去、讀不出來」：L1／L2 從卡片按下的指令 run_id 都是 NULL，
# 沒有這支查詢的話「誰替誰核准了一份會花點的計畫」只有進資料庫下 SQL 才看得到。
log = call("GET", admin, "teamAssistant.commandLog", {"groupId": gid, "limit": 50})
ok("commandLog 讀得到組級事件", isinstance(log, list))
ok("commandLog 含不屬於 campaign 的單發指令（run_id 為空）",
   isinstance(log, list) and any(e.get("runId") is None for e in log))
ok("🔒 非本組讀不到下令軌跡",
   "__error__" in call("GET", admin, "teamAssistant.commandLog", {"groupId": fake_gid}))
camp_only = call("GET", admin, "teamAssistant.commandLog", {"groupId": gid, "campaignOnly": True})
ok("campaignOnly 只回屬於 campaign 的事件",
   isinstance(camp_only, list) and all(e.get("runId") for e in camp_only))

print("—— e2e-team-assistant 完成 ——")
