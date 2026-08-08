"""
E2E：自訂資料庫系統（列＋權限＋AI 存取＋文件層）。
覆蓋：建庫（四範圍）、欄位驗證、列 CRUD、agentAccess 對 MCP 的收斂、
文件上傳抽文字、URL 匯入的 SSRF 阻擋、MCP 讀檔分頁、配額、組隔離。
與其他套件同框架：全新 DB + 假生成模式；任何 ❌ 非零退出（CI 判紅綠）。
"""
import json, time, urllib.request, urllib.parse, urllib.error
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

# ── 個人庫隔離：開發者也看不到阿哲的個人庫 ──
admin_list = call("GET", admin, "databases.list")
ok("🔒 開發者看不到他人個人庫", not any(t["id"] == personal["id"] for t in admin_list))

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

# ── 全站庫限開發者 ──
glob = call("POST", azhe, "databases.create", {"scope": "global", "name": "組員建全站庫",
                                               "fields": [{"key": "x", "label": "X", "type": "text"}]})
ok("🔒 組員不可建全站庫", "__error__" in glob and "超級管理員" in glob["__error__"])
glob_ok = call("POST", admin, "databases.create", {"scope": "global", "name": "全站公告",
                                                   "fields": [{"key": "msg", "label": "訊息", "type": "text"}]})
ok("開發者可建全站庫", glob_ok.get("scope") == "global")

# ── 刪文件釋放配額 ──
before = call("GET", azhe, "databases.listFiles", {"tableId": personal["id"]})["quota"]["usedBytes"]
call("POST", azhe, "databases.removeFile", {"id": file_id})
after = call("GET", azhe, "databases.listFiles", {"tableId": personal["id"]})["quota"]["usedBytes"]
ok("刪文件釋放配額", after < before)


# ── CSV 匯入（連接 Excel／其他資料庫）──
csv_db = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "CSV 匯入測試",
    "fields": [{"key": "name", "label": "姓名", "type": "text", "required": True},
               {"key": "age", "label": "年齡", "type": "number"}]})
csv_import_payload = {
    "tableId": csv_db["id"],
    "format": "csv",
    "content": "姓名,年齡\r\n小美,28\r\n阿哲,30\r\n壞列,不是數字",
    "headerMap": {"姓名": "name", "年齡": "age"},
    "idempotencyKey": "e2e-csv-import-001",
}
imp = call("POST", azhe, "databases.importData", csv_import_payload)
ok("CSV 匯入（2 成功 1 失敗）", imp["imported"] == 2 and imp["failed"] == 1 and len(imp["errors"]) == 1 and imp["replayed"] is False)
imp_replay = call("POST", azhe, "databases.importData", csv_import_payload)
ok("CSV 匯入同 key 安全重播", imp_replay["imported"] == 2 and imp_replay["replayed"] is True)
imp_conflict = call("POST", azhe, "databases.importData", {
    **csv_import_payload,
    "content": "姓名,年齡\r\n不同內容,99",
})
ok("CSV 匯入同 key 不同內容衝突", "__error__" in imp_conflict and "IDEMPOTENCY_CONFLICT" in imp_conflict["__error__"])
csv_rows = call("GET", azhe, "databases.listRows", {"tableId": csv_db["id"]})
ok("CSV 匯入的列可查", csv_rows["total"] == 2 and any(r["data"]["name"] == "小美" for r in csv_rows["rows"]))

# ── TSV 與 JSON 匯入（多格式）──
tsv_imp = call("POST", azhe, "databases.importData", {
    "tableId": csv_db["id"],
    "format": "tsv",
    "content": "姓名\t年齡\r\n阿美\t22",
    "headerMap": {"姓名": "name", "年齡": "age"},
    "idempotencyKey": "e2e-tsv-import-001"})
ok("TSV 匯入成功", tsv_imp["imported"] == 1 and tsv_imp["failed"] == 0)
json_imp = call("POST", azhe, "databases.importData", {
    "tableId": csv_db["id"],
    "format": "json",
    "content": '[{"姓名":"小華","年齡":40},{"姓名":"小明","年齡":18}]',
    "headerMap": {"姓名": "name", "年齡": "age"},
    "idempotencyKey": "e2e-json-import-001"})
ok("JSON 匯入成功", json_imp["imported"] == 2 and json_imp["failed"] == 0)
multi_rows = call("GET", azhe, "databases.listRows", {"tableId": csv_db["id"]})
ok("多格式匯入後列數累加", multi_rows["total"] == 5)

# ── 大量匯入效能門檻：5,000 列必須走批次交易，不可退化成逐列 transaction ──
perf_db = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "大量匯入效能測試",
    "fields": [{"key": "seq", "label": "序號", "type": "number", "required": True},
               {"key": "label", "label": "標籤", "type": "text"}]})
perf_content = "序號,標籤\r\n" + "\r\n".join(f"{i},資料-{i}" for i in range(5000))
perf_started = time.monotonic()
perf_result = call("POST", azhe, "databases.importData", {
    "tableId": perf_db["id"],
    "format": "csv",
    "content": perf_content,
    "headerMap": {"序號": "seq", "標籤": "label"},
    "idempotencyKey": "e2e-perf-import-5000"})
perf_elapsed = time.monotonic() - perf_started
ok("5,000 列批次匯入完整落庫", perf_result.get("imported") == 5000 and perf_result.get("failed") == 0)
# CI 共用 runner 留寬鬆 20 秒上限；真正目的在抓回歸成 5,000 次 transaction/20,000+ SQL 的舊實作。
ok("5,000 列匯入效能門檻（<20 秒）", perf_elapsed < 20)
perf_rows = call("GET", azhe, "databases.listRows", {"tableId": perf_db["id"]})
ok("大量匯入列數可查", perf_rows.get("total") == 5000)


# ── CSV 匯出（HTTP GET，帶 cookie）──
def http_get(path, cookie=None, key=None):
    req = urllib.request.Request(f"{HOST}{path}")
    if cookie: req.add_header("Cookie", cookie)
    if key: req.add_header("x-api-key", key)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode("utf-8"), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), ""


st_csv, csv_out, ct_csv = http_get(f"/api/databases/{csv_db['id']}/rows.csv", cookie=azhe.cookie)
ok("CSV 匯出（含表頭與資料）", st_csv == 200 and "text/csv" in ct_csv and "姓名" in csv_out and "小美" in csv_out)
# 別人的個人庫 CSV 匯出被擋（404 不洩漏存在性）
st_csv_x, _, _ = http_get(f"/api/databases/{csv_db['id']}/rows.csv", cookie=admin.cookie)
ok("🔒 他人個人庫 CSV 匯出被擋", st_csv_x == 404)

# ── CSV 匯入勾選欄位（是/否 → boolean，round-trip）＋公式注入中和 ──
cb_db = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "勾選匯入測試",
    "fields": [{"key": "task", "label": "事項", "type": "text"},
               {"key": "done", "label": "完成", "type": "checkbox"}]})
cb_imp = call("POST", azhe, "databases.importData", {
    "tableId": cb_db["id"], "format": "csv", "content": "事項,完成\r\n剪片,是\r\n配音,否",
    "headerMap": {"事項": "task", "完成": "done"},
    "idempotencyKey": "e2e-checkbox-import-001"})
ok("CSV 勾選欄位（是/否）匯入成功", cb_imp["imported"] == 2 and cb_imp["failed"] == 0)
cb_rows = call("GET", azhe, "databases.listRows", {"tableId": cb_db["id"]})
done_map = {r["data"]["task"]: r["data"]["done"] for r in cb_rows["rows"]}
ok("勾選值轉成 boolean", done_map.get("剪片") is True and done_map.get("配音") is False)
# 公式注入：text 欄存 =1+1，匯出時前綴 ' 中和
call("POST", azhe, "databases.addRow", {"tableId": cb_db["id"], "data": {"task": "=HYPERLINK(1)"}})
_, cb_csv, _ = http_get(f"/api/databases/{cb_db['id']}/rows.csv", cookie=azhe.cookie)
ok("CSV 匯出中和公式注入（'=）", "'=HYPERLINK(1)" in cb_csv and "\n=HYPERLINK" not in cb_csv)


# ── REST API v1（本機/手機/外部 HTTP 客戶端，x-api-key 認證）──
def http_json(method, path, key=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{HOST}{path}", data=data, method=method,
                                 headers={"Content-Type": "application/json", **({"x-api-key": key} if key else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}


st_unauth, _ = http_json("GET", "/api/v1/databases")
ok("🔒 REST 無金鑰被擋（401）", st_unauth == 401)
st_list, rest_list = http_json("GET", "/api/v1/databases", key=azhe_key)
ok("REST 列出資料庫", st_list == 200 and any(d["id"] == csv_db["id"] for d in rest_list["databases"]))
st_add, rest_add = http_json("POST", f"/api/v1/databases/{csv_db['id']}/rows", key=azhe_key, body={"data": {"name": "REST 小華", "age": 25}})
ok("REST 新增一列", st_add == 200 and rest_add["data"]["name"] == "REST 小華")
st_q, rest_q = http_json("GET", f"/api/v1/databases/{csv_db['id']}/rows?q=REST", key=azhe_key)
ok("REST 查詢（keyword）", st_q == 200 and any(r["data"]["name"] == "REST 小華" for r in rest_q["rows"]))
# agentAccess=none 的庫對 REST（金鑰=AI 介面）隱形
st_none, _ = http_json("GET", f"/api/v1/databases/{none_db['id']}/rows", key=azhe_key)
ok("🔒 REST 對 agentAccess=none 庫回 404", st_none == 404)


# ── 行事曆訂閱（.ics；?key= 認證）──
cal_db = call("POST", azhe, "databases.create", {
    "scope": "personal", "name": "拍攝日程",
    "fields": [{"key": "what", "label": "事項", "type": "text"},
               {"key": "day", "label": "日期", "type": "date"}]})
call("POST", azhe, "databases.addRow", {"tableId": cal_db["id"], "data": {"what": "外景拍攝", "day": "2026-08-01"}})
st_ics, ics_out, ct_ics = http_get(f"/api/databases/{cal_db['id']}/calendar.ics?key={azhe_key}")
ok("行事曆 .ics（VEVENT）", st_ics == 200 and "text/calendar" in ct_ics and "BEGIN:VEVENT" in ics_out and "外景拍攝" in ics_out)
# 沒有日期欄位的庫回 400
st_ics2, _, _ = http_get(f"/api/databases/{csv_db['id']}/calendar.ics?key={azhe_key}")
ok("無日期欄位的庫不能訂閱行事曆", st_ics2 == 400)


# ── AI 代理 × 資料庫：mock 計畫在有可寫庫時多一步 record_to_database ──
# 阿哲在剪輯組建一個 AI 可寫的組資料庫，然後在剪輯組專案跑代理
agent_db = call("POST", azhe, "databases.create", {
    "scope": "group", "groupId": edit_group["id"], "name": "代理成果紀錄", "agentAccess": "write",
    "fields": [{"key": "note", "label": "紀錄", "type": "text"}]})
agent_proj = call("POST", azhe, "projects.create", {"groupId": edit_group["id"], "title": "代理資料庫測試", "kind": "witness", "platform": "shorts"})

# 專案 AI 助手必須以登入者 ACL 主動讀到 personal 資料列，不可再依賴模型
# 猜中 query_database 工具，也不可把 agentAccess=none 的列混進來源。
assistant_read = call("POST", azhe, "assistant.ask", {
    "projectId": agent_proj["id"],
    "message": "請問剪好開場片的完成狀態？",
    "nonce": "e2e-assistant-db-readable",
})
assistant_sources = ((assistant_read.get("sources") or {}).get("items") or []) if isinstance(assistant_read, dict) else []
ok("AI 助手主動讀到 personal 資料庫列",
   "剪好開場片" in assistant_read.get("answer", "")
   and any(s.get("kind") == "database" and s.get("title") == personal["name"] for s in assistant_sources))

call("POST", azhe, "databases.addRow", {"tableId": none_db["id"], "data": {"secret": "黑曜石密碼-不可外洩"}})
assistant_hidden = call("POST", azhe, "assistant.ask", {
    "projectId": agent_proj["id"],
    "message": "黑曜石密碼是什麼？",
    "nonce": "e2e-assistant-db-hidden",
})
hidden_sources = ((assistant_hidden.get("sources") or {}).get("items") or []) if isinstance(assistant_hidden, dict) else []
ok("🔒 AI 助手不讀 agentAccess=none 資料庫列",
   "黑曜石密碼-不可外洩" not in assistant_hidden.get("answer", "")
   and not any(s.get("title") == none_db["name"] for s in hidden_sources))

plan = call("POST", azhe, "agents.plan", {"projectId": agent_proj["id"], "goal": "測試把成果記進資料庫"})
has_record_step = any(s.get("kind") == "record_to_database" and s.get("tableId") == agent_db["id"] for s in plan["steps"])
ok("代理計畫含 record_to_database 步驟", has_record_step)
appr = call("POST", azhe, "agents.approve", {"runId": plan["id"]})
ok("代理計畫核准執行", appr["status"] == "running")

# 等背景執行器跑完（每 4 秒一 tick；mock 生成也要幾輪）——輪詢代理成果庫出現新列
import time
agent_wrote = False
for _ in range(40):
    time.sleep(2)
    rr = call("GET", azhe, "databases.listRows", {"tableId": agent_db["id"]})
    if rr.get("total", 0) >= 1:
        agent_wrote = True
        break
ok("AI 代理把成果寫進資料庫", agent_wrote)


# ── 專案資料一鍵綁表（使用者：剪輯／社群從專案建立可關聯表）──
# createBoundToProject：組庫 + 關聯專案欄 + 範例列 + agentAccess write
bound_proj = call("POST", azhe, "projects.create", {
    "groupId": edit_group["id"], "title": "社群週更實測", "kind": "witness", "platform": "shorts",
})
bound = call("POST", azhe, "databases.createBoundToProject", {
    "projectId": bound_proj["id"], "template": "publish",
})
ok("一鍵建立發布計畫表", bound.get("tableId") and bound.get("template") == "publish")
linked = call("GET", azhe, "databases.linkedToProject", {"projectId": bound_proj["id"]})
ok("專案卡可看到綁定表", any(g["tableId"] == bound["tableId"] for g in linked))
bound_group = next(g for g in linked if g["tableId"] == bound["tableId"])
ok("綁定表預設 AI 可讀寫", bound_group.get("agentAccess") == "write")
ok("綁定表至少一筆範例列", len(bound_group.get("rows", [])) >= 1)
# 範例列的 project 欄必須指向本專案
proj_keys = [f["key"] for f in bound_group["fields"] if f.get("type") == "project"]
ok("綁定表含關聯專案欄", len(proj_keys) >= 1)
sample_ok = any(
    (r.get("data") or {}).get(proj_keys[0]) == bound_proj["id"]
    for r in bound_group["rows"]
)
ok("範例列已指向本專案", sample_ok)

# 素材清單範本（剪輯／動畫）
media_bound = call("POST", azhe, "databases.createBoundToProject", {
    "projectId": bound_proj["id"], "template": "media",
})
ok("一鍵建立素材清單", media_bound.get("template") == "media")
linked2 = call("GET", azhe, "databases.linkedToProject", {"projectId": bound_proj["id"]})
ok("兩張綁定表都出現在專案", len(linked2) >= 2)

# 就地加列語意：addRow 預填專案欄後 linked 列數增加
media_fields = next(g["fields"] for g in linked2 if g["tableId"] == media_bound["tableId"])
media_proj_key = next(f["key"] for f in media_fields if f["type"] == "project")
media_name_key = next(f["key"] for f in media_fields if f["type"] == "text" and f.get("required"))
before_n = next(g for g in linked2 if g["tableId"] == media_bound["tableId"])
before_count = len(before_n["rows"])
call("POST", azhe, "databases.addRow", {
    "tableId": media_bound["tableId"],
    "data": {media_name_key: "A-roll 主鏡頭", media_proj_key: bound_proj["id"]},
})
linked3 = call("GET", azhe, "databases.linkedToProject", {"projectId": bound_proj["id"]})
after_n = next(g for g in linked3 if g["tableId"] == media_bound["tableId"])
ok("就地加列後專案關聯列數增加", len(after_n["rows"]) == before_count + 1)

# agentAccess=none：人仍可在 linkedToProject 看到（專案彙整），但 MCP 不可見
hide = call("POST", azhe, "databases.update", {
    "id": bound["tableId"], "agentAccess": "none",
})
ok("可把綁定表改為 AI 不可見", hide.get("agentAccess") == "none" if isinstance(hide, dict) else True)
# update 可能回整表
if isinstance(hide, dict) and "agentAccess" in hide:
    ok("更新後 agentAccess=none", hide["agentAccess"] == "none")
linked_hidden = call("GET", azhe, "databases.linkedToProject", {"projectId": bound_proj["id"]})
hidden_g = next(g for g in linked_hidden if g["tableId"] == bound["tableId"])
ok("專案卡仍列出 AI 不可見表（人可見）", hidden_g.get("agentAccess") == "none")
dbs_hidden = mcp_call("list_databases", {})
ok("🔒 MCP 看不到 agentAccess=none 綁定表", not any(d["tableId"] == bound["tableId"] for d in dbs_hidden))

# 未知範本被擋
bad_tpl = call("POST", azhe, "databases.createBoundToProject", {
    "projectId": bound_proj["id"], "template": "not_a_real_template",
})
ok("未知範本被擋", "__error__" in bad_tpl)

# ── MCP 深化：專案視角 list、equals 查詢、projectId 預填加列、update ──
# media 表仍是 write；用它驗證
mcp_list_proj = mcp_call("list_databases", {"projectId": bound_proj["id"]})
ok("MCP list_databases 帶 projectId 標註關聯",
   any(d.get("tableId") == media_bound["tableId"] and d.get("linkedToProject") for d in mcp_list_proj))
mcp_list_only = mcp_call("list_databases", {"projectId": bound_proj["id"], "linkedOnly": True})
# linkedOnly 的語意是「屬於這個專案」，而屬於有兩條路（P4 dual read）：
# 有列的 project 欄指向它（linkedToProject），或整張表被提供給它（boundToProject）。
# 這個專案沒有建立任何 P4 綁定，所以實際上只會走前者；判斷式仍寫成兩條的聯集，
# 免得之後有人加了綁定就撞上一個其實已經不成立的假設。
ok("MCP list linkedOnly 只回屬於本專案的表",
   all(d.get("linkedToProject") or d.get("boundToProject") for d in mcp_list_only)
   and not any(d["tableId"] == bound["tableId"] for d in mcp_list_only))
ok("MCP list 帶 projectId 時附上整張提供旗標",
   all("boundToProject" in d for d in mcp_list_proj))
# 預填 project 加列
mcp_add = mcp_call("add_database_row", {
    "tableId": media_bound["tableId"],
    "projectId": bound_proj["id"],
    "data": {media_name_key: "B-roll 補拍"},
})
ok("MCP add_database_row 預填 projectId", mcp_add.get("rowId") and mcp_add.get("data", {}).get(media_proj_key) == bound_proj["id"])
# equals 篩選
mcp_eq = mcp_call("query_database", {
    "tableId": media_bound["tableId"],
    "equals": {media_proj_key: bound_proj["id"]},
    "includeFields": False,
})
ok("MCP query equals 關聯專案",
   mcp_eq.get("returned", 0) >= 1 and "fields" not in mcp_eq and mcp_eq.get("hasMore") is False)
# update
mcp_row_id = mcp_add["rowId"]
mcp_upd = mcp_call("update_database_row", {
    "tableId": media_bound["tableId"],
    "rowId": mcp_row_id,
    "projectId": bound_proj["id"],
    "data": {media_name_key: "B-roll 補拍（已剪）", media_proj_key: bound_proj["id"]},
})
ok("MCP update_database_row", mcp_upd.get("data", {}).get(media_name_key) == "B-roll 補拍（已剪）")
# list files 不回 sourceUrl
mcp_files = mcp_call("list_database_files", {"tableId": personal["id"]})
ok("MCP list_database_files 不洩漏 sourceUrl",
   isinstance(mcp_files, list) and all("sourceUrl" not in f for f in mcp_files))
