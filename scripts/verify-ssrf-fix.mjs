// 自足驗證：登入→建可寫庫→對多種 SSRF payload 觸發 importUrl，確認 DNS 名稱繞過已被擋。
const BASE = "http://localhost:3000";
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PW;
if (!EMAIL || !PASSWORD) {
  console.error("verify-ssrf-fix 需設 TEST_EMAIL / TEST_PW（對應 .env.example）；憑證不得寫死在腳本中。");
  process.exit(1);
}
const grab = (res) => { const m = (res.headers.get("set-cookie")||"").match(/aidos_session=([^;]+)/); return m?m[1]:null; };
async function mut(proc, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${proc}?batch=1`, { method:"POST",
    headers:{ "content-type":"application/json", ...(cookie?{cookie:`aidos_session=${cookie}`}:{}) },
    body: JSON.stringify({ "0":{ json: input } }) });
  const c = grab(res); const b = await res.json();
  return { data: b?.[0]?.result?.data?.json, err: b?.[0]?.error?.json, cookie: c };
}
// 1. admin login
const lg = await mut("auth.login", { email: EMAIL, password: PASSWORD });
const cookie = lg.cookie;
if (!cookie) { console.log("LOGIN FAIL", JSON.stringify(lg.err)); process.exit(1); }
const me = lg.data;
const groupId = me.groups[0].groupId;
// 2. create a writable group db
const db = await mut("databases.create", { scope:"group", groupId, name:"SSRF-verify-"+Date.now(), fields:[{key:"c",label:"c",type:"text"}], memberWritable:true, agentAccess:"write" }, cookie);
const tableId = db.data?.id;
console.log("tableId:", tableId);
// 3. run payloads
const payloads = [
  ["literal 127.0.0.1 (baseline block)", "http://127.0.0.1:3000/api/ready"],
  ["DNS→127.0.0.1 (was BYPASS)", "http://127.0.0.1.nip.io:3000/api/ready"],
  ["DNS→169.254.169.254 metadata (was BYPASS)", "http://169.254.169.254.nip.io/latest/meta-data/"],
  ["localtest.me→127.0.0.1 (was BYPASS)", "http://localtest.me:3000/api/ready"],
];
for (const [name, url] of payloads) {
  const r = await mut("databases.importUrl", { tableId, url, name:"P" }, cookie);
  const msg = r.err?.message ?? JSON.stringify(r.data);
  const blocked = /內部位址|不能匯入內部網址|無法解析/.test(msg);
  console.log(`${blocked ? "BLOCKED ✓" : "!! NOT BLOCKED"}  [${name}] -> ${msg}`);
}
