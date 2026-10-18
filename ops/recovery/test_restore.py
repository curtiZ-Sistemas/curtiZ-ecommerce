"""Recovery guards use synthetic data only; no cloud credentials or network."""

import copy
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

import preflight as p
import restore as r
import backup as b
from test_preflight import settings


def catalog():
    return {"large_objects": 0, "columns": [{"schema": "auth", "name": "id"}],
            "extensions": [{"name": "pgcrypto", "schema": "extensions"}], "policies": []}


class RestoreGuards(unittest.TestCase):
    def test_application_publications_preserved_and_only_proven_empty_runtime_skipped(self):
        application = {"pubname": "supabase_realtime", "schemaname": "public", "tablename": "support_messages",
                       "rowfilter": None}
        runtime = {"pubname": "supabase_realtime_messages_publication", "schemaname": "realtime",
                   "tablename": "messages_2026_09_06"}
        manifest = {"catalog": {"publications": [application, runtime]}, "fingerprints": [
            {"schema": "realtime", "table": "messages", "count": 0},
            {"schema": "realtime", "table": "messages_2026_09_06", "count": 0}]}
        self.assertEqual(r.application_publications(manifest), [application])
        for changed in (
            {**manifest, "fingerprints": []},
            {**manifest, "fingerprints": [{"schema": "realtime", "table": "messages", "count": 1}]},
            {**manifest, "catalog": {"publications": [{**runtime, "schemaname": "auth"}]}},
            {**manifest, "catalog": {"publications": [{**runtime, "pubname": "unknown"}]}},
        ):
            with self.subTest(manifest=changed), self.assertRaises(p.Blocked):
                r.application_publications(changed)

    def test_literals_quote_apostrophes_and_reject_nuls(self):
        self.assertEqual(r.literal("synthetic'path"), "'synthetic''path'")
        with self.assertRaises(p.Blocked):
            r.literal("unsafe\0text")

    def test_compatibility_rejects_existing_data_and_platform_drift(self):
        manifest = {"catalog": catalog(), "tables": [{"schema": "public", "owner": "postgres"}]}
        r.compatible(manifest, catalog(), [])
        with self.assertRaises(p.Blocked):
            r.compatible(manifest, catalog(), [{"schema": "public"}])
        for field, value in (("columns", []), ("extensions", []),
                             ("policies", [{"schemaname": "storage", "tablename": "objects", "policyname": "unexpected"}])):
            changed = {**catalog(), field: value}
            with self.subTest(field=field), self.assertRaises(p.Blocked):
                r.compatible(manifest, changed, [])
        for field, value in (("large_objects", 1),):
            changed = copy.deepcopy(manifest)
            changed["catalog"][field] = value
            with self.assertRaises(p.Blocked):
                r.compatible(changed, catalog(), [])
        changed = {**manifest, "tables": [{"schema": "public", "owner": "unknown"}]}
        with self.assertRaises(p.Blocked):
            r.compatible(changed, catalog(), [])

    def test_managed_policies_preserve_roles_and_conditions_without_duplicate_creation(self):
        policy = {"schemaname": "storage", "tablename": "objects", "policyname": 'own"objects',
                  "cmd": "SELECT", "permissive": "PERMISSIVE", "roles": ["authenticated"],
                  "qual": "owner_id = (select auth.uid())::text", "with_check": None}
        sql = r.managed_policy_sql({"policies": [policy]}, {"policies": []})
        self.assertIn(b'CREATE POLICY "own""objects" ON "storage"."objects"', sql)
        self.assertIn(b'TO "authenticated" USING (owner_id', sql)
        self.assertEqual(r.managed_policy_sql({"policies": [policy]}, {"policies": [policy]}), b"")
        with self.assertRaises(p.Blocked):
            r.managed_policy_sql({"policies": [{**policy, "cmd": "SELECT; DROP TABLE orders"}]}, {"policies": []})

    def test_physical_version_is_the_only_logical_storage_exception(self):
        first = [{"id": "original", "name": "synthetic", "owner_id": "owner", "version": "source"}]
        second = [{**first[0], "version": "new-provider-version"}]
        self.assertEqual(r.normalized_objects(first), r.normalized_objects(second))
        self.assertNotEqual(r.normalized_objects(first), r.normalized_objects([{**second[0], "owner_id": "other"}]))

    def test_source_is_never_accepted_as_restore_write_destination(self):
        with patch.object(p, "json_request") as request, self.assertRaises(p.Blocked):
            r.TargetWriter({"source_project_ref": "a" * 20, "restore_project_ref": "a" * 20}, {})
        request.assert_not_called()

    def test_writer_uses_only_official_target_login_and_reuses_without_rotation(self):
        config = {"source_project_ref": "a" * 20, "restore_project_ref": "b" * 20,
                  "supabase_access_token": "synthetic"}
        login = {"role": "cli_login_postgres", "password": "synthetic-writer", "ttl_seconds": 600}
        r.TargetWriter.credentials.clear()
        try:
            with patch.object(p, "json_request", return_value=login) as request, patch.object(r.time, "sleep"):
                with r.TargetWriter(config, {}) as first:
                    self.assertEqual(first.env["PGUSER"], "cli_login_postgres." + "b" * 20)
                with r.TargetWriter(config, {}) as second:
                    self.assertEqual(second.env["PGPASSWORD"], "synthetic-writer")
            self.assertEqual(request.call_count, 1)
            self.assertIn("/" + "b" * 20 + "/cli/login-role", request.call_args.args[0])
            self.assertEqual(request.call_args.kwargs["body"], {"read_only": False})
            r.TargetWriter.credentials.clear()
            with patch.object(p, "json_request", return_value={**login, "role": "postgres"}), self.assertRaises(p.Blocked):
                with r.TargetWriter(config, {}):
                    pass
        finally:
            r.TargetWriter.credentials.clear()

    def test_public_or_foreign_drive_files_are_rejected(self):
        config = {"drive_folder_id": "synthetic-folder", "google_owner": "owner@example.invalid"}
        meta = {"ownedByMe": True, "trashed": False, "parents": ["synthetic-folder"],
                "permissions": [{"type": "user", "role": "owner", "emailAddress": "owner@example.invalid"}]}
        with patch.object(p, "json_request", return_value=meta):
            r.private_file(config, "synthetic", "synthetic_file_12345")
        for changed in ({**meta, "parents": ["another-folder"]}, {**meta, "ownedByMe": False},
                        {**meta, "permissions": [*meta["permissions"], {"type": "anyone", "role": "reader"}]}):
            with patch.object(p, "json_request", return_value=changed), self.assertRaises(p.Blocked):
                r.private_file(config, "synthetic", "synthetic_file_12345")


class StoredCopyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("gpg"), "Actual GPG readback runs in Linux CI")
    def test_reads_previously_stored_ciphertext_and_rejects_tampered_receipt(self):
        config = p.configuration(settings())
        backup_id = "synthetic-stored-backup"
        with tempfile.TemporaryDirectory() as source_folder, tempfile.TemporaryDirectory() as restore_folder:
            directory = Path(source_folder)
            bundle = directory / "bundle"
            bundle.mkdir()
            manifest = {"format": 1, "source": config["source_project_ref"],
                        "isolated_restore": config["restore_project_ref"], "backup_id": backup_id}
            b.write_json(bundle / "manifest.json", manifest)
            (bundle / "synthetic.dump").write_bytes(b"synthetic archived bytes")
            def read_uploaded(_url, **kwargs):
                kwargs["destination"].write_bytes((directory / "recovery.tar.gpg").read_bytes())
                return 200, {}, b""
            with patch.object(b, "upload_drive", return_value="synthetic_file_12345"), \
                 patch.object(b, "transfer", side_effect=read_uploaded):
                receipt = {**b.seal_and_store(config, "synthetic", directory, bundle, backup_id),
                           "backup_id": backup_id}
            private_meta = {"ownedByMe": True, "trashed": False, "parents": [config["drive_folder_id"]],
                "permissions": [{"type": "user", "role": "owner", "emailAddress": config["google_owner"]}]}
            def drive_json(url, **_kwargs):
                if "?q=" in url:
                    return {"files": [{"id": "synthetic_receipt_12345"}]}
                if "?alt=media" in url:
                    return receipt
                return private_meta
            with patch.object(p, "json_request", side_effect=drive_json), \
                 patch.object(b, "transfer", side_effect=read_uploaded):
                restored, actual, _ = r.stored_bundle(config, "synthetic", Path(restore_folder))
                self.assertEqual(actual, manifest)
                self.assertEqual((restored / "synthetic.dump").read_bytes(), b"synthetic archived bytes")
            receipt["encrypted_sha256"] = "0" * 64
            with tempfile.TemporaryDirectory() as invalid_folder, \
                 patch.object(p, "json_request", side_effect=drive_json), \
                 patch.object(b, "transfer", side_effect=read_uploaded), self.assertRaises(p.Blocked):
                r.stored_bundle(config, "synthetic", Path(invalid_folder))


if __name__ == "__main__":
    unittest.main()
