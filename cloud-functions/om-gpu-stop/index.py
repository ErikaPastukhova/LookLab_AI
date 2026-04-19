import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


METADATA_TOKEN_URL = (
    "http://169.254.169.254/computeMetadata/v1/"
    "instance/service-accounts/default/token"
)
COMPUTE_API_BASE = "https://compute.api.cloud.yandex.net/compute/v1"


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


def _stop_instance(token: str, instance_id: str) -> str:
    url_candidates = (
        f"{COMPUTE_API_BASE}/instances/{instance_id}:stop",
        f"{COMPUTE_API_BASE}/instances/{instance_id}/stop",
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
        raise RuntimeError(f"Failed to stop instance via API: {last_error}")
    raise RuntimeError("Failed to stop instance: no operation id returned.")


def _last_seen_path() -> Path:
    mount_point = os.getenv("LAST_SEEN_MOUNT_POINT", "media")
    key = os.getenv("LAST_SEEN_KEY", "control/last_seen.json").strip("/")
    return Path("/function/storage") / mount_point / key


def _read_last_seen_epoch() -> float | None:
    path = _last_seen_path()
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    ts = payload.get("ts")
    if not isinstance(ts, str):
        return None
    normalized = ts.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except ValueError:
        return None


def handler(event, context):  # noqa: ANN001
    del event, context
    instance_id = os.getenv("GPU_INSTANCE_ID", "").strip()
    idle_timeout_sec = _int_env("IDLE_TIMEOUT_SEC", 300)

    if not instance_id:
        return _json_response(500, {"ok": False, "error": "GPU_INSTANCE_ID is not configured"})

    try:
        token = _get_iam_token()
        instance = _get_instance(token, instance_id)
        if instance.get("status") != "RUNNING":
            return _json_response(
                200,
                {
                    "ok": True,
                    "action": "skipped_not_running",
                    "instanceStatus": instance.get("status"),
                },
            )

        last_seen_epoch = _read_last_seen_epoch()
        if last_seen_epoch is None:
            return _json_response(
                200,
                {
                    "ok": True,
                    "action": "skipped_no_last_seen",
                    "reason": "last_seen marker file not found or invalid",
                },
            )

        now = time.time()
        idle_sec = int(now - last_seen_epoch)
        if idle_sec < idle_timeout_sec:
            return _json_response(
                200,
                {
                    "ok": True,
                    "action": "skipped_recent_activity",
                    "idleSec": idle_sec,
                    "idleTimeoutSec": idle_timeout_sec,
                },
            )

        operation_id = _stop_instance(token, instance_id)
        return _json_response(
            200,
            {
                "ok": True,
                "action": "stopping",
                "idleSec": idle_sec,
                "idleTimeoutSec": idle_timeout_sec,
                "operationId": operation_id,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _json_response(500, {"ok": False, "error": str(exc)})
