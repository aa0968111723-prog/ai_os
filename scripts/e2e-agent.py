#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""正式 AI 代理生命週期 E2E：全新 PostgreSQL + mock provider，副作用與 Runner 皆為真實路徑。"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from e2e_lib import adopt_waiting_generate_steps, ok

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
login = call("POST", admin, "auth.login", {
    "email": os.environ.get("SEED_ADMIN_EMAIL", "admin@aidirector.local"),
    "password": os.environ.get("SEED_ADMIN_PASSWORD", "test-admin-123"),
})
ok("代理 E2E 登入", "user" in login)
overview = call("GET", admin, "admin.overview")
group = next(group for team in overview for group in team["groups"])
project = call("POST", admin, "projects.create", {
    "groupId": group["id"],
    "title": "完整代理 E2E",
    "kind": "campaign",
    "platform": "shorts",
})
project_id = project["id"]

planned = call("POST", admin, "agents.plan", {
    "projectId": project_id,
    "goal": "建立一格活動主視覺分鏡並生成畫面",
})
ok("完整計畫待核准", planned.get("status") == "awaiting_approval")
ok(
    "完整計畫含結構化成功條件與成果",
    isinstance(planned.get("planSummary", {}).get("successCriteria"), list)
    and isinstance(planned.get("planSummary", {}).get("expectedOutputs"), list),
)
steps = planned.get("steps", [])
ok("新計畫帶 DAG id 與依賴", all(step.get("id") for step in steps) and any(step.get("dependsOn") for step in steps))

events_page = call("GET", admin, "agents.eventsByProject", {"projectId": project_id, "limit": 20})
ok(
    "規劃事件已入可稽核軌跡",
    any(event["eventType"] == "planned" for event in events_page.get("items", [])),
)

approved = call("POST", admin, "agents.approve", {"runId": planned["id"]})
ok("核准後進入執行", approved.get("status") == "running")

terminal = None
for _ in range(40):
    time.sleep(2)
    runs = call("GET", admin, "agents.listByProject", {"projectId": project_id})
    terminal = next((run for run in runs if run["id"] == planned["id"]), None)
    if not terminal:
        continue
    adopt_waiting_generate_steps(call, admin, terminal)
    if terminal["status"] in ("done", "failed"):
        break
ok("背景 Runner 完成完整代理計畫", terminal is not None and terminal.get("status") == "done")

events_page = call("GET", admin, "agents.eventsByProject", {"projectId": project_id, "limit": 100})
event_types = [event["eventType"] for event in events_page.get("items", [])]
ok("軌跡含人工核准", "approved" in event_types)
ok("軌跡含步驟開始與完成", "step_started" in event_types and "step_completed" in event_types)
ok("軌跡含計畫終局", "run_completed" in event_types)
ok("事件分頁明示 nextCursor", "nextCursor" in events_page)

insights = call("GET", admin, "agents.insights", {"projectId": project_id})
result_types = {result["type"] for result in insights.get("results", [])}
ok("成果中心收錄分鏡", "scene" in result_types)
ok("成果中心收錄生成", "generation" in result_types)
ok("健康摘要含統一任務與截斷旗標", isinstance(insights.get("workItems"), list) and isinstance(insights.get("truncated"), dict))

discarded_plan = call("POST", admin, "agents.plan", {
    "projectId": project_id,
    "goal": "建立第二份可放棄的測試計畫",
})
discarded = call("POST", admin, "agents.discard", {"runId": discarded_plan["id"]})
ok("待核計畫可安全放棄", discarded.get("status") == "discarded")
events_page = call("GET", admin, "agents.eventsByProject", {"projectId": project_id, "limit": 200})
ok("放棄裁決也可稽核", any(event["eventType"] == "discarded" for event in events_page.get("items", [])))

print("—— e2e-agent 完成 ——")
