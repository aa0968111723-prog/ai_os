import json, urllib.request, urllib.parse, urllib.error, http.cookiejar

BASE = "http://localhost:3199/api/trpc"
class Client:
    def __init__(self): self.cookie = None
    def open(self, req):
        if self.cookie: req.add_header("Cookie", self.cookie)
        return urllib.request.urlopen(req)
def client():
    return Client()
def call(op, opener, path, data=None):
    url = f"{BASE}/{path}"
    if data is None and op == "GET":
        req = urllib.request.Request(url)
    elif op == "GET":
        req = urllib.request.Request(url + "?input=" + urllib.parse.quote(json.dumps({"json": data})))
    else:
        req = urllib.request.Request(url, data=json.dumps({"json": data}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with opener.open(req) as r:
            sc = r.headers.get("Set-Cookie")
            if sc: opener.cookie = sc.split(";")[0]
            body = json.load(r)
    except urllib.error.HTTPError as e:
        body = json.load(e)
    if "error" in body: return {"__error__": body["error"]["json"]["message"]}
    return body["result"]["data"]["json"]

admin = client(); azhe = client()
ok = lambda name, cond: print(("✅" if cond else "❌"), name)

r = call("POST",admin,"auth.login",{"email":"admin@aidirector.local","password":"test-admin-123"})
ok("超管登入", r.get("user",{}).get("isSuperAdmin") is True)

teams = call("GET",admin,"admin.overview")
north = next(t for t in teams if t["name"]=="北區工作組")
edit_group = next(g for g in north["groups"] if g["name"]=="剪輯組")
anim_group = next(g for t in teams for g in t["groups"] if g["name"]=="動畫組")
ok("總覽：2 團隊 3 組", len(teams)==2 and sum(len(t["groups"]) for t in teams)==3)

inv = call("POST",admin,"admin.invite",{"email":"azhe@example.com","teamId":north["id"],"teamRole":"member","groupId":edit_group["id"],"groupRole":"member"})
token = inv["inviteUrl"].split("/")[-1]
ok("邀請連結產生（72h）", inv["expiresInHours"]==72 and len(token)>=40)

acc = call("POST",azhe,"auth.acceptInvite",{"token":token,"name":"阿哲","password":"azhe-pass-88"})
ok("阿哲接受邀請＋自動登入", acc["user"]["name"]=="阿哲" and acc["groups"][0]["groupName"]=="剪輯組" and acc["groups"][0]["role"]=="member")

reuse = call("POST",client(),"auth.acceptInvite",{"token":token,"name":"壞人","password":"hacker-pass-99"})
ok("邀請一次性（重用被擋）", "__error__" in reuse)

proj = call("POST",azhe,"projects.create",{"groupId":edit_group["id"],"title":"見證故事測試","kind":"witness","platform":"shorts"})
ok("阿哲建專案（9:16 自動）", proj["format"]=="9:16")

gen = call("POST",azhe,"generation.submit",{"projectId":proj["id"],"modelId":"fal-ai/flux/schnell","prompt":"晨光禪堂"})
ok("阿哲生成扣 1 點", gen["pointsEst"]==1 and gen["status"] in ("queued","running"))

cross = call("POST",azhe,"projects.create",{"groupId":anim_group["id"],"title":"越權測試","kind":"promo","platform":"youtube"})
ok("🔒 阿哲在動畫組建專案被擋", cross.get("__error__")=="你不屬於這個組")

aproj = call("POST",admin,"projects.create",{"groupId":anim_group["id"],"title":"動畫組機密專案","kind":"promo","platform":"youtube"})
read = call("GET",azhe,"projects.get",{"id":aproj["id"]})
ok("🔒 阿哲讀動畫組專案被擋", read.get("__error__")=="你不屬於這個組")

lst = call("GET",azhe,"projects.list",{})
ok("阿哲僅見剪輯組專案", [p["title"] for p in lst]==["見證故事測試"])

alst = call("GET",admin,"projects.list",{})
ok("超管跨組看全部（2 專案）", len(alst)==2)

msg = call("POST",azhe,"messages.post",{"projectId":proj["id"],"body":"登入系統測試完成 🙏"})
msgs = call("GET",azhe,"messages.list",{"projectId":proj["id"]})
ok("留言含姓名", msgs[-1]["userName"]=="阿哲")

call("POST",azhe,"auth.logout",None)
me = call("GET",azhe,"auth.me")
ok("登出後 session 失效", me is None)
