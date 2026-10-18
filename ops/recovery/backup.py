"""Native, read-only Supabase export to an encrypted company-owned Drive file.

Run only in the protected manual cloud workflow. Never print database output,
HTTP bodies, filenames, credentials, SQL dumps or Drive upload-session URLs.
"""

import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import preflight as p

PG = "/usr/lib/postgresql/17/bin/"
MAX_BUNDLE = 512 * 1024 * 1024
MAX_OBJECT = 64 * 1024 * 1024
MAX_RESPONSE = 4 * 1024 * 1024


def identifier(value):
    p.require(isinstance(value, str) and value and "\0" not in value,
              "Invalid database identifier.")
    return '"' + value.replace('"', '""') + '"'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def file_hash(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    path.write_bytes(canonical(value))
    path.chmod(0o600)


def native_json(env, sql):
    raw = p.run_tool([PG + "psql", "-X", "-w", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
                      "-v", "VERBOSITY=sqlstate",
                      "-c", "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
                      "-c", "SET ROLE supabase_read_only_user",
                      "-c", sql], env=env, timeout=90)
    try:
        return json.loads(raw)
    except ValueError:
        raise p.Blocked("Invalid native inventory response.") from None


class Snapshot:
    """Keep an exported repeatable-read snapshot alive for all native dumps."""

    def __init__(self, env, directory):
        self.env, self.directory = env, directory
        self.process = None

    def __enter__(self):
        self.errors = (self.directory / "native-private-errors").open("w+b")
        self.process = subprocess.Popen(
            [PG + "psql", "-X", "-w", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
             "-v", "VERBOSITY=sqlstate"], env=self.env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.errors)
        try:
            self.snapshot_id = self.line("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; "
                                         "SET LOCAL ROLE supabase_read_only_user; "
                                         "SELECT pg_export_snapshot();")
            p.require(re.fullmatch(r"[A-Fa-f0-9-]{10,100}", self.snapshot_id),
                      "Invalid exported snapshot identifier.")
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def line(self, sql):
        p.require(self.process is not None and self.process.poll() is None,
                  "Native snapshot session is not available.")
        try:
            self.process.stdin.write((sql + "\n").encode())
            self.process.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(self.process.stdout, selectors.EVENT_READ)
                p.require(bool(selector.select(90)), "Native snapshot query timed out.")
            result = self.process.stdout.readline(MAX_RESPONSE + 1)
        except (OSError, ValueError):
            raise p.Blocked("Native snapshot session failed.") from None
        if not result:
            self.errors.seek(0)
            raise p.Blocked(p.native_failure(self.errors.read(MAX_RESPONSE)))
        p.require(len(result) <= MAX_RESPONSE, "Native snapshot response exceeded safe limit.")
        return result.decode("utf-8").strip()

    def query(self, sql):
        try:
            return json.loads(self.line(sql))
        except ValueError:
            raise p.Blocked("Invalid snapshot inventory response.") from None

    def __exit__(self, *_):
        if self.process is not None:
            try:
                self.process.communicate(input=b"ROLLBACK;\n\\q\n", timeout=5)
            except (OSError, subprocess.TimeoutExpired, ValueError):
                self.process.kill()
                self.process.communicate()
        if hasattr(self, "errors"):
            self.errors.close()


TABLES_SQL = """SELECT coalesce(json_agg(json_build_object(
 'schema', n.nspname, 'name', c.relname, 'owner', pg_get_userbyid(c.relowner),
 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
 'kind', c.relkind::text, 'acl', c.relacl::text) ORDER BY n.nspname,c.relname),'[]')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%'
 AND n.nspname<>'information_schema';"""

STORAGE_SQL = """SELECT coalesce(json_agg(to_jsonb(o) ORDER BY bucket_id,name,id),'[]')
 FROM storage.objects o;"""

ROLES_SQL = """SELECT coalesce(json_agg(json_build_object('name',rolname,
 'login',rolcanlogin,'inherit',rolinherit,'bypassrls',rolbypassrls,
 'create_role',rolcreaterole,'create_db',rolcreatedb,'superuser',rolsuper)
 ORDER BY rolname),'[]') FROM pg_roles WHERE rolname NOT LIKE 'cli_login_%';"""

CATALOG_SQL = """SELECT json_build_object(
 'extensions',(SELECT coalesce(json_agg(json_build_object('name',e.extname,
   'version',e.extversion,'schema',n.nspname) ORDER BY e.extname),'[]')
   FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'columns',(SELECT coalesce(json_agg(json_build_object('schema',n.nspname,
   'table',c.relname,'name',a.attname,'position',a.attnum,
   'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
   'identity',a.attidentity::text,'generated',a.attgenerated::text)
   ORDER BY n.nspname,c.relname,a.attnum),'[]')
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped
   AND c.relkind IN ('r','p') AND n.nspname IN ('auth','storage')),
 'policies',(SELECT coalesce(json_agg(to_jsonb(pol) ORDER BY schemaname,tablename,policyname),'[]')
   FROM pg_policies pol WHERE schemaname NOT LIKE 'pg_%'),
 'managed_custom_triggers',(SELECT coalesce(json_agg(json_build_object(
   'schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid,true))
   ORDER BY n.nspname,c.relname,t.tgname),'[]') FROM pg_trigger t
   JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_proc f ON f.oid=t.tgfoid JOIN pg_namespace fn ON fn.oid=f.pronamespace
   WHERE NOT t.tgisinternal AND n.nspname IN ('auth','storage','realtime')
   AND fn.nspname NOT IN ('auth','storage','realtime')),
 'publications',(SELECT coalesce(json_agg(to_jsonb(pt) ORDER BY pubname,schemaname,tablename),'[]')
   FROM pg_publication_tables pt),
 'role_memberships',(SELECT coalesce(json_agg(json_build_object(
   'role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),
   'admin',admin_option,'inherit',inherit_option,'set',set_option)
   ORDER BY roleid,member),'[]') FROM pg_auth_members
   WHERE pg_get_userbyid(member) NOT LIKE 'cli_login_%'));
"""


def fingerprint_sql(schema, table):
    name = identifier(schema) + "." + identifier(table)
    return ("SELECT json_build_object('count',count(*),'sha256',"
            "encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex')) "
            "FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM "
            + name + " t) hashed_rows;")


def service_key(config, ref):
    keys = p.json_request(f"https://api.supabase.com/v1/projects/{ref}/api-keys?reveal=true",
                          bearer=config["supabase_access_token"])
    p.require(isinstance(keys, list), "Invalid project API key response.")
    matches = [item.get("api_key") for item in keys if item.get("name") == "service_role"
               and item.get("type") == "legacy"]
    p.require(len(matches) == 1 and isinstance(matches[0], str) and matches[0].startswith("eyJ"),
              "An authorized server-side Storage key is unavailable.")
    return matches[0]


def transfer(url, *, method="GET", headers=None, payload=None, destination=None, limit=MAX_RESPONSE):
    req = urllib.request.Request(url, data=payload, headers=headers or {}, method=method)
    try:
        response = urllib.request.build_opener(p.NoRedirect).open(req, timeout=90)
    except urllib.error.HTTPError as exc:
        if exc.code == 308:
            headers = dict(exc.headers)
            exc.close()
            return 308, headers, b""
        exc.close()
        raise p.Blocked(f"Private transfer rejected (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise p.Blocked("Private transfer unavailable; completion is unconfirmed.") from None
    with response:
        if destination is None:
            body = response.read(limit + 1)
            p.require(len(body) <= limit, "Private transfer response exceeded safe limit.")
        else:
            body, size = b"", 0
            with destination.open("xb") as output:
                while chunk := response.read(256 * 1024):
                    size += len(chunk)
                    p.require(size <= limit, "Private transfer exceeded safe size limit.")
                    output.write(chunk)
        return response.status, dict(response.headers), body


def capture_storage(config, objects, directory):
    ref = config["source_project_ref"]
    key = service_key(config, ref)
    headers = {"Authorization": "Bearer " + key, "apikey": key}
    result = []
    total = 0
    for item in objects:
        p.require(isinstance(item.get("bucket_id"), str) and isinstance(item.get("name"), str),
                  "Invalid Storage object reference.")
        try:
            expected_size = int(item["metadata"]["size"])
        except (KeyError, ValueError, TypeError):
            raise p.Blocked("Storage metadata lacks a reliable object size.") from None
        p.require(0 <= expected_size <= MAX_OBJECT, "Storage object exceeds the approved size bound.")
        total += expected_size
        p.require(total <= MAX_BUNDLE // 2, "Storage export exceeds the approved bundle bound.")
        # User-controlled bucket/path never become local filesystem paths.
        local_name = hashlib.sha256(canonical([item["bucket_id"], item["name"]])).hexdigest()
        path = directory / "objects" / local_name
        url = (f"https://{ref}.supabase.co/storage/v1/object/"
               + urllib.parse.quote(item["bucket_id"], safe="") + "/"
               + urllib.parse.quote(item["name"], safe=""))
        transfer(url, headers=headers, destination=path, limit=MAX_OBJECT)
        p.require(path.stat().st_size == expected_size, "Storage bytes differ from the snapshot size.")
        result.append({"bucket": item["bucket_id"], "name": item["name"],
                       "size": expected_size, "sha256": file_hash(path),
                       "blob": "objects/" + local_name})
    return result


def upload_url_allowed(url):
    parsed = urllib.parse.urlsplit(url)
    return (parsed.scheme == "https" and parsed.hostname == "www.googleapis.com"
            and parsed.port in (None, 443) and parsed.username is None and parsed.password is None
            and parsed.path == "/upload/drive/v3/files")


def upload_drive(config, token, path, name, kind):
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=UTF-8",
               "X-Upload-Content-Type": "application/octet-stream",
               "X-Upload-Content-Length": str(path.stat().st_size)}
    metadata = {"name": name, "parents": [config["drive_folder_id"]],
                "appProperties": {"curtiz_backup_role": kind}}
    _, response_headers, _ = transfer(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
        method="POST", headers=headers, payload=canonical(metadata))
    location = next((v for k, v in response_headers.items() if k.lower() == "location"), "")
    p.require(upload_url_allowed(location), "Unexpected private Drive upload destination.")
    total, offset, result = path.stat().st_size, 0, None
    with path.open("rb") as data:
        while chunk := data.read(8 * 1024 * 1024):
            status, response_headers, body = transfer(location, method="PUT", payload=chunk, headers={
                "Authorization": "Bearer " + token, "Content-Type": "application/octet-stream",
                "Content-Range": f"bytes {offset}-{offset + len(chunk) - 1}/{total}"})
            offset += len(chunk)
            if offset < total:
                p.require(status == 308, "Drive did not confirm the expected upload progress.")
                acknowledged = next((v for k, v in response_headers.items() if k.lower() == "range"), "")
                p.require(acknowledged == f"bytes=0-{offset - 1}",
                          "Drive upload acknowledgement differs from the sent bytes.")
            else:
                p.require(status in (200, 201), "Drive did not confirm the completed encrypted upload.")
                try:
                    result = json.loads(body)["id"]
                except (ValueError, TypeError, KeyError):
                    raise p.Blocked("Invalid encrypted upload confirmation.") from None
    p.require(isinstance(result, str) and re.fullmatch(r"[A-Za-z0-9_-]{10,200}", result),
              "Invalid private Drive file identifier.")
    return result


def verify_tar(path, expected):
    seen = set()
    with tarfile.open(path, "r:") as archive:
        for item in archive:
            name = PurePosixPath(item.name)
            p.require(item.isfile() and not name.is_absolute() and ".." not in name.parts
                      and item.name not in seen and item.name in expected,
                      "Archive contains an unexpected or unsafe entry.")
            seen.add(item.name)
            match = expected[item.name]
            p.require(item.size == match["size"], "Archive member size mismatch.")
            with archive.extractfile(item) as stream:
                p.require(hashlib.file_digest(stream, "sha256").hexdigest() == match["sha256"],
                          "Archive member checksum mismatch.")
    p.require(seen == set(expected), "Archive coverage is incomplete.")


def seal_and_store(config, token, directory, bundle, backup_id):
    files = {str(path.relative_to(bundle).as_posix()): {"size": path.stat().st_size,
             "sha256": file_hash(path)} for path in bundle.rglob("*") if path.is_file()}
    p.require(sum(f["size"] for f in files.values()) < MAX_BUNDLE,
              "Recovery bundle exceeds the approved size bound.")
    tar_path = directory / "recovery.tar"
    with tarfile.open(tar_path, "w", format=tarfile.PAX_FORMAT) as archive:
        for name in sorted(files):
            archive.add(bundle / name, arcname=name, recursive=False)
    phrase = directory / "passphrase"
    phrase.write_text(config["recovery_passphrase"], encoding="utf-8")
    phrase.chmod(0o600)
    home = directory / "gnupg"
    home.mkdir(mode=0o700)
    common = ["gpg", "--homedir", str(home), "--batch", "--yes", "--no-tty",
              "--pinentry-mode", "loopback", "--no-symkey-cache", "--passphrase-file", str(phrase)]
    encrypted = directory / "recovery.tar.gpg"
    p.run_tool(common + ["--symmetric", "--cipher-algo", "AES256", "--s2k-mode", "3",
                        "--s2k-count", "65011712", "--output", str(encrypted), str(tar_path)], timeout=180)
    file_id = upload_drive(config, token, encrypted, backup_id + ".tar.gpg", "database-storage")
    downloaded = directory / "downloaded.tar.gpg"
    transfer(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
             headers={"Authorization": "Bearer " + token}, destination=downloaded,
             limit=MAX_BUNDLE + 1024 * 1024)
    p.require(file_hash(downloaded) == file_hash(encrypted), "Stored encrypted copy checksum mismatch.")
    decoded = directory / "downloaded.tar"
    p.run_tool(common + ["--decrypt", "--output", str(decoded), str(downloaded)], timeout=180)
    p.require(file_hash(decoded) == file_hash(tar_path), "Stored recovery archive checksum mismatch.")
    verify_tar(decoded, files)
    return {"drive_file_id": file_id, "encrypted_sha256": file_hash(encrypted),
            "archive_sha256": file_hash(tar_path), "files": files,
            "state": "backup-readback-verified-restore-not-tested"}


def export(config, token, directory):
    source_env = p.database_environment(config, config["source_project_ref"])
    p.database_metadata(source_env)
    bundle = directory / "bundle"
    bundle.mkdir(mode=0o700)
    (bundle / "objects").mkdir(mode=0o700)
    backup_id = ("curtiz-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                 + "-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"])
    print("Recovery export: capture a consistent read-only database snapshot.")
    with Snapshot(source_env, directory) as snapshot:
        tables = snapshot.query(TABLES_SQL)
        catalog = snapshot.query(CATALOG_SQL)
        roles = snapshot.query(ROLES_SQL)
        objects = snapshot.query(STORAGE_SQL)
        fingerprints = []
        for table in tables:
            fingerprints.append({"schema": table["schema"], "table": table["name"],
                                 **snapshot.query(fingerprint_sql(table["schema"], table["name"]))})
        snapshot_arg = "--snapshot=" + snapshot.snapshot_id
        archives = {
            "database.dump": [],
            "application.dump": ["--schema=public", "--schema=private", "--schema=supabase_migrations"],
            "auth-data.dump": ["--schema=auth", "--data-only", "--exclude-table-data=auth.schema_migrations"],
            "storage-data.dump": ["--data-only", "--table=storage.buckets", "--table=storage.objects"],
        }
        for name, options in archives.items():
            p.run_tool([PG + "pg_dump", "--no-password", "--format=custom",
                        "--role=supabase_read_only_user", "--lock-wait-timeout=30s", snapshot_arg,
                        "--file=" + str(bundle / name), *options], env=source_env, timeout=300)
            p.require((bundle / name).stat().st_size > 0, "Native archive is empty.")
            p.run_tool([PG + "pg_restore", "--list", "--file=" + str(bundle / (name + ".toc")),
                        str(bundle / name)])
        roles_bytes = p.run_tool([PG + "pg_dumpall", "--no-password", "--roles-only",
                                  "--no-role-passwords", "--role=supabase_read_only_user"],
                                 env=source_env, timeout=90)
        p.require(roles_bytes, "Native roles export is empty.")
        (bundle / "roles.sql").write_bytes(roles_bytes)
    print("Recovery export: capture actual private and public Storage bytes.")
    storage_files = capture_storage(config, objects, bundle)
    # Fresh credentials only after native exports: no source data or schema writes.
    fresh_env = p.database_environment(config, config["source_project_ref"])
    p.require(native_json(fresh_env, STORAGE_SQL) == objects,
              "Storage metadata changed during export; backup cannot be approved.")
    p.require(native_json(fresh_env, ROLES_SQL) == roles,
              "Role definitions changed during export; backup cannot be approved.")
    configs = {}
    for name, endpoint in (("auth", "config/auth"), ("database", "config/database/postgres"),
                           ("postgrest", "postgrest"), ("storage", "config/storage"),
                           ("realtime", "config/realtime")):
        configs[name] = p.json_request(
            f"https://api.supabase.com/v1/projects/{config['source_project_ref']}/{endpoint}",
            bearer=config["supabase_access_token"])
    write_json(bundle / "project-config-private.json", configs)
    write_json(bundle / "manifest.json", {"format": 1, "backup_id": backup_id,
               "source": config["source_project_ref"], "isolated_restore": config["restore_project_ref"],
               "revision": os.environ["GITHUB_SHA"], "tables": tables, "fingerprints": fingerprints,
               "catalog": catalog, "roles": roles, "storage_metadata": objects,
               "storage_files": storage_files, "restore_proved": False})
    (bundle / "RECOVERY.txt").write_text(
        "curti Z: encrypted database, roles, migration history, actual Storage and project configuration.\n"
        "Keep recovery passphrase in Bitwarden, item: curti Z — Chave de recuperação dos backups.\n"
        "This export alone does not prove isolated restoration. Keep commercial flags disabled.\n"
        "Managed Supabase objects require a reviewed restore plan. Do not blindly restore database.dump.\n"
        "Application encryption keys remain required in the company Cloudflare account/cofre; "
        "this export cannot recover Secrets that their provider does not return.\n", encoding="utf-8")
    print("Recovery export: encrypt, upload and verify the stored copy.")
    receipt = seal_and_store(config, token, directory, bundle, backup_id)
    write_json(directory / "receipt.json", {**receipt, "backup_id": backup_id})
    upload_drive(config, token, directory / "receipt.json", backup_id + ".receipt.json", "receipt")
    print("Encrypted native backup stored and read back; every member checksum verified.")
    print("Includes real Storage bytes. Isolated restoration has NOT yet been proved.")


def main():
    try:
        config = p.configuration(os.environ)
        p.require(os.environ.get("BACKUP_CLOUD_VAULT_CONFIRMED") == "true",
                  "The company cloud cofre must be confirmed before any customer export.")
        p.require(sys.platform == "linux" and Path("/dev/shm").is_dir(),
                  "Cloud-only private tmpfs is required.")
        p.require(shutil.disk_usage("/dev/shm").free >= 2 * 1024 ** 3,
                  "Insufficient ephemeral memory for bounded encrypted backup.")
        os.umask(0o077)
        p.client_versions()
        token = p.google_access(config)
        about = p.json_request("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota", bearer=token)
        folder = p.json_request("https://www.googleapis.com/drive/v3/files/" + config["drive_folder_id"]
            + "?fields=mimeType,ownedByMe,trashed,capabilities(canAddChildren),permissions(type,role,emailAddress)", bearer=token)
        p.validate_drive(about, folder, config["google_owner"])
        with tempfile.TemporaryDirectory(prefix="curtiz-backup-", dir="/dev/shm") as temporary:
            export(config, token, Path(temporary))
        return 0
    except p.Blocked as exc:
        print(f"::error::Encrypted backup not approved: {exc}")
        return 1
    except Exception:
        print("::error::Encrypted backup not approved; sensitive details suppressed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
