"""
E2E：自訂資料庫系統（列＋權限＋AI 存取＋文件層）。
覆蓋：建庫（四範圍）、欄位驗證、列 CRUD、agentAccess 對 MCP 的收斂、
文件上傳抽文字、URL 匯入的 SSRF 阻擋、MCP 讀檔分頁、配額、組隔離。
與其他套件同框架：全新 DB + 假生成模式；任何 ❌ 非零退出（CI 判紅綠）。
"""
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


def upload_file(opener, table_id, filename, content, content_type):
    """multipart 上傳到 /api/databases/upload；回 (status, json)"""
    boundary = "----e2edbboundary"
    parts = []
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"tableId\"\r\n\r\n{table_id}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode())
    parts.append(content if isinstance(content, bytes) else content.encode())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    data = b"".join(parts)
    req = urllib.request.Request(f"{HOST}/api/databases/upload", data=data, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if opener.cookie: req.add_header("Cookie", opener.cookie)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


from e2e_lib import ok

admin = client(); azhe = client()

# ── 登入＋邀請阿哲進剪輯組（比照 e2e-auth 種子）──
call("POST", admin, "auth.login", {"email": "admin@aidirector.local", "password": "test-admin-123"})
teams = call("GET", admin, "admin.overview")
north = next(t for t in teams if t["name"] == "北區工作組")
edit_group = next(g for g in north["groups"] if g["name"] == "剪輯組")
anim_group = next(g for t in teams for g in t["groups"] if g["name"] == "動畫組")
inv = call("POST", admin, "admin.invite", {"email": "azhe@example.com", "teamId": north["id"], "teamRole": "member",
                                           "groupId": edit_group["id"], "groupRole": "member"})
token = inv["inviteUrl"].split("/")[-1]
acc = call("POST", azhe, "auth.acceptInvite", {"token": token, "name": "阿哲", "password": "azhe-pass-88"})
ok("阿哲入組（剪輯組）", acc["groups"][0]["groupName"] == "剪輯組")

# ── 建庫：個人 + 組（欄位自訂）──
personal = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "我的待辦",
    "fields": [{"key": "task", "label": "事項", "type": "text", "required": True},
               {"key": "done", "label": "完成", "type": "checkbox"}]})
ok("建個人資料庫", personal.get("scope") == "personal" and personal.get("ownerId") == acc["user"]["id"])

group_db = call("POST", azhe, "databases.create", {
    "scope": "group", "groupId": edit_group["id"], "name": "器材借用表",
    "fields": [{"key": "gear", "label": "器材", "type": "text", "required": True},
               {"key": "who", "label": "借用人", "type": "text"}],
    "agentAccess": "read"})
ok("建組資料庫（AI 唯讀）", group_db.get("scope") == "group" and group_db.get("agentAccess") == "read")

# 欄位驗證：空欄位陣列被擋
bad = call("POST", azhe, "databases.create", {"scope": "personal", "name": "壞庫", "fields": []})
ok("空欄位定義被擋", "__error__" in bad)

# ── 列 CRUD ──
row = call("POST", azhe, "databases.addRow", {"tableId": personal["id"], "data": {"task": "剪好開示片", "done": False}})
ok("新增資料列", row.get("data", {}).get("task") == "剪好開示片")

# 必填缺值被擋
badrow = call("POST", azhe, "databases.addRow", {"tableId": personal["id"], "data": {"done": True}})
ok("必填缺值被擋", "__error__" in badrow)

listed = call("GET", azhe, "databases.listRows", {"tableId": personal["id"]})
ok("列出資料列", listed["total"] == 1 and listed["rows"][0]["data"]["task"] == "剪好開示片")

# ── 個人庫隔離：超管也看不到阿哲的個人庫 ──
admin_list = call("GET", admin, "databases.list")
ok("🔒 超管看不到他人個人庫", not any(t["id"] == personal["id"] for t in admin_list))

# ── 文件層：上傳純文字，抽字成功 ──
st, up = upload_file(azhe, personal["id"], "逐字稿.txt", "師父開示：慈悲喜捨，普度眾生。", "text/plain")
ok("上傳文字檔（抽字）", st == 200 and up.get("ok") and up["file"]["readableChars"] > 0)
file_id = up["file"]["id"]

# 上傳 SRT 字幕，去時間軸只留台詞
srt = "1\n00:00:01,000 --> 00:00:03,000\n第一句開示\n\n2\n00:00:03,500 --> 00:00:05,000\n第二句"
st2, up2 = upload_file(azhe, personal["id"], "字幕.srt", srt, "application/x-subrip")
ok("上傳字幕（抽台詞）", st2 == 200 and up2["file"]["readableChars"] > 0)

# 不支援格式被擋（415）
st3, up3 = upload_file(azhe, personal["id"], "壞檔.xyz", b"\x00\x01\x02", "application/x-unknown")
ok("不支援格式被擋", st3 == 415)

# 文件清單＋配額
files = call("GET", azhe, "databases.listFiles", {"tableId": personal["id"]})
ok("文件清單＋配額", len(files["files"]) == 2 and files["quota"]["usedBytes"] > 0)

# 全文讀取
ft = call("GET", azhe, "databases.getFileText", {"id": file_id})
ok("讀文件全文", "慈悲喜捨" in ft["text"])

# ── URL 匯入 SSRF 阻擋 ──
ssrf1 = call("POST", azhe, "databases.importUrl", {"tableId": personal["id"], "url": "http://169.254.169.254/latest/meta-data"})
ok("🔒 SSRF：擋 metadata 位址", "__error__" in ssrf1 and "內部" in ssrf1["__error__"])
ssrf2 = call("POST", azhe, "databases.importUrl", {"tableId": personal["id"], "url": "http://127.0.0.1:8080/admin"})
ok("🔒 SSRF：擋 localhost", "__error__" in ssrf2)
ssrf3 = call("POST", azhe, "databases.importUrl", {"tableId": personal["id"], "url": "file:///etc/passwd"})
ok("🔒 SSRF：擋非 http 協定", "__error__" in ssrf3)
ssrf4 = call("POST", azhe, "databases.importUrl", {"tableId": personal["id"], "url": "http://2130706433/x"})
ok("🔒 SSRF：擋整數型 IP", "__error__" in ssrf4)


# ── MCP：以阿哲身分建個人金鑰，驗證文件讀取與 agentAccess 收斂 ──
def mcp(method, params=None, key="test-mcp-key"):
    req = urllib.request.Request(f"{HOST}/api/mcp",
                                 data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}).encode(),
                                 headers={"Content-Type": "application/json", "x-api-key": key}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return {"http": e.code}


tok = call("POST", azhe, "mcpTokens.create", {"label": "阿哲測試金鑰"})
azhe_key = tok["token"]


def mcp_call(name, args):
    r = mcp("tools/call", {"name": name, "arguments": args}, key=azhe_key)
    return json.loads(r["result"]["content"][0]["text"])


# 阿哲的 MCP 看得到自己的個人庫與組庫
dbs = mcp_call("list_databases", {})
ok("MCP 列出我的資料庫", any(d["tableId"] == personal["id"] for d in dbs))

# MCP 列文件＋讀檔
mfiles = mcp_call("list_database_files", {"tableId": personal["id"]})
ok("MCP 列出文件", any(f["fileId"] == file_id for f in mfiles))
mread = mcp_call("read_database_file", {"fileId": file_id})
ok("MCP 讀檔全文", "慈悲喜捨" in mread["text"] and mread["totalChars"] > 0)

# keyword 過濾回匹配片段
mfiltered = mcp_call("list_database_files", {"tableId": personal["id"], "keyword": "第一句"})
ok("MCP keyword 過濾文件", any("snippet" in f for f in mfiltered))

# agentAccess=read 的組庫：MCP 可讀列、不可寫
qr = mcp_call("query_database", {"tableId": group_db["id"]})
ok("MCP 可查唯讀庫", "rows" in qr)
wr = mcp("tools/call", {"name": "add_database_row", "arguments": {"tableId": group_db["id"], "data": {"gear": "攝影機"}}}, key=azhe_key)
ok("🔒 MCP 不可寫入唯讀庫（agentAccess=read）", "error" in wr or "不開放" in json.dumps(wr, ensure_ascii=False))

# agentAccess=none：MCP 完全看不到
none_db = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "私密庫", "agentAccess": "none",
    "fields": [{"key": "secret", "label": "秘密", "type": "text"}]})
dbs2 = mcp_call("list_databases", {})
ok("🔒 agentAccess=none 對 MCP 隱形", not any(d["tableId"] == none_db["id"] for d in dbs2))
none_read = mcp("tools/call", {"name": "query_database", "arguments": {"tableId": none_db["id"]}}, key=azhe_key)
ok("🔒 agentAccess=none 查詢視同不存在", "error" in none_read and "找不到" in json.dumps(none_read, ensure_ascii=False))

# ── 組隔離：阿哲不能在動畫組（非本組）建庫 ──
cross = call("POST", azhe, "databases.create", {
    "scope": "group", "groupId": anim_group["id"], "name": "越權庫",
    "fields": [{"key": "x", "label": "X", "type": "text"}]})
ok("🔒 非本組不可建組庫", "__error__" in cross and "不屬於" in cross["__error__"])

# ── 全站庫限超管 ──
glob = call("POST", azhe, "databases.create", {"scope": "global", "name": "組員建全站庫",
                                               "fields": [{"key": "x", "label": "X", "type": "text"}]})
ok("🔒 組員不可建全站庫", "__error__" in glob and "超級管理員" in glob["__error__"])
glob_ok = call("POST", admin, "databases.create", {"scope": "global", "name": "全站公告",
                                                   "fields": [{"key": "msg", "label": "訊息", "type": "text"}]})
ok("超管可建全站庫", glob_ok.get("scope") == "global")

# ── 刪文件釋放配額 ──
before = call("GET", azhe, "databases.listFiles", {"tableId": personal["id"]})["quota"]["usedBytes"]
call("POST", azhe, "databases.removeFile", {"id": file_id})
after = call("GET", azhe, "databases.listFiles", {"tableId": personal["id"]})["quota"]["usedBytes"]
ok("刪文件釋放配額", after < before)
