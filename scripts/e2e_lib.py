# e2e 共用庫:ok() 斷言計數 + 行程結束時以退出碼回報(CI 紅綠靠這個)。
# 設計:斷言失敗「不中斷」後續測試(保留原本一次跑完全部再看的行為),
#       但結束時印總結,且只要有 ❌ 就以非零碼退出;途中未捕捉例外本來就是非零碼,不干預。
import atexit
import os
import sys

_counts = {"pass": 0, "fail": 0}


def ok(name, cond, detail=None):
    good = bool(cond)
    extra = f"  — {detail}" if (not good and detail not in (None, "")) else ""
    print(("✅" if good else "❌"), name + extra)
    _counts["pass" if good else "fail"] += 1


def adopt_waiting_generate_steps(call, opener, run):
    """Visual generate steps stay waiting until Adopt (#753). Unblock the runner."""
    gids = []
    for step in run.get("steps") or []:
        gid = step.get("generationId")
        if not gid:
            continue
        if step.get("kind") == "generate" or str(step.get("note") or "").startswith("待你採用"):
            gids.append(gid)
    pid = run.get("projectId")
    if pid:
        gens = call("GET", opener, "generation.listByProject", {"projectId": pid})
        if isinstance(gens, list):
            for gen in gens:
                if gen.get("status") == "done" and gen.get("id") and gen.get("sceneId"):
                    gids.append(gen["id"])
    adopted = 0
    for gid in dict.fromkeys(gids):
        res = call("POST", opener, "creativeContext.adoptGeneration", {"generationId": gid})
        if isinstance(res, dict) and res.get("adopted"):
            adopted += 1
    return adopted


@atexit.register
def _summary():
    total = _counts["pass"] + _counts["fail"]
    if total == 0:
        return  # 還沒跑到任何斷言就掛了:讓原始例外的非零碼自己說話
    print(f"—— 斷言 {total} 項:✅ {_counts['pass']}/❌ {_counts['fail']} ——")
    sys.stdout.flush()
    sys.stderr.flush()
    if _counts["fail"]:
        os._exit(1)  # atexit 內 sys.exit 改不了結束碼;已手動 flush 再硬退
