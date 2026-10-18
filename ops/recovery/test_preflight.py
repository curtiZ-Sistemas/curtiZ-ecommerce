import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

import preflight as p


def settings():
    return {
        "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
        "GITHUB_REF": "refs/heads/main", "RUNNER_ENVIRONMENT": "github-hosted",
        "GITHUB_REPOSITORY": "curtiZ-Sistemas/curtiZ-ecommerce",
        "BACKUP_SOURCE_PROJECT_REF": "a" * 20,
        "BACKUP_RESTORE_PROJECT_REF": "b" * 20,
        "BACKUP_GOOGLE_OWNER": "owner@example.invalid",
        "BACKUP_DRIVE_FOLDER_ID": "synthetic_folder_12345",
        "BACKUP_GOOGLE_CLIENT_ID": "synthetic-client",
        "BACKUP_GOOGLE_CLIENT_SECRET": "synthetic-client-secret",
        "BACKUP_GOOGLE_REFRESH_TOKEN": "synthetic-refresh",
        "BACKUP_SUPABASE_ACCESS_TOKEN": "synthetic-pat",
        "BACKUP_RECOVERY_PASSPHRASE": "synthetic-recovery-passphrase-for-tests-only",
    }


class ConfigurationTests(unittest.TestCase):
    def test_official_manual_cloud_main_only(self):
        self.assertEqual(p.configuration(settings())["source_project_ref"], "a" * 20)
        for key, value in (("GITHUB_ACTIONS", "false"), ("GITHUB_EVENT_NAME", "pull_request"),
                           ("GITHUB_REF", "refs/heads/untrusted"),
                           ("GITHUB_REPOSITORY", "another/repository"),
                           ("RUNNER_ENVIRONMENT", "self-hosted"),
                           ("RUNNER_DEBUG", "true"), ("RUNNER_DEBUG", "1"),
                           ("ACTIONS_STEP_DEBUG", "true"),
                           ("ACTIONS_RUNNER_DEBUG", "TRUE")):
            with self.subTest(key=key):
                env = settings()
                env[key] = value
                with self.assertRaises(p.Blocked):
                    p.configuration(env)

    def test_missing_setting_fails_closed(self):
        for key in settings():
            if key.startswith("BACKUP_"):
                env = settings()
                del env[key]
                with self.subTest(key=key), self.assertRaises(p.Blocked):
                    p.configuration(env)

    def test_source_target_identity_is_rejected(self):
        env = settings()
        env["BACKUP_RESTORE_PROJECT_REF"] = env["BACKUP_SOURCE_PROJECT_REF"]
        with self.assertRaises(p.Blocked):
            p.configuration(env)

    def test_untrusted_identifiers_rejected(self):
        for key, value in (("BACKUP_SOURCE_PROJECT_REF", "../source"),
                           ("BACKUP_RESTORE_PROJECT_REF", "a" * 19),
                           ("BACKUP_DRIVE_FOLDER_ID", "a/b?secret=value"),
                           ("BACKUP_GOOGLE_OWNER", "broken\n@example.invalid")):
            env = settings()
            env[key] = value
            with self.subTest(key=key), self.assertRaises(p.Blocked):
                p.configuration(env)

    def test_passphrase_restrictions(self):
        for value in ("short", "x" * 30 + "\n", "x" * 30 + "\0"):
            env = settings()
            env["BACKUP_RECOVERY_PASSPHRASE"] = value
            with self.assertRaises(p.Blocked):
                p.configuration(env)


class DatabaseTests(unittest.TestCase):
    def test_official_public_ca_is_loadable_and_matches_dashboard_fingerprint(self):
        path = Path(p.__file__).with_name("supabase-ca.crt")
        pem = path.read_text(encoding="ascii")
        self.assertNotIn("PRIVATE KEY", pem)
        der = ssl.PEM_cert_to_DER_cert(pem)
        self.assertEqual(hashlib.sha256(der).hexdigest(),
                         "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa")
        context = ssl.create_default_context(cafile=str(path))
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_only_primary_supabase_host(self):
        rows = [{"database_type": "PRIMARY", "db_host": "aws-1-sa-east-1.pooler.supabase.com"}]
        self.assertEqual(p.pooler_host(rows), rows[0]["db_host"])
        for bad in (None, [], [{"database_type": "REPLICA", "db_host": rows[0]["db_host"]}],
                    [{"database_type": "PRIMARY", "db_host": "localhost"}],
                    [{"database_type": "PRIMARY", "db_host": "pooler.supabase.com.attacker.invalid"}],
                    rows + [{"database_type": "PRIMARY", "db_host": "another.pooler.supabase.com"}]):
            with self.subTest(rows=bad), self.assertRaises(p.Blocked):
                p.pooler_host(bad)

    def test_temporary_login_is_read_only_and_password_not_in_arguments(self):
        cfg = p.configuration(settings())
        responses = [[{"database_type": "PRIMARY", "db_host": "aws-1.pooler.supabase.com"}],
                     {"role": "cli_login_supabase_read_only_user", "password": "synthetic-db-password", "ttl_seconds": 600}]
        with patch.object(p, "json_request", side_effect=responses) as request:
            env = p.database_environment(cfg, cfg["source_project_ref"])
        self.assertEqual(request.call_args.kwargs["body"], {"read_only": True})
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(Path(env["PGSSLROOTCERT"]), Path(p.__file__).with_name("supabase-ca.crt").resolve())
        self.assertEqual(env["PGPORT"], "5432")
        self.assertIn("default_transaction_read_only=on", env["PGOPTIONS"])
        self.assertNotIn("BACKUP_SUPABASE_ACCESS_TOKEN", env)
        metadata = {"server_major": 17, "tls": True, "read_only": True,
                    "effective_role": "supabase_read_only_user",
                    "public_tables": 1, "storage_objects": 0}
        with patch.object(p, "run_tool", return_value=json.dumps(metadata).encode()
                          + b'\nSSL connection (protocol: TLSv1.3, cipher: synthetic)\n') as run:
            self.assertEqual(p.database_metadata(env), metadata)
        self.assertNotIn("synthetic-db-password", " ".join(run.call_args.args[0]))
        self.assertIn("SET ROLE supabase_read_only_user", run.call_args.args[0])

    def test_invalid_temporary_login_is_rejected(self):
        cfg = p.configuration(settings())
        login = {"role": "cli_login_supabase_read_only_user", "password": "synthetic", "ttl_seconds": 600}
        for field, value in (("role", "postgres"), ("role", "cli_login_bad.otherref"),
                             ("password", ""), ("ttl_seconds", 1), ("ttl_seconds", True)):
            bad = {**login, field: value}
            with patch.object(p, "json_request", side_effect=[
                [{"database_type": "PRIMARY", "db_host": "aws-1.pooler.supabase.com"}], bad
            ]), self.assertRaises(p.Blocked):
                p.database_environment(cfg, cfg["source_project_ref"])

    def test_no_overwrite_of_populated_restore(self):
        p.validate_databases({"public_tables": 1}, {"public_tables": 0, "storage_objects": 0})
        for source, target in (({"public_tables": 0}, {"public_tables": 0, "storage_objects": 0}),
                               ({"public_tables": 1}, {"public_tables": 1, "storage_objects": 0}),
                               ({"public_tables": 1}, {"public_tables": 0, "storage_objects": 1})):
            with self.assertRaises(p.Blocked):
                p.validate_databases(source, target)

    def test_metadata_tls_read_only_version_are_required(self):
        base = {"server_major": 17, "tls": True, "read_only": True,
                "effective_role": "supabase_read_only_user",
                "public_tables": 1, "storage_objects": 0}
        for key, value in (("server_major", 16), ("read_only", False),
                           ("public_tables", -1), ("storage_objects", True),
                           ("effective_role", "postgres")):
            with patch.object(p, "run_tool", return_value=json.dumps({**base, key: value}).encode()
                              + b'\nSSL connection (protocol: TLSv1.3, cipher: synthetic)\n'):
                with self.assertRaises(p.Blocked):
                    p.database_metadata({})

    def test_pooler_backend_tls_is_distinct_from_verified_native_client_tls(self):
        metadata = {"server_major": 17, "backend_tls": False, "read_only": True,
                    "effective_role": "supabase_read_only_user", "public_tables": 1,
                    "storage_objects": 0}
        raw = json.dumps(metadata).encode()
        with patch.object(p, "run_tool", return_value=raw + b'\nSSL connection (protocol: TLSv1.3, cipher: synthetic)\n'):
            self.assertTrue(p.database_metadata({})["tls"])
        with patch.object(p, "run_tool", return_value=raw + b'\nconnection metadata without TLS\n'):
            with self.assertRaises(p.Blocked):
                p.database_metadata({})


class DriveTests(unittest.TestCase):
    def setUp(self):
        self.owner = "owner@example.invalid"
        self.about = {"user": {"emailAddress": self.owner},
                      "storageQuota": {"limit": str(1024 ** 3), "usage": "1"}}
        self.folder = {"mimeType": "application/vnd.google-apps.folder", "ownedByMe": True,
                       "trashed": False, "capabilities": {"canAddChildren": True},
                       "permissions": [{"type": "user", "role": "owner", "emailAddress": self.owner}]}

    def test_private_owner_folder(self):
        p.validate_drive(self.about, self.folder, self.owner)

    def test_public_shared_domain_or_extra_user_rejected(self):
        for permission in ({"type": "anyone", "role": "reader"},
                           {"type": "domain", "role": "reader"},
                           {"type": "user", "role": "writer", "emailAddress": self.owner},
                           {"type": "user", "role": "owner", "emailAddress": "another@example.invalid"}):
            folder = copy.deepcopy(self.folder)
            folder["permissions"].append(permission)
            with self.assertRaises(p.Blocked):
                p.validate_drive(self.about, folder, self.owner)

    def test_invalid_destination_or_owner_rejected(self):
        for key, value in (("ownedByMe", False), ("trashed", True), ("mimeType", "text/plain"),
                           ("capabilities", {"canAddChildren": False}), ("permissions", [])):
            with self.assertRaises(p.Blocked):
                p.validate_drive(self.about, {**self.folder, key: value}, self.owner)
        with self.assertRaises(p.Blocked):
            p.validate_drive(self.about, self.folder, "another@example.invalid")

    def test_quota_missing_or_insufficient_rejected(self):
        for quota in ({}, {"limit": "invalid", "usage": "0"}, {"limit": "1", "usage": "1"}):
            with self.assertRaises(p.Blocked):
                p.validate_drive({**self.about, "storageQuota": quota}, self.folder, self.owner)

    def test_limited_oauth_scope_is_required(self):
        for scope in ("", "https://www.googleapis.com/auth/drive",
                      "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive"):
            with patch.object(p, "request", return_value=json.dumps(
                {"access_token": "synthetic", "scope": scope}).encode()), self.assertRaises(p.Blocked):
                p.google_access(p.configuration(settings()))

    @unittest.skipUnless(shutil.which("gpg"), "GPG integration runs on Linux CI")
    def test_real_encryption_and_download_roundtrip_without_customer_data(self):
        encrypted = None

        def drive(url, **kwargs):
            nonlocal encrypted
            if kwargs.get("method") == "POST":
                payload = kwargs["payload"]
                encrypted = payload.split(b"Content-Type: application/octet-stream\r\n\r\n", 1)[1]
                encrypted = encrypted.rsplit(b"\r\n--curtiz-recovery-preflight-boundary--", 1)[0]
                self.assertNotIn(b"preflight-only-no-customer-data", encrypted)
                return b'{"id":"synthetic_file_12345"}'
            return encrypted

        with tempfile.TemporaryDirectory() as folder, patch.object(p, "request", side_effect=drive), \
                patch.dict(os.environ, {"GITHUB_RUN_ID": "synthetic123"}):
            p.crypto_probe(p.configuration(settings()), "synthetic-token", Path(folder))


class SuppressionTests(unittest.TestCase):
    def test_diagnostics_classify_errors_without_returning_private_details(self):
        cases = (
            (b'certificate verify failed secret-host secret-token', 'TLS certificate'),
            (b'password authentication failed for user "private-user"', 'authentication failed'),
            (b'Tenant or user not found private-project', 'could not locate'),
            (b'ERROR: 42501 private-table private-user', 'read permission'),
            (b'connection timed out private-host', 'network connection'),
            (b'unrecognized sensitive diagnostic', 'sensitive output was suppressed'),
        )
        for stderr, expected in cases:
            with self.subTest(expected=expected):
                result = p.native_failure(stderr)
                self.assertIn(expected, result)
                self.assertNotIn('private-', result)
                self.assertNotIn('secret-', result)
                self.assertNotIn('unrecognized', result)

    def test_remote_body_and_url_not_in_error(self):
        error = urllib.error.HTTPError("https://example.invalid/secret", 403, "sensitive", {}, None)
        with patch.object(p.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(p.Blocked) as caught:
                p.request("https://example.invalid/secret", bearer="synthetic-token")
        self.assertEqual(str(caught.exception), "Remote service rejected request (HTTP 403).")

    def test_native_stderr_not_in_error(self):
        result = subprocess.CompletedProcess(["synthetic"], 1, b"secret output", b"secret stderr")
        with patch.object(p.subprocess, "run", return_value=result):
            with self.assertRaises(p.Blocked) as caught:
                p.run_tool(["synthetic"])
        self.assertNotIn("secret stderr", str(caught.exception))
        self.assertNotIn("secret output", str(caught.exception))

    def test_no_redirect_of_bearer_credentials(self):
        self.assertIsNone(p.NoRedirect().redirect_request(None, None, 302, "", {},
                                                          "https://attacker.invalid"))


if __name__ == "__main__":
    unittest.main()
