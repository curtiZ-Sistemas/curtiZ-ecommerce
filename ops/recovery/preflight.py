"""Cloud-only recovery prerequisites. This does NOT export or restore customer data.

Only fixed diagnostics reach public Actions logs. Credentials are used in memory
or private tmpfs; HTTP bodies and native tool stderr must never be logged.
"""

import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request


class Blocked(Exception):
    """A deliberately non-sensitive, fixed diagnostic."""


def require(condition, message):
    if not condition:
        raise Blocked(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, *, method="GET", bearer=None, payload=None, content_type=None):
    headers = {"User-Agent": "curtiz-recovery/1"}
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=40) as res:
            return res.read(4 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        # Do not include URL, response body, headers or the original exception.
        raise Blocked(f"Remote service rejected request (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Blocked("Remote service unavailable; no credentials were logged.") from None


def json_request(url, *, body=None, bearer=None, method=None):
    raw = request(url, method=method or ("POST" if body is not None else "GET"),
                  bearer=bearer,
                  payload=json.dumps(body).encode() if body is not None else None,
                  content_type="application/json" if body is not None else None)
    require(len(raw) <= 4 * 1024 * 1024, "Remote response exceeded safe limit.")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError):
        raise Blocked("Remote service returned an invalid response.") from None


def configuration(env):
    require(env.get("GITHUB_ACTIONS") == "true"
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_REPOSITORY") == "curtiZ-Sistemas/curtiZ-ecommerce",
            "Recovery access requires the official manual main workflow.")
    require(env.get("RUNNER_ENVIRONMENT") == "github-hosted",
            "Recovery requires an ephemeral GitHub-hosted runner.")
    require(not any(env.get(k, "").lower() in ("true", "1") for k in
                    ("RUNNER_DEBUG", "ACTIONS_STEP_DEBUG", "ACTIONS_RUNNER_DEBUG")),
            "Disable workflow debug logging before recovery access.")
    names = ("BACKUP_SOURCE_PROJECT_REF", "BACKUP_RESTORE_PROJECT_REF",
             "BACKUP_GOOGLE_OWNER", "BACKUP_DRIVE_FOLDER_ID",
             "BACKUP_GOOGLE_CLIENT_ID", "BACKUP_GOOGLE_CLIENT_SECRET",
             "BACKUP_GOOGLE_REFRESH_TOKEN", "BACKUP_SUPABASE_ACCESS_TOKEN",
             "BACKUP_RECOVERY_PASSPHRASE")
    require(all(env.get(k) for k in names), "A required recovery setting is missing.")
    config = {k.removeprefix("BACKUP_").lower(): env[k] for k in names}
    for key in ("source_project_ref", "restore_project_ref"):
        require(re.fullmatch(r"[a-z]{20}", config[key]), "Invalid project reference.")
    require(config["source_project_ref"] != config["restore_project_ref"],
            "Source and restore projects must differ.")
    require(re.fullmatch(r"[A-Za-z0-9_-]{10,200}", config["drive_folder_id"]),
            "Invalid Drive folder reference.")
    require(re.fullmatch(r"[^\s@]+@[^\s@]+", config["google_owner"]),
            "Invalid recovery owner account.")
    phrase = config["recovery_passphrase"]
    require(len(phrase) >= 24 and not any(c in phrase for c in "\r\n\0"),
            "Recovery passphrase must have at least 24 characters and no line breaks.")
    return config


def run_tool(args, *, env=None, input_bytes=None, timeout=60):
    try:
        result = subprocess.run(args, env=env, input=input_bytes,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("Native recovery tool unavailable or timed out.") from None
    require(result.returncode == 0, native_failure(result.stderr))
    return result.stdout


def native_failure(stderr):
    """Classify only known native errors; never return upstream text."""
    message = stderr.decode("utf-8", errors="replace").lower()
    if any(s in message for s in ("certificate verify failed", "root certificate file",
                                  "certificate verification failed", "server certificate")):
        return "Native TLS certificate validation failed; verification remains mandatory."
    if any(s in message for s in ("password authentication failed", "28p01", "sasl authentication")):
        return "Native database authentication failed for the temporary login."
    if "tenant or user not found" in message:
        return "Session pooler could not locate the temporary login."
    if any(s in message for s in ("permission denied", "42501")):
        return "Temporary database login lacks a required read permission."
    if any(s in message for s in ("connection timed out", "timeout expired", "connection refused",
                                  "could not translate host name", "network is unreachable")):
        return "Native database network connection failed or timed out."
    return "Native recovery tool failed; sensitive output was suppressed."


def client_versions():
    for binary in ("psql", "pg_dump", "pg_dumpall", "pg_restore"):
        output = run_tool([f"/usr/lib/postgresql/17/bin/{binary}", "--version"])
        require(re.search(rb"\(PostgreSQL\) 17\.", output),
                "PostgreSQL 17 clients are required.")
    run_tool(["gpg", "--version"])


def pooler_host(entries):
    require(isinstance(entries, list), "Invalid database pooler response.")
    hosts = {item.get("db_host") for item in entries if isinstance(item, dict)
             and item.get("database_type") == "PRIMARY"}
    require(len(hosts) == 1, "Expected exactly one primary pooler host.")
    host = hosts.pop()
    require(isinstance(host, str) and re.fullmatch(
        r"[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com", host),
        "Unexpected database pooler host.")
    return host


def database_environment(config, ref):
    base = f"https://api.supabase.com/v1/projects/{ref}"
    bearer = config["supabase_access_token"]
    host = pooler_host(json_request(base + "/config/database/pooler", bearer=bearer))
    login = json_request(base + "/cli/login-role", bearer=bearer,
                         body={"read_only": True})
    require(isinstance(login, dict), "Invalid temporary database login response.")
    role, password, ttl = (login.get(k) for k in ("role", "password", "ttl_seconds"))
    require(role == "cli_login_supabase_read_only_user"
            and isinstance(password, str) and password
            and type(ttl) is int and ttl >= 120,
            "Invalid or expiring temporary database login.")
    # Never inherit unrelated application credentials or libpq overrides.
    return {"PATH": os.defpath, "LANG": "C.UTF-8", "PGHOST": host,
            "PGPORT": "5432", "PGDATABASE": "postgres", "PGUSER": f"{role}.{ref}",
            "PGPASSWORD": password, "PGSSLMODE": "verify-full",
            "PGSSLROOTCERT": str(Path(__file__).with_name("supabase-ca.crt").resolve()),
            "PGCONNECT_TIMEOUT": "15", "PGAPPNAME": "curtiz-recovery-preflight",
            "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=30000"}


METADATA_QUERY = """
SELECT json_build_object(
 'server_major', current_setting('server_version_num')::int / 10000,
 'backend_tls', (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()),
 'read_only', current_setting('transaction_read_only') = 'on',
 'effective_role', current_user,
 'public_tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n
    ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p')),
 'storage_objects', (SELECT count(*) FROM storage.objects));
"""


def database_metadata(env):
    raw = run_tool(["/usr/lib/postgresql/17/bin/psql", "-X", "-w", "-A", "-t", "-q",
                    "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate",
                    "-c", "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
                    "-c", "SET ROLE supabase_read_only_user",
                    "-c", METADATA_QUERY, "-c", "\\conninfo"], env=env)
    try:
        lines = raw.splitlines()
        result = json.loads(lines[0])
    except ValueError:
        raise Blocked("Invalid native database metadata response.") from None
    # Supavisor terminates client TLS. pg_stat_ssl describes a different leg,
    # between the managed pooler and PostgreSQL, not this libpq connection.
    # Read conninfo from the SAME session; never log its host/user metadata.
    result["tls"] = any(b"SSL connection (protocol: TLS" in line for line in lines[1:])
    require(result.get("server_major") == 17, "Database is not PostgreSQL 17.")
    require(result["tls"] is True, "Native client did not confirm a TLS connection.")
    require(result.get("read_only") is True, "Native session is not read-only.")
    require(result.get("effective_role") == "supabase_read_only_user",
            "Native session did not assume the authorized read-only role.")
    require(all(type(result.get(k)) is int and result[k] >= 0
                for k in ("public_tables", "storage_objects")),
            "Invalid database metadata counts.")
    return result


def validate_databases(source, target):
    require(source["public_tables"] > 0, "Source database unexpectedly empty.")
    require(target["public_tables"] == 0 and target["storage_objects"] == 0,
            "Restore project is not empty; no overwrite is allowed.")


def google_access(config):
    raw = request("https://oauth2.googleapis.com/token", method="POST",
                  payload=urllib.parse.urlencode({
                      "grant_type": "refresh_token",
                      "client_id": config["google_client_id"],
                      "client_secret": config["google_client_secret"],
                      "refresh_token": config["google_refresh_token"]}).encode(),
                  content_type="application/x-www-form-urlencoded")
    try:
        response = json.loads(raw)
    except ValueError:
        raise Blocked("Invalid OAuth refresh response.") from None
    require(isinstance(response.get("access_token"), str) and response["access_token"],
            "OAuth refresh did not issue an access token.")
    scopes = set(response.get("scope", "").split())
    require(scopes == {"https://www.googleapis.com/auth/drive.file"},
            "Unexpected Drive authorization scope.")
    return response["access_token"]


def validate_drive(about, folder, expected_owner):
    require(about.get("user", {}).get("emailAddress", "").lower() == expected_owner.lower(),
            "Drive authorization belongs to another account.")
    require(folder.get("mimeType") == "application/vnd.google-apps.folder"
            and folder.get("ownedByMe") is True and folder.get("trashed") is False
            and folder.get("capabilities", {}).get("canAddChildren") is True,
            "Drive destination is not an owned writable folder.")
    permissions = folder.get("permissions", [])
    require(permissions and all(p.get("type") == "user" and p.get("role") == "owner"
            and p.get("emailAddress", "").lower() == expected_owner.lower()
            for p in permissions), "Drive folder permissions are not private to its owner.")
    quota = about.get("storageQuota", {})
    try:
        free = int(quota["limit"]) - int(quota["usage"])
    except (ValueError, TypeError, KeyError):
        raise Blocked("Drive storage quota could not be verified.") from None
    require(free >= 512 * 1024 * 1024, "Insufficient Drive recovery headroom.")


def crypto_probe(config, token, directory):
    phrase_file = directory / "passphrase"
    phrase_file.write_text(config["recovery_passphrase"], encoding="utf-8")
    phrase_file.chmod(0o600)
    home = directory / "gnupg"
    home.mkdir(mode=0o700)
    common = ["gpg", "--homedir", str(home), "--batch", "--yes", "--no-tty",
              "--pinentry-mode", "loopback", "--no-symkey-cache",
              "--passphrase-file", str(phrase_file)]
    manifest = json.dumps({"kind": "preflight-only-no-customer-data", "format": 1,
                           "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                           "run_id": os.environ["GITHUB_RUN_ID"]}, sort_keys=True).encode()
    encrypted = run_tool(common + ["--symmetric", "--cipher-algo", "AES256",
                                   "--s2k-mode", "3", "--s2k-count", "65011712"],
                         input_bytes=manifest)
    require(encrypted and manifest not in encrypted, "Encryption verification failed.")
    boundary = "curtiz-recovery-preflight-boundary"
    metadata = json.dumps({"name": "preflight-" + os.environ["GITHUB_RUN_ID"] + ".json.gpg",
                           "parents": [config["drive_folder_id"]],
                           "appProperties": {"curtiz_backup_role": "preflight"}}).encode()
    multipart = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode()
                 + metadata + f"\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n".encode()
                 + encrypted + f"\r\n--{boundary}--\r\n".encode())
    raw = request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
                  method="POST", bearer=token, payload=multipart,
                  content_type=f"multipart/related; boundary={boundary}")
    try:
        file_id = json.loads(raw)["id"]
    except (ValueError, KeyError, TypeError):
        raise Blocked("Drive did not confirm the encrypted probe upload.") from None
    require(isinstance(file_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id),
            "Drive returned an invalid file identifier.")
    downloaded = request(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
                         bearer=token)
    require(hashlib.sha256(downloaded).digest() == hashlib.sha256(encrypted).digest(),
            "Encrypted Drive readback checksum mismatch.")
    decrypted = run_tool(common + ["--decrypt"], input_bytes=downloaded)
    require(decrypted == manifest, "Recovery passphrase failed encrypted readback.")


def main():
    stage = "configuration"
    try:
        config = configuration(os.environ)
        require(sys.platform == "linux" and Path("/dev/shm").is_dir(),
                "Private ephemeral tmpfs is required.")
        require(shutil.disk_usage("/dev/shm").free >= 16 * 1024 * 1024,
                "Insufficient private tmpfs headroom.")
        os.umask(0o077)
        stage = "native-clients"
        client_versions()
        stage = "drive-authorization"
        token = google_access(config)
        about = json_request("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota",
                             bearer=token)
        folder = json_request("https://www.googleapis.com/drive/v3/files/" + config["drive_folder_id"]
                              + "?fields=mimeType,ownedByMe,trashed,capabilities(canAddChildren),permissions(type,role,emailAddress)",
                              bearer=token)
        validate_drive(about, folder, config["google_owner"])
        stage = "source-read-only-connection"
        source = database_metadata(database_environment(config, config["source_project_ref"]))
        stage = "restore-read-only-connection"
        target = database_metadata(database_environment(config, config["restore_project_ref"]))
        validate_databases(source, target)
        stage = "encrypted-drive-readback"
        with tempfile.TemporaryDirectory(prefix="curtiz-recovery-", dir="/dev/shm") as temporary:
            crypto_probe(config, token, Path(temporary))
        print("Preflight passed: native PG17 read-only TLS connections, empty isolated target,")
        print("company-owned private Drive, encrypted upload/download and passphrase verified.")
        print("No customer data exported. No backup or restore has been proved by this preflight.")
        return 0
    except Blocked as exc:
        print(f"::error::Recovery preflight blocked at {stage}: {exc}")
        return 1
    except Exception:
        print(f"::error::Recovery preflight blocked at {stage}; sensitive details suppressed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
