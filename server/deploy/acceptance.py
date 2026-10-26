#!/usr/bin/env python3
"""One synthetic, loopback-only Gutters acceptance record and verification backup.

Run with sudo: acceptance.py create ; restart gutters.service ; acceptance.py verify
Owner/guest keys are never printed. Private retry state stays under /var/lib/gutters.
No delete, external provider, public network route, or live-database restore occurs.
"""
import argparse
import base64
import copy
import datetime
import json
import os
import pathlib
import re
import secrets
import sqlite3
import stat
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = "http://127.0.0.1:18965"
ENV_PATH = pathlib.Path("/etc/gutters/gutters.env")
DB_PATH = pathlib.Path("/var/lib/gutters/gutters.sqlite3")
STATE_PATH = pathlib.Path("/var/lib/gutters/acceptance-access.json")
BACKUP_DIR = pathlib.Path("/var/lib/gutters/backups")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
UUID_RE = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
FIELDS = ["name", "phone", "details", "address", "homeSize", "stories", "gutterLength"]
PROMPTS = [
    "What name should John use?",
    "What phone number should John call?",
    "What screen or gutter work do you need?",
    "What is the address for the work?",
    "What is the home size, if you know it?",
    "Is the home single story or double story?",
    "What is the gutter length, if you know it?",
]
QUOTE_COLUMNS = ["conversation_id", "address", "size_of_home", "stories", "gutter_length"]
BUSINESS_QUOTE_COLUMNS = ["address", "size_of_home", "stories", "gutter_length"]


class AcceptanceFailure(Exception):
    pass


def require(condition, label):
    if not condition:
        raise AcceptanceFailure(label)


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def read_env():
    require(ENV_PATH.is_file() and not ENV_PATH.is_symlink(), "private_env_unavailable")
    values = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    require(bool(TOKEN_RE.fullmatch(values.get("GUTTERS_OWNER_TOKEN", ""))), "owner_key_unavailable")
    require(values.get("GUTTERS_PORT", "18965") == "18965", "unexpected_service_port")
    require(pathlib.Path(values.get("GUTTERS_DB_PATH", str(DB_PATH))) == DB_PATH, "unexpected_database_path")
    allowed = [item.strip() for item in values.get("GUTTERS_ALLOWED_ORIGINS", "").split(",") if item.strip()]
    require("https://palle017.github.io" in allowed, "website_origin_not_configured")
    public_origin = values.get("GUTTERS_PUBLIC_ORIGIN", BASE_URL)
    parsed = urllib.parse.urlparse(public_origin)
    require(parsed.scheme in ("http", "https") and parsed.netloc and not parsed.path and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password, "invalid_owner_origin")
    return values, public_origin


def private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "private_state_not_regular")
    require(info.st_mode & 0o077 == 0, "private_state_permissions")


def save_state(state, exclusive=False):
    require(STATE_PATH.parent.is_dir() and not STATE_PATH.parent.is_symlink(), "private_state_directory_unavailable")
    encoded = json.dumps(state, indent=2, sort_keys=True).encode("utf-8")
    if exclusive:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(STATE_PATH, flags, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        return
    private_file(STATE_PATH)
    descriptor, temporary = tempfile.mkstemp(prefix=".acceptance-state-", dir=str(STATE_PATH.parent))
    # mkstemp creates 0600; the containing directory is private service storage.
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, STATE_PATH)
        os.chmod(STATE_PATH, 0o600)
    finally:
        # Normal successful replacement consumes the temporary path. An unexpected
        # failed write is retained as private diagnostic evidence, never printed.
        pass


def new_state():
    intake = {
        "name": "QA - PR2 acceptance",
        "phone": "2025550100",
        "details": "Synthetic PR2 acceptance only; no customer or provider action.",
        "address": "123 Example Street - SYNTHETIC TEST ONLY",
        "homeSize": "SYNTHETIC raw home size - John to define units",
        "stories": "2",
        "gutterLength": "SYNTHETIC raw length - John to determine after quote",
    }
    request = {
        "schemaVersion": 2,
        "conversationId": str(uuid.uuid4()),
        "operationId": str(uuid.uuid4()),
        "accessToken": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("="),
        "intake": intake,
        "answers": [{"field": field, "state": "provided", "answer": intake[field]} for field in FIELDS],
    }
    return {
        "version": 1,
        "createdAt": utc_now(),
        "request": request,
        "ownerReply": {"operationId": str(uuid.uuid4()), "body": "SYNTHETIC John acceptance reply saved to website only."},
        "guestFollowup": {"operationId": str(uuid.uuid4()), "body": "SYNTHETIC customer follow-up saved to website only."},
    }


def load_state(create=False):
    if not STATE_PATH.exists():
        require(create, "private_acceptance_state_missing")
        state = new_state()
        save_state(state, exclusive=True)
        return state
    private_file(STATE_PATH)
    require(STATE_PATH.stat().st_size < 30000, "private_state_size")
    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    require(state.get("version") == 1 and isinstance(state.get("request"), dict), "private_state_invalid")
    request = state["request"]
    require(bool(UUID_RE.fullmatch(request.get("conversationId", ""))) and bool(UUID_RE.fullmatch(request.get("operationId", ""))), "private_state_ids_invalid")
    require(bool(TOKEN_RE.fullmatch(request.get("accessToken", ""))), "private_state_guest_access_invalid")
    require(request.get("intake", {}).get("name") == "QA - PR2 acceptance" and request.get("intake", {}).get("phone") == "2025550100", "private_state_not_synthetic")
    for key in ("ownerReply", "guestFollowup"):
        require(isinstance(state.get(key), dict) and bool(UUID_RE.fullmatch(state[key].get("operationId", ""))), "private_state_reply_invalid")
    return state


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def call(path, origin, token=None, body=None, method=None):
    require(path.startswith("/") and not path.startswith("//"), "invalid_test_route")
    headers = {"Accept": "application/json", "Origin": origin, "User-Agent": "Gutters-PR2-Local-Acceptance/1"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method or ("POST" if data is not None else "GET"))
    try:
        response = OPENER.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    except (urllib.error.URLError, TimeoutError, OSError):
        raise AcceptanceFailure("loopback_http_unavailable") from None
    with response:
        status_code = response.code
        raw = response.read(100001)
    require(len(raw) <= 100000, "http_response_too_large")
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise AcceptanceFailure("http_response_invalid_json") from None
    require(isinstance(payload, dict), "http_response_invalid_shape")
    return status_code, payload


def good_receipt(payload, operation_id, label):
    receipt = payload.get("receipt", {})
    require(payload.get("ok") is True and receipt.get("operationId") == operation_id and isinstance(receipt.get("messageId"), str) and UUID_RE.fullmatch(receipt["messageId"]) and type(receipt.get("sequence")) is int and receipt["sequence"] > 0, label)
    return receipt


def process_identity():
    result = subprocess.run(["systemctl", "show", "gutters.service", "--property=MainPID", "--property=ExecMainStartTimestampMonotonic"], check=False, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=10)
    require(result.returncode == 0, "service_process_identity_unavailable")
    values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    require(values.get("MainPID", "0").isdigit() and int(values.get("MainPID", "0")) > 0 and values.get("ExecMainStartTimestampMonotonic", "0").isdigit() and int(values.get("ExecMainStartTimestampMonotonic", "0")) > 0, "service_process_not_running")
    return values


def expected_quote(state):
    intake = state["request"]["intake"]
    return {"address": intake["address"], "size_of_home": intake["homeSize"], "stories": 2, "gutter_length": intake["gutterLength"]}


def check_owner_read(state, owner_token, owner_origin):
    identifier = state["request"]["conversationId"]
    code, payload = call("/owner/api/conversations/" + identifier, owner_origin, owner_token)
    require(code == 200 and payload.get("ok") is True, "owner_read_failed")
    quote = payload.get("quoteDetails")
    require(isinstance(quote, dict) and set(quote) == set(BUSINESS_QUOTE_COLUMNS) and quote == expected_quote(state), "owner_quote_details_not_exact")
    repair = payload.get("conversation", {}).get("repair", {})
    require(repair.get("name") == "QA - PR2 acceptance" and repair.get("phone") == "2025550100", "owner_contact_not_preserved")
    require(set(repair) == set(FIELDS + ["fieldStates"]) and repair.get("fieldStates") == {field: "provided" for field in FIELDS}, "owner_initial_snapshot_not_exact")
    return payload


def create_phase(state, values, owner_origin):
    request = state["request"]
    owner_token = values["GUTTERS_OWNER_TOKEN"]
    origin = "https://palle017.github.io"
    identifier = request["conversationId"]
    code, payload = call("/healthz", origin)
    require(code == 200 and payload.get("ok") is True and payload.get("storage") == "sqlite", "health_check_failed")
    code, payload = call("/conversations", origin, body=request)
    require(code == 201, "initial_create_failed")
    receipt = good_receipt(payload, request["operationId"], "initial_receipt_invalid")
    if "createReceipt" in state:
        require(state["createReceipt"] == receipt, "initial_receipt_changed")
    state["createReceipt"] = receipt
    save_state(state)
    code, duplicate = call("/conversations", origin, body=request)
    require(code == 201 and duplicate.get("duplicate") is True and good_receipt(duplicate, request["operationId"], "duplicate_receipt_invalid") == receipt, "initial_retry_not_idempotent")
    changed = copy.deepcopy(request)
    changed["intake"]["name"] = "QA - PR2 acceptance changed content"
    changed["answers"][0]["answer"] = changed["intake"]["name"]
    require(call("/conversations", origin, body=changed)[0] == 409, "changed_create_not_conflict")
    owner = check_owner_read(state, owner_token, owner_origin)
    require(len(owner.get("messages", [])) >= 14, "initial_transcript_missing")
    for index, (field, prompt) in enumerate(zip(FIELDS, PROMPTS)):
        guide, answer = owner["messages"][index * 2:index * 2 + 2]
        require(guide.get("role") == "guide" and guide.get("body") == prompt and answer.get("role") == "customer" and answer.get("body") == request["intake"][field], "initial_transcript_not_exact")
    code, reply = call("/owner/api/conversations/" + identifier + "/messages", owner_origin, owner_token, state["ownerReply"])
    require(code == 201, "owner_reply_failed")
    state["ownerReceipt"] = good_receipt(reply, state["ownerReply"]["operationId"], "owner_receipt_invalid")
    save_state(state)
    code, reply = call("/conversations/" + identifier + "/messages", origin, request["accessToken"], state["guestFollowup"])
    require(code == 201, "guest_followup_failed")
    state["guestReceipt"] = good_receipt(reply, state["guestFollowup"]["operationId"], "guest_receipt_invalid")
    state["processBeforeRestart"] = process_identity()
    state["createCompleteAt"] = utc_now()
    save_state(state)
    return {"ok": True, "phase": "create", "conversationId": identifier, "checks": ["loopback_health", "durable_create_receipt", "unchanged_retry_same_receipt", "changed_content_409", "owner_exact_quote_details", "canonical_initial_transcript", "owner_reply_saved", "guest_followup_saved"], "expectedMessages": 16, "next": "restart gutters.service, then run verify"}


def read_connection(path):
    return sqlite3.connect("file:" + urllib.parse.quote(str(path), safe="/") + "?mode=ro", uri=True, timeout=10)


def inspect_database(connection, identifier):
    require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "sqlite_integrity_check_failed")
    columns = [row[1] for row in connection.execute("PRAGMA table_info(quote_details)")]
    require(columns == QUOTE_COLUMNS, "quote_schema_not_exact")
    references = connection.execute("PRAGMA foreign_key_list(quote_details)").fetchall()
    require(any(row[2] == "conversations" and row[3] == "conversation_id" and row[4] == "id" for row in references), "quote_foreign_key_missing")
    require(connection.execute("PRAGMA foreign_key_check").fetchall() == [], "sqlite_foreign_key_check_failed")
    forbidden = {"price", "prices", "rate", "rates", "formula", "formulas", "materials", "material", "estimator", "stage", "source", "marketing"}
    tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    require(set(tables) == {"schema_version", "conversations", "quote_details", "messages", "operations", "rate_limits"}, "unexpected_database_tables")
    for table in tables:
        require(bool(re.fullmatch(r"[a-z_]+", table)), "unexpected_schema_name")
        require(table not in forbidden, "unexpected_business_table")
        names = {row[1] for row in connection.execute('PRAGMA table_info("' + table + '")')}
        require(not names.intersection(forbidden), "unexpected_business_column")
    require(connection.execute("SELECT COUNT(*) FROM conversations WHERE id=?", (identifier,)).fetchone()[0] == 1, "synthetic_request_count_not_one")
    scoped = {table: connection.execute("SELECT COUNT(*) FROM " + table + " WHERE conversation_id=?", (identifier,)).fetchone()[0] for table in ("quote_details", "messages", "operations")}
    require(scoped == {"quote_details": 1, "messages": 16, "operations": 3}, "synthetic_saved_counts_not_exact")
    counts = {table: connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in ("conversations", "quote_details", "messages", "operations")}
    return counts, scoped


def backup_and_readback(state, identifier):
    if not BACKUP_DIR.exists():
        BACKUP_DIR.mkdir(mode=0o700)
    require(BACKUP_DIR.is_dir() and not BACKUP_DIR.is_symlink() and BACKUP_DIR.stat().st_mode & 0o077 == 0, "backup_directory_permissions")
    if "backupPath" not in state:
        filename = "acceptance-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".sqlite3"
        state["backupPath"] = str(BACKUP_DIR / filename)
        save_state(state)
    destination = pathlib.Path(state["backupPath"])
    require(destination.parent == BACKUP_DIR and re.fullmatch(r"acceptance-[0-9]{8}T[0-9]{12}Z\.sqlite3", destination.name), "backup_path_invalid")
    with read_connection(DB_PATH) as source:
        live_counts, scoped = inspect_database(source, identifier)
        if not state.get("backupComplete"):
            # Exclusive creation prevents overwriting any existing backup.
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(destination, flags, 0o600)
            os.close(descriptor)
            with sqlite3.connect(destination) as target:
                source.backup(target)
            os.chmod(destination, 0o600)
            state["backupComplete"] = True
            save_state(state)
    private_file(destination)
    with read_connection(destination) as restored_copy:
        backup_counts, backup_scoped = inspect_database(restored_copy, identifier)
    require(backup_counts == live_counts and backup_scoped == scoped, "backup_readback_counts_differ")
    return {"onlineBackup": True, "restoredCopyReadCheck": True, "backupPath": str(destination), "databaseCounts": live_counts, "syntheticCounts": {"conversations": 1, **scoped}}


def verify_phase(state, values, owner_origin):
    require("createCompleteAt" in state and all(key in state for key in ("createReceipt", "ownerReceipt", "guestReceipt", "processBeforeRestart")), "create_phase_incomplete")
    require(process_identity() != state["processBeforeRestart"], "service_restart_not_observed")
    request = state["request"]
    identifier = request["conversationId"]
    origin = "https://palle017.github.io"
    owner_token = values["GUTTERS_OWNER_TOKEN"]
    code, payload = call("/conversations/" + identifier, origin, request["accessToken"])
    require(code == 200 and payload.get("ok") is True, "guest_history_after_restart_failed")
    messages = payload.get("messages", [])
    require(len(messages) == 16 and [row.get("sequence") for row in messages] == list(range(1, 17)), "history_after_restart_not_contiguous")
    require(messages[14].get("role") == "owner" and messages[14].get("body") == state["ownerReply"]["body"] and messages[15].get("role") == "customer" and messages[15].get("body") == state["guestFollowup"]["body"], "followups_after_restart_not_preserved")
    code, receipt = call("/conversations/" + identifier + "/operations/" + request["operationId"], origin, request["accessToken"])
    require(code == 200 and good_receipt(receipt, request["operationId"], "create_receipt_after_restart_invalid") == state["createReceipt"], "create_receipt_after_restart_changed")
    for key, owner in (("owner", True), ("guest", False)):
        operation = state["ownerReply" if owner else "guestFollowup"]["operationId"]
        prefix = "/owner/api" if owner else ""
        code, receipt = call(prefix + "/conversations/" + identifier + "/operations/" + operation, owner_origin if owner else origin, owner_token if owner else request["accessToken"])
        require(code == 200 and good_receipt(receipt, operation, "followup_receipt_after_restart_invalid") == state[key + "Receipt"], "followup_receipt_after_restart_changed")
    # Replaying the original request after restart must still preserve one record.
    code, duplicate = call("/conversations", origin, body=request)
    require(code == 201 and duplicate.get("duplicate") is True and good_receipt(duplicate, request["operationId"], "restart_retry_receipt_invalid") == state["createReceipt"], "restart_retry_not_idempotent")
    check_owner_read(state, owner_token, owner_origin)
    wrong_guest = ("B" if request["accessToken"][0] == "A" else "A") + request["accessToken"][1:]
    wrong_owner = ("B" if owner_token[0] == "A" else "A") + owner_token[1:]
    require(call("/conversations/" + identifier, origin, wrong_guest)[0] == 404, "bad_guest_not_denied")
    require(call("/owner/api/conversations/" + identifier, owner_origin, wrong_owner)[0] == 401, "bad_owner_not_denied")
    backup = backup_and_readback(state, identifier)
    state["verifyCompleteAt"] = utc_now()
    save_state(state)
    return {"ok": True, "phase": "verify", "conversationId": identifier, "restartObserved": True, "checks": ["history_after_restart", "stable_operation_receipts", "restart_retry_single_record", "owner_exact_quote_details", "bad_guest_404", "bad_owner_401", "sqlite_integrity", "quote_schema_four_business_columns", "quote_foreign_key", "no_rate_or_formula_schema", "online_backup", "restored_copy_readback"], **backup}


def main():
    parser = argparse.ArgumentParser(description="Loopback-only synthetic Gutters acceptance; keys remain private.")
    parser.add_argument("phase", choices=("create", "verify"))
    arguments = parser.parse_args()
    try:
        values, owner_origin = read_env()
        state = load_state(create=arguments.phase == "create")
        summary = create_phase(state, values, owner_origin) if arguments.phase == "create" else verify_phase(state, values, owner_origin)
        print(json.dumps(summary, sort_keys=True))
        return 0
    except AcceptanceFailure as error:
        print(json.dumps({"ok": False, "phase": arguments.phase, "failed": str(error)}, sort_keys=True))
        return 1
    except Exception:
        # Never emit tracebacks, request bodies, HTTP error bodies, or credentials.
        print(json.dumps({"ok": False, "phase": arguments.phase, "failed": "acceptance_internal_error"}, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
