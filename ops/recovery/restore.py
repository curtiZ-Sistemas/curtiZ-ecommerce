"""Restore a stored, authenticated private backup into the empty isolated project.

Never point the write connection at the source. Managed platform schemas are not
recreated. Logs contain fixed diagnostics, never SQL, data, credentials or paths.
"""

import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import time
import urllib.parse

import backup as b
import preflight as p

APPLICATION = {"public", "private", "supabase_migrations"}
MANAGED = {"auth", "storage", "realtime"}


def literal(value):
    p.require(isinstance(value, str) and "\0" not in value, "Invalid restore literal.")
    return "'" + value.replace("'", "''") + "'"


def private_file(config, token, file_id):
    p.require(isinstance(file_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id),
              "Invalid stored recovery file reference.")
    meta = p.json_request("https://www.googleapis.com/drive/v3/files/" + file_id
        + "?fields=ownedByMe,trashed,parents,permissions(type,role,emailAddress)", bearer=token)
    p.require(meta.get("ownedByMe") is True and meta.get("trashed") is False
              and meta.get("parents") == [config["drive_folder_id"]],
              "Stored recovery file is outside the authorized private folder.")
    permissions = meta.get("permissions", [])
    p.require(len(permissions) == 1 and permissions[0].get("type") == "user"
              and permissions[0].get("role") == "owner"
              and permissions[0].get("emailAddress", "").lower() == config["google_owner"].lower(),
              "Stored recovery file permissions are not private to the company.")


def stored_bundle(config, token, directory):
    query = (literal(config["drive_folder_id"]) + " in parents and trashed=false and "
             "appProperties has { key='curtiz_backup_role' and value='receipt' }")
    listing = p.json_request("https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode({
        "q": query, "orderBy": "createdTime desc", "pageSize": 1, "fields": "files(id)"}), bearer=token)
    entries = listing.get("files", [])
    p.require(len(entries) == 1, "No completed stored recovery receipt is available.")
    receipt_id = entries[0]["id"]
    private_file(config, token, receipt_id)
    receipt = p.json_request(f"https://www.googleapis.com/drive/v3/files/{receipt_id}?alt=media", bearer=token)
    p.require(receipt.get("state") == "backup-readback-verified-restore-not-tested",
              "Stored backup has not completed its encrypted readback.")
    file_id = receipt.get("drive_file_id")
    private_file(config, token, file_id)
    encrypted = directory / "stored.tar.gpg"
    b.transfer(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
               headers={"Authorization": "Bearer " + token}, destination=encrypted,
               limit=b.MAX_BUNDLE + 1024 * 1024)
    p.require(b.file_hash(encrypted) == receipt.get("encrypted_sha256"),
              "Stored encrypted archive hash differs from its receipt.")
    phrase = directory / "passphrase"
    phrase.write_text(config["recovery_passphrase"], encoding="utf-8")
    phrase.chmod(0o600)
    home = directory / "gnupg"
    home.mkdir(mode=0o700)
    decoded = directory / "stored.tar"
    p.run_tool(["gpg", "--homedir", str(home), "--batch", "--no-tty", "--pinentry-mode", "loopback",
        "--no-symkey-cache", "--passphrase-file", str(phrase), "--decrypt", "--output", str(decoded),
        str(encrypted)], timeout=180)
    p.require(b.file_hash(decoded) == receipt.get("archive_sha256"),
              "Decrypted stored archive hash differs from its receipt.")
    files = receipt.get("files")
    p.require(isinstance(files, dict) and sum(item["size"] for item in files.values()) < b.MAX_BUNDLE,
              "Stored recovery archive exceeds the approved bound.")
    b.verify_tar(decoded, files)
    bundle = directory / "bundle"
    bundle.mkdir(mode=0o700)
    with tarfile.open(decoded, "r:") as archive:
        # verify_tar already rejected traversal, links, duplicates and unexpected entries.
        for member in archive:
            target = bundle / member.name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.extractfile(member) as source, target.open("xb") as destination:
                shutil.copyfileobj(source, destination)
    manifest = json.loads((bundle / "manifest.json").read_bytes())
    p.require(manifest.get("format") == 1 and manifest.get("source") == config["source_project_ref"]
              and manifest.get("isolated_restore") == config["restore_project_ref"]
              and manifest.get("source") != manifest.get("isolated_restore")
              and manifest.get("backup_id") == receipt.get("backup_id"),
              "Stored recovery manifest does not match the authorized source and isolated target.")
    return bundle, manifest, receipt


def compatible(manifest, target_catalog, target_tables):
    source = manifest["catalog"]
    p.require(source.get("large_objects") == 0, "Large objects need a separately reviewed recovery plan.")
    p.require(source["columns"] == target_catalog["columns"],
              "Managed Auth/Storage column signatures differ; recovery must be reviewed.")
    target_extensions = {item["name"]: item["schema"] for item in target_catalog["extensions"]}
    p.require(all(target_extensions.get(item["name"]) == item["schema"] for item in source["extensions"]),
              "Required source extensions are missing or installed in another schema.")
    p.require(not any(t["schema"] in APPLICATION for t in target_tables),
              "Isolated project contains application tables; no overwrite is allowed.")
    for table in manifest["tables"]:
        if table["schema"] in APPLICATION:
            p.require(table["owner"] == "postgres", "Application ownership requires additional review.")
    expected_policies = {(v["schemaname"], v["tablename"], v["policyname"]): v
                         for v in source["policies"] if v["schemaname"] in MANAGED}
    for policy in target_catalog["policies"]:
        if policy["schemaname"] in MANAGED:
            key = (policy["schemaname"], policy["tablename"], policy["policyname"])
            p.require(expected_policies.get(key) == policy,
                      "Existing managed policy differs; do not overwrite platform authorization.")


def managed_policy_sql(source, target):
    existing = {(v["schemaname"], v["tablename"], v["policyname"]) for v in target["policies"]}
    commands = []
    for policy in source["policies"]:
        schema, table, name = (policy[k] for k in ("schemaname", "tablename", "policyname"))
        if schema not in MANAGED or (schema, table, name) in existing:
            continue
        p.require(policy["cmd"] in {"ALL", "SELECT", "INSERT", "UPDATE", "DELETE"}
                  and policy["permissive"] in {"PERMISSIVE", "RESTRICTIVE"}, "Invalid policy inventory.")
        roles = ",".join("PUBLIC" if role == "public" else b.identifier(role) for role in policy["roles"])
        command = (f"CREATE POLICY {b.identifier(name)} ON {b.identifier(schema)}.{b.identifier(table)} "
                   f"AS {policy['permissive']} FOR {policy['cmd']} TO {roles}")
        if policy["qual"] is not None:
            command += " USING (" + policy["qual"] + ")"
        if policy["with_check"] is not None:
            command += " WITH CHECK (" + policy["with_check"] + ")"
        commands.append(command + ";")
    return "\n".join(commands).encode()


def sql_sections(bundle):
    pre = p.run_tool([b.PG + "pg_restore", "--section=pre-data", "--file=-", str(bundle / "application.dump")])
    p.require(pre.count(b"CREATE SCHEMA public;") == 1, "Unexpected public schema definition in archive.")
    pre = pre.replace(b"CREATE SCHEMA public;", b"-- public already exists in the empty managed project.", 1)
    data = p.run_tool([b.PG + "pg_restore", "--section=data", "--file=-", str(bundle / "application.dump")])
    post = p.run_tool([b.PG + "pg_restore", "--section=post-data", "--file=-", str(bundle / "application.dump")])
    auth = p.run_tool([b.PG + "pg_restore", "--data-only", "--file=-", str(bundle / "auth-data.dump")])
    # Restore bucket configuration before API-uploading the physical objects.
    buckets = p.run_tool([b.PG + "pg_restore", "--data-only", "--table=buckets", "--file=-",
                          str(bundle / "storage-data.dump")])
    return [pre, auth, data, buckets, post]


class TargetWriter:
    # Reuse one provider-issued login throughout a process, avoiding concurrent
    # credential rotations and the pooler's documented propagation window.
    credentials = {}

    def __init__(self, config, reader):
        self.config, self.reader = config, reader
        p.require(config["restore_project_ref"] != config["source_project_ref"],
                  "Source is never a write destination.")
        self.role = "cli_login_postgres"

    def __enter__(self):
        ref = self.config["restore_project_ref"]
        cached = self.credentials.get(ref)
        if cached is None or cached[1] - time.monotonic() < 180:
            # Only supabase_admin can grant postgres. Use the official API that
            # creates the managed CLI login with the correct grantor/expiry.
            login = p.json_request(f"https://api.supabase.com/v1/projects/{ref}/cli/login-role",
                bearer=self.config["supabase_access_token"], body={"read_only": False})
            p.require(isinstance(login, dict) and login.get("role") == self.role
                      and isinstance(login.get("password"), str) and login["password"]
                      and type(login.get("ttl_seconds")) is int and login["ttl_seconds"] >= 300,
                      "Official isolated restore login is unavailable or expiring.")
            self.credentials[ref] = (login["password"], time.monotonic() + login["ttl_seconds"])
            time.sleep(16)
        password = self.credentials[ref][0]
        self.env = {**self.reader, "PGUSER": self.role + "." + ref, "PGPASSWORD": password,
                    "PGOPTIONS": "-c default_transaction_read_only=off -c statement_timeout=60000"}
        return self

    def execute(self, sql):
        # The source reader environment is never accepted by this function.
        p.require(self.env["PGUSER"].endswith("." + self.config["restore_project_ref"]),
                  "Write connection is not the isolated restore project.")
        return p.run_tool([b.PG + "psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1",
                           "-v", "VERBOSITY=sqlstate"], env=self.env,
                          input_bytes=b"SET ROLE postgres; SET search_path=pg_catalog;\n" + sql, timeout=900)

    def __exit__(self, *_):
        # Provider-managed CLI role credentials expire. Do not modify/drop a
        # reserved platform role or reset the original database password.
        pass


def import_database(config, manifest, bundle, reader, target_catalog):
    empty = b.native_json(reader, "SELECT json_build_object('users',(SELECT count(*) FROM auth.users),"
                                 "'objects',(SELECT count(*) FROM storage.objects),"
                                 "'buckets',(SELECT count(*) FROM storage.buckets));")
    p.require(empty == {"users": 0, "objects": 0, "buckets": 0},
              "Isolated Auth or Storage contains useful data; no overwrite is allowed.")
    sections = sql_sections(bundle)
    custom = managed_policy_sql(manifest["catalog"], target_catalog)
    for trigger in manifest["catalog"]["managed_custom_triggers"]:
        p.require(trigger["schema"] in MANAGED, "Unexpected managed trigger schema.")
        custom += ("\n" + trigger["definition"] + ";").encode()
    for publication in manifest["catalog"]["publications"]:
        p.require(publication["schemaname"] in APPLICATION,
                  "Publication requires additional managed-schema review.")
        custom += ("\nALTER PUBLICATION " + b.identifier(publication["pubname"]) + " ADD TABLE "
                   + b.identifier(publication["schemaname"]) + "." + b.identifier(publication["tablename"]) + ";").encode()
    payload = (b"BEGIN; SET LOCAL session_replication_role=replica; "
               b"LOCK TABLE auth.users,storage.buckets,storage.objects IN ACCESS EXCLUSIVE MODE; "
               b"DO $empty$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM storage.buckets) "
               b"OR EXISTS(SELECT 1 FROM storage.objects) THEN RAISE EXCEPTION 'Target is not empty'; END IF; END $empty$;\n"
               + b"\n".join(sections) + b"\n" + custom + b"\nCOMMIT;\n")
    with TargetWriter(config, reader) as writer:
        writer.execute(payload)


def verify_application(manifest, reader):
    expected = [t for t in manifest["tables"] if t["schema"] in APPLICATION]
    actual = [t for t in b.native_json(reader, b.TABLES_SQL) if t["schema"] in APPLICATION]
    p.require(actual == expected, "Restored tables, owners, ACLs or RLS differ from the stored backup.")
    checked = 0
    for table in manifest["fingerprints"]:
        if table["schema"] in APPLICATION or (table["schema"] == "auth" and table["table"] != "schema_migrations"):
            result = b.native_json(reader, b.fingerprint_sql(table["schema"], table["table"]))
            p.require(result == {"count": table["count"], "sha256": table["sha256"]},
                      "Restored application/Auth data differs from the stored snapshot.")
            checked += 1
    catalog = b.native_json(reader, b.CATALOG_SQL)
    for key in ("schemas", "functions", "policies", "managed_custom_triggers", "publications"):
        p.require(catalog[key] == manifest["catalog"][key], "Restored database authorization/catalog differs.")
    return checked


def normalized_objects(objects):
    # Supabase creates a new physical Storage version in the isolated project.
    # Preserve every original logical field; never replace its physical locator.
    return [{key: value for key, value in row.items() if key != "version"} for row in objects]


def restore_storage(config, manifest, bundle, directory, reader):
    ref = config["restore_project_ref"]
    p.require(ref != config["source_project_ref"], "Source is never a Storage upload destination.")
    key = b.service_key(config, ref)
    headers = {"Authorization": "Bearer " + key, "apikey": key}
    current = b.native_json(reader, b.STORAGE_SQL)
    existing = {(row["bucket_id"], row["name"]) for row in current}
    expected = {(row["bucket"], row["name"]) for row in manifest["storage_files"]}
    p.require(len(expected) == len(manifest["storage_files"]) and existing <= expected,
              "Unexpected or duplicate isolated Storage objects; no overwrite is allowed.")
    originals = {(row["bucket_id"], row["name"]): row for row in manifest["storage_metadata"]}
    p.require(set(originals) == expected, "Stored physical objects and SQL metadata differ.")
    for item in manifest["storage_files"]:
        identity = (item["bucket"], item["name"])
        url = (f"https://{ref}.supabase.co/storage/v1/object/"
               + urllib.parse.quote(item["bucket"], safe="") + "/" + urllib.parse.quote(item["name"], safe=""))
        if identity not in existing:
            path = bundle / item["blob"]
            p.require(re.fullmatch(r"objects/[0-9a-f]{64}", item["blob"]),
                      "Unexpected private Storage member reference.")
            p.require(path.stat().st_size == item["size"] and b.file_hash(path) == item["sha256"],
                      "Private Storage backup member no longer matches its manifest.")
            mimetype = originals[identity].get("metadata", {}).get("mimetype", "application/octet-stream")
            p.require(isinstance(mimetype, str) and "\r" not in mimetype and "\n" not in mimetype,
                      "Invalid restored object content type.")
            b.transfer(url, method="POST", headers={**headers, "Content-Type": mimetype,
                       "x-upsert": "false"}, payload=path.read_bytes())
    # Restore original IDs, owners, metadata and timestamps after the provider has
    # allocated the actual bytes. Its physical version must remain the new one.
    columns = [col["name"] for col in manifest["catalog"]["columns"]
               if col["schema"] == "storage" and col["table"] == "objects"
               and not col["generated"] and col["name"] not in {"version", "bucket_id", "name"}]
    p.require("id" in columns and columns, "Storage metadata column inventory is incomplete.")
    assignments = ",".join(b.identifier(col) + "=original." + b.identifier(col) for col in columns)
    values = literal(b.canonical(manifest["storage_metadata"]).decode())
    with TargetWriter(config, reader) as writer:
        writer.execute(("BEGIN; SET LOCAL session_replication_role=replica; "
            "SET LOCAL standard_conforming_strings=on; UPDATE storage.objects restored SET "
            + assignments + " FROM jsonb_populate_recordset(NULL::storage.objects," + values + "::jsonb) original "
            "WHERE restored.bucket_id=original.bucket_id AND restored.name=original.name; COMMIT;").encode())
    p.require(normalized_objects(b.native_json(reader, b.STORAGE_SQL)) == normalized_objects(manifest["storage_metadata"]),
              "Restored logical Storage IDs, ownership or metadata differ from the stored backup.")
    checked = directory / "verified-object"
    for item in manifest["storage_files"]:
        url = (f"https://{ref}.supabase.co/storage/v1/object/"
               + urllib.parse.quote(item["bucket"], safe="") + "/" + urllib.parse.quote(item["name"], safe=""))
        b.transfer(url, headers=headers, destination=checked, limit=b.MAX_OBJECT)
        p.require(checked.stat().st_size == item["size"] and b.file_hash(checked) == item["sha256"],
                  "Restored physical Storage bytes differ from their stored snapshot.")
        checked.unlink()
    bucket = next(t for t in manifest["fingerprints"] if t["schema"] == "storage" and t["table"] == "buckets")
    p.require(b.native_json(reader, b.fingerprint_sql("storage", "buckets")) == {
        "count": bucket["count"], "sha256": bucket["sha256"]}, "Restored bucket configuration differs.")
    return len(expected)


def verify_sequences(bundle, reader):
    data = p.run_tool([b.PG + "pg_restore", "--section=data", "--file=-", str(bundle / "application.dump")])
    sequences = re.findall(rb"^SELECT pg_catalog\.setval\('((?:''|[^'])+)', ([0-9]+), (true|false)\);$",
                           data, flags=re.MULTILINE)
    for name, value, called in sequences:
        relation = name.decode().replace("''", "'")
        # These project-owned sequences are emitted by the authenticated archive.
        parts = relation.split(".")
        p.require(len(parts) == 2 and parts[0].strip('"') in APPLICATION,
                  "Unexpected application sequence namespace.")
        quoted = ".".join(b.identifier(part.strip('"')) for part in parts)
        result = b.native_json(reader, "SELECT json_build_object('last',last_value,'called',is_called) FROM " + quoted)
        p.require(result == {"last": int(value), "called": called == b"true"},
                  "Restored application sequence differs from the native archive.")
    return len(sequences)


def verify_authorization(config, reader):
    with TargetWriter(config, reader) as writer:
        result = writer.execute(b"BEGIN READ ONLY; SET LOCAL ROLE authenticated; "
            b"SET LOCAL request.jwt.claims='{\"sub\":\"00000000-0000-4000-8000-000000000123\",\"role\":\"authenticated\"}'; "
            b"SELECT json_build_object('foreign_orders',count(*)) FROM public.orders; ROLLBACK;\n")
        p.require(json.loads(result) == {"foreign_orders": 0},
                  "Isolated RLS test exposed another customer's orders.")
    private_tables = [t for t in b.native_json(reader, b.TABLES_SQL) if t["schema"] == "private"]
    for table in private_tables:
        relation = literal(b.identifier("private") + "." + b.identifier(table["name"]))
        result = b.native_json(reader, "SELECT json_build_object('anon',has_table_privilege('anon',"
            + relation + ",'SELECT'));")
        p.require(result == {"anon": False}, "Anonymous direct access to a private table is enabled.")


def write_proof(config, token, directory, manifest, receipt, tables, sequences, objects):
    proof = {"format": 1, "state": "verified-isolated-database-storage-restore",
        "backup_id": manifest["backup_id"], "archive_sha256": receipt["archive_sha256"],
        "source": config["source_project_ref"], "isolated_restore": config["restore_project_ref"],
        "verified_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "revision": os.environ["GITHUB_SHA"], "run_id": os.environ["GITHUB_RUN_ID"],
        "application_auth_tables_verified": tables, "sequences_verified": sequences,
        "storage_objects_sha256_verified": objects,
        "checks": ["stored-private-copy", "gpg-integrity", "all-archive-member-hashes", "native-atomic-import",
                   "application-auth-row-hashes", "rls-grants-owners-functions", "sequences",
                   "storage-logical-metadata", "storage-physical-byte-hashes", "cross-customer-rls"],
        "managed_exclusions": ["platform migration histories remain target-owned",
            "Storage physical version locators are regenerated by the provider",
            "platform runtime state is archived but not activated in the isolated target"],
        "configuration": "Source configurations are encrypted in the backup; outbound integrations remain inactive.",
        "commercial_activation_authorized": False}
    path = directory / "isolated-restore-proof.json"
    b.write_json(path, proof)
    file_id = b.upload_drive(config, token, path, manifest["backup_id"] + ".restore-proof.json", "restore-proof")
    private_file(config, token, file_id)
    restored = p.request(f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media", bearer=token)
    p.require(restored == path.read_bytes(), "Stored isolated recovery proof readback differs.")


def main():
    stage = "configuration"
    try:
        config = p.configuration(os.environ)
        p.require(os.environ.get("BACKUP_CLOUD_VAULT_CONFIRMED") == "true"
                  and config["native_auth_mode"] == "dedicated", "Dedicated cloud recovery access is required.")
        p.require(sys.platform == "linux" and Path("/dev/shm").is_dir()
                  and shutil.disk_usage("/dev/shm").free >= 2 * 1024 ** 3, "Private cloud tmpfs is required.")
        os.umask(0o077)
        p.client_versions()
        token = p.google_access(config)
        with tempfile.TemporaryDirectory(prefix="curtiz-restore-", dir="/dev/shm") as temporary:
            directory = Path(temporary)
            stage = "stored-private-copy"
            bundle, manifest, receipt = stored_bundle(config, token, directory)
            reader = p.database_environment(config, config["restore_project_ref"])
            p.database_metadata(reader)
            stage = "managed-compatibility"
            target_catalog = b.native_json(reader, b.CATALOG_SQL)
            target_roles = {role["name"] for role in b.native_json(reader, b.ROLES_SQL)}
            p.require(all(role["name"] in target_roles for role in manifest["roles"]),
                      "Source has custom roles that need a reviewed role recovery plan.")
            target_tables = b.native_json(reader, b.TABLES_SQL)
            if not any(t["schema"] in APPLICATION for t in target_tables):
                compatible(manifest, target_catalog, target_tables)
                stage = "isolated-native-database-import"
                import_database(config, manifest, bundle, reader, target_catalog)
            # Resume only an exact application/Auth/catalog match to this stored
            # backup. Existing customer data is never cleared or overwritten.
            stage = "database-integrity"
            verified = verify_application(manifest, reader)
            sequences = verify_sequences(bundle, reader)
            stage = "isolated-physical-storage"
            objects = restore_storage(config, manifest, bundle, directory, reader)
            stage = "authorization-and-final-integrity"
            verify_authorization(config, reader)
            verify_application(manifest, reader)
            write_proof(config, token, directory, manifest, receipt, verified, sequences, objects)
            print(f"Stored backup restored and verified: {verified} application/Auth tables, "
                  f"{sequences} sequences and {objects} actual Storage objects.")
            print("Recovery proof saved privately in the company Drive. Commercial flags remain disabled.")
        return 0
    except p.Blocked as exc:
        print(f"::error::Isolated restore incomplete at {stage}: {exc}")
        return 1
    except Exception:
        print(f"::error::Isolated restore incomplete at {stage}; sensitive details suppressed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
