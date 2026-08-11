#!/usr/bin/env python3
"""Live/staging Agent capability certification through normal product APIs.

Credentials are read from environment and never printed or written to evidence.
Mock mode remains useful for path regression, but the server forcibly records it
as MOCK_VERIFIED rather than staging/live evidence.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_URL = os.environ.get("AIOS_QA_BASE_URL", "http://127.0.0.1:3199").rstrip("/")
TRPC = f"{BASE_URL}/api/trpc"
MODE = os.environ.get("AIOS_CERTIFICATION_MODE", "staging")
OUT = pathlib.Path(os.environ.get("AIOS_CERTIFICATION_OUT", ".qa-evidence/agent-v5-live-certification.json"))


class Client:
    def __init__(self):
        self.cookie = None

    def request(self, method, path, data=None):
        url = f"{TRPC}/{path}"
        if method == "GET" and data is not None:
            url += "?input=" + urllib.parse.quote(json.dumps({"json": data}))
        body = None if method == "GET" else json.dumps({"json": data}).encode()
        headers = {"Content-Type": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                cookie = response.headers.get("Set-Cookie")
                if cookie:
                    self.cookie = cookie.split(";", 1)[0]
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            payload = json.load(error)
        if "error" in payload:
            raise RuntimeError(payload["error"]["json"]["message"])
        return payload["result"]["data"]["json"]


def require_secret(name, local_default=None):
    value = os.environ.get(name)
    if value:
        return value
    if BASE_URL.startswith("http://127.0.0.1") or BASE_URL.startswith("http://localhost"):
        return local_default
    raise RuntimeError(f"{name} is required for non-local certification")


def health():
    with urllib.request.urlopen(f"{BASE_URL}/api/health", timeout=30) as response:
        return json.load(response)


def assert_identity(build):
    expected = {
        "sha": os.environ.get("EXPECTED_BUILD_SHA"),
        "schemaVersion": os.environ.get("EXPECTED_SCHEMA_VERSION"),
        "capabilityRegistryHash": os.environ.get("EXPECTED_CAPABILITY_REGISTRY_HASH"),
    }
    drift = {key: {"expected": value, "actual": build.get(key)} for key, value in expected.items() if value and build.get(key) != value}
    if drift:
        raise RuntimeError("DEPLOYMENT_DRIFT: " + ",".join(drift.keys()))
    if MODE == "production_smoke" and not expected["sha"]:
        raise RuntimeError("EXPECTED_BUILD_SHA is required for production smoke certification")


def main():
    observed_health = health()
    build = observed_health.get("build", {})
    assert_identity(build)
    client = Client()
    login = client.request("POST", "auth.login", {
        "email": require_secret("AIOS_QA_EMAIL", "admin@aidirector.local"),
        "password": require_secret("AIOS_QA_PASSWORD", "test-admin-123"),
    })
    if not login.get("user", {}).get("isSuperAdmin"):
        raise RuntimeError("QA account must be a super administrator to write certification evidence")
    project_id = os.environ.get("AIOS_QA_PROJECT_ID")
    if not project_id:
        overview = client.request("GET", "admin.overview")
        group = next(group for team in overview for group in team.get("groups", []))
        project = client.request("POST", "projects.create", {
            "groupId": group["id"], "title": f"Agent v5 certification {datetime.now(timezone.utc).isoformat()}",
            "kind": "campaign", "platform": "shorts",
        })
        project_id = project["id"]

    useful = os.environ.get("AIOS_MOBILE_FLOW_OBSERVED") == "1"
    resolution = os.environ.get("AIOS_NL_RESOLUTION_OBSERVED", "1") == "1"
    scenarios = [
        ("project.health", {}),
        ("project.files.list", {}),
        ("project.files.search", {"query": "測試", "limit": 5}),
    ]
    results = []
    first_file_id = os.environ.get("AIOS_QA_FILE_ID")
    for capability_id, tool_input in scenarios:
        certified = client.request("POST", "agents.certifyPracticalCapability", {
            "capabilityId": capability_id, "projectId": project_id, "toolInput": tool_input,
            "mode": MODE, "resolutionObserved": resolution, "usefulObserved": useful,
            "evidence": [{"type": "live_e2e", "ref": f"{BASE_URL}/api/health"}],
        })
        state = certified["certification"]["certificationState"]
        if MODE != "mock" and state == "MOCK_VERIFIED":
            raise RuntimeError(f"{capability_id} produced mock-only evidence in {MODE}")
        results.append({"capabilityId": capability_id, "runId": certified["runId"], "state": state, "receipt": certified["result"].get("receipt")})
        if capability_id == "project.files.list":
            values = certified["result"].get("value") or []
            if values:
                first_file_id = values[0].get("id") or values[0].get("citation", {}).get("fileId")
    if first_file_id:
        certified = client.request("POST", "agents.certifyPracticalCapability", {
            "capabilityId": "project.files.read", "projectId": project_id, "toolInput": {"fileId": first_file_id, "limit": 500},
            "mode": MODE, "resolutionObserved": resolution, "usefulObserved": useful,
            "evidence": [{"type": "authoritative_read_back", "ref": f"project-file:{first_file_id}"}],
        })
        results.append({"capabilityId": "project.files.read", "runId": certified["runId"], "state": certified["certification"]["certificationState"], "receipt": certified["result"].get("receipt")})

    matrix = client.request("GET", "agents.practicalCapabilityHealth")
    if MODE in {"staging", "external_live", "production_smoke"} and not matrix["summary"]["requiredReady"]:
        raise RuntimeError(
            f"LIVE_CERTIFICATION_INCOMPLETE: {matrix['summary']['liveVerified']}/{matrix['summary']['declared']} capabilities; "
            "provide representative QA data (including AIOS_QA_FILE_ID) and all six proof observations"
        )
    evidence = {
        "observedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": BASE_URL,
        "mode": MODE, "deployment": build, "projectId": project_id,
        "executions": results, "matrix": matrix,
        "limitations": [] if first_file_id else ["project.files.read not executed: QA project has no bound readable file"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "mode": MODE, "executed": len(results), "declared": matrix["summary"]["declared"], "liveVerified": matrix["summary"]["liveVerified"], "evidence": str(OUT)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
