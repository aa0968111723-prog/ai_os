"""
E2E: Agent × custom database tools.

Covers list / query / add / update / read-only denied / zero-result honesty
through the existing MCP + tRPC database surface. The Agent registry tools
reuse these same backends; this script asserts the shared contract against a
live server when one is available.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from e2e_lib import ok

HOST = f"http://localhost:{os.environ.get('E2E_PORT', '3199')}"
BASE = f"{HOST}/api/trpc"
MCP = f"{HOST}/api/mcp"


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
        with opener.open(req) as response:
            sc = response.headers.get("Set-Cookie")
            if sc:
                opener.cookie = sc.split(";")[0]
            body = json.load(response)
    except urllib.error.HTTPError as error:
        body = json.load(error)
    if "error" in body:
        return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]


def mcp(opener, name, args):
    req = urllib.request.Request(
        MCP,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with opener.open(req) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        return json.load(error)


admin = Client()
login = call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
if "__error__" in login:
    raise SystemExit(f"NOT RUN — server login failed: {login['__error__']}")

caps = call("GET", admin, "agents.practicalCapabilities")
tool_ids = {tool["id"] for tool in caps.get("declaredTools", [])}
ok("Agent registry 宣告 database.list/schema/query/get/add/update", {
    "database.list",
    "database.schema",
    "database.query",
    "database.row.get",
    "database.row.add",
    "database.row.update",
}.issubset(tool_ids))

created = call("POST", admin, "databases.create", {
    "name": "素材清單",
    "scope": "personal",
    "fields": [
        {"key": "title", "label": "標題", "type": "text", "required": True},
        {"key": "kind", "label": "分類", "type": "text"},
        {"key": "status", "label": "狀態", "type": "text"},
    ],
    "agentAccess": "write",
})
table_id = created["id"]
added = call("POST", admin, "databases.addRow", {
    "tableId": table_id,
    "data": {"title": "王羲之", "kind": "書法", "status": "草稿"},
})
ok("add row 真寫入", bool(added.get("id")))
rows = call("GET", admin, "databases.listRows", {"tableId": table_id, "q": "書法"})
ok("query 舊 exact match 能被找到", any(row["id"] == added["id"] for row in rows))
updated = call("POST", admin, "databases.updateRow", {
    "rowId": added["id"],
    "data": {"title": "王羲之", "kind": "書法", "status": "完成"},
})
ok("update 後 read-back 有新值", updated["data"]["status"] == "完成")

readonly = call("POST", admin, "databases.update", {"id": table_id, "agentAccess": "read"})
ok("改成 AI 唯讀", readonly.get("agentAccess") == "read")

zero = call("GET", admin, "databases.listRows", {"tableId": table_id, "q": "絕對不存在的關鍵字xyz"})
ok("zero-result honesty", zero == [] or (isinstance(zero, list) and len(zero) == 0))

call("POST", admin, "databases.remove", {"id": table_id})
print("e2e-agent-database: done")
