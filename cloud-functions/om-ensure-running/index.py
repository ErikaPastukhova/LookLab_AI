import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


METADATA_TOKEN_URL = (
    "http://169.254.169.254/computeMetadata/v1/"
    "instance/service-accounts/default/token"
)
COMPUTE_API_BASE = "https://compute.api.cloud.yandex.net/compute/v1"
OPERATION_API_BASE = "https://operation.api.cloud.yandex.net/operations"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _json_response(status_code: int, payload: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def _request_json(url: str, *, method: str = "GET", data: dict | None = None, headers: dict | None = None) -> dict:
    encoded = None
    request_headers = dict(headers or {})
    if data is not None:
        encoded = json.dumps(data).encode("utf-8")
        request_headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=encoded, headers=request_headers, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read() or b"{}"
    return json.loads(raw.decode("utf-8"))


def _get_iam_token() -> str:
    response = _request_json(
        METADATA_TOKEN_URL,
        headers={"Metadata-Flavor": "Google"},
    )
    token = response.get("access_token")
    if not token:
        raise RuntimeError("Metadata token endpoint returned no access_token.")
    return token


def _authorized_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _get_instance(token: str, instance_id: str) -> dict:
    return _request_json(
        f"{COMPUTE_API_BASE}/instances/{instance_id}",
        headers=_authorized_headers(token),
    )


def _start_instance(token: str, instance_id: str) -> str:
    url_candidates = (
        f"{COMPUTE_API_BASE}/instances/{instance_id}:start",
        f"{COMPUTE_API_BASE}/instances/{instance_id}/start",
    )
    last_error = None
    for url in url_candidates:
        try:
            operation = _request_json(url, method="POST", headers=_authorized_headers(token))
            op_id = operation.get("id")
            if op_id:
                return op_id
        except urllib.error.HTTPError as exc:
            last_error = exc
    if last_error:
        raise RuntimeError(f"Failed to start instance via API: {last_error}")
    raise RuntimeError("Failed to start instance: no operation id returned.")


def _wait_operation(token: str, operation_id: str, timeout_sec: int = 120) -> dict:
    deadline = time.time() + timeout_sec
    last = {}
    while time.time() < deadline:
        last = _request_json(
            f"{OPERATION_API_BASE}/{operation_id}",
            headers=_authorized_headers(token),
        )
        if last.get("done"):
            if "error" in last:
                raise RuntimeError(f"Operation finished with error: {last['error']}")
            return last
        time.sleep(2)
    raise TimeoutError(f"Operation {operation_id} did not complete in {timeout_sec}s.")


def _wait_health_ready(url: str, timeout_sec: int, retry_sec: int) -> tuple[bool, dict]:
    deadline = time.time() + timeout_sec
    last_payload: dict = {}
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as response:
                if 200 <= response.status < 300:
                    raw = response.read() or b"{}"
                    payload = json.loads(raw.decode("utf-8"))
                    if isinstance(payload, dict):
                        last_payload = payload
                        if payload.get("warmup_error"):
                            raise RuntimeError(f"GPU warmup failed: {payload['warmup_error']}")
                        if payload.get("ready") is True:
                            return True, last_payload
        except RuntimeError:
            raise
        except Exception:
            pass
        time.sleep(max(1, retry_sec))
    return False, last_payload


def _last_seen_path() -> Path:
    mount_point = os.getenv("LAST_SEEN_MOUNT_POINT", "media")
    key = os.getenv("LAST_SEEN_KEY", "control/last_seen.json").strip("/")
    return Path("/function/storage") / mount_point / key


def _write_last_seen() -> None:
    path = _last_seen_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": "ensure-running",
    }
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload), encoding="utf-8")
    tmp_path.replace(path)


def handler(event, context):  # noqa: ANN001
    del event, context
    instance_id = os.getenv("GPU_INSTANCE_ID", "").strip()
    health_url = os.getenv("GPU_HEALTH_URL", "").strip()
    start_wait_sec = _int_env("START_WAIT_SEC", 240)
    health_retry_sec = _int_env("HEALTH_RETRY_SEC", 5)
    health_probe_timeout_sec = _int_env("HEALTH_PROBE_TIMEOUT_SEC", 8)

    if not instance_id:
        return _json_response(500, {"ok": False, "error": "GPU_INSTANCE_ID is not configured"})
    if not health_url:
        return _json_response(500, {"ok": False, "error": "GPU_HEALTH_URL is not configured"})

    try:
        token = _get_iam_token()
        instance = _get_instance(token, instance_id)
        status_before = instance.get("status", "UNKNOWN")

        if status_before != "RUNNING":
            try:
                operation_id = _start_instance(token, instance_id)
                _wait_operation(token, operation_id, timeout_sec=min(start_wait_sec, 20))
            except Exception:
                # Start operation is best effort here; we still return 202 to allow client polling.
                pass

            _write_last_seen()
            return _json_response(
                202,
                {
                    "ok": True,
                    "status": "starting",
                    "ready": False,
                    "instanceStatus": status_before,
                    "healthUrl": health_url,
                },
            )

        ready, health_payload = _wait_health_ready(
            health_url,
            timeout_sec=health_probe_timeout_sec,
            retry_sec=max(1, min(health_retry_sec, health_probe_timeout_sec)),
        )
        _write_last_seen()
        return _json_response(
            200 if ready else 202,
            {
                "ok": True,
                "status": "ready" if ready else "running_not_ready",
                "ready": ready,
                "instanceStatus": instance.get("status"),
                "healthUrl": health_url,
                "wasRunning": True,
                "health": health_payload,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _json_response(500, {"ok": False, "error": str(exc)})
