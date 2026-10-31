import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import backup as b
import preflight as p
from test_preflight import settings


class IdentifierTests(unittest.TestCase):
    def test_quotes_identifiers_without_interpreting_them(self):
        self.assertEqual(b.identifier('table";select 1;--'), '"table"";select 1;--"')
        with self.assertRaises(p.Blocked):
            b.identifier("invalid\0identifier")

    def test_fingerprint_uses_canonical_hashes_and_quoted_relation(self):
        sql = b.fingerprint_sql("private", 'example"table')
        self.assertIn('"private"."example""table"', sql)
        self.assertIn("sha256", sql)
        self.assertIn("ORDER BY h", sql)


class ArchiveTests(unittest.TestCase):
    def archive(self, folder, names, *, symlink=False):
        path = Path(folder) / "synthetic.tar"
        with tarfile.open(path, "w") as archive:
            for name in names:
                entry = tarfile.TarInfo(name)
                if symlink:
                    entry.type, entry.linkname = tarfile.SYMTYPE, "/etc/passwd"
                    archive.addfile(entry)
                else:
                    entry.size = 4
                    archive.addfile(entry, io.BytesIO(b"test"))
        return path

    def test_members_and_coverage_are_checked(self):
        expected = {"manifest.json": {"size": 4, "sha256": hashlib.sha256(b"test").hexdigest()}}
        with tempfile.TemporaryDirectory() as directory:
            path = self.archive(directory, ["manifest.json"])
            b.verify_tar(path, expected)
            for invalid in ({}, {"manifest.json": {"size": 5, "sha256": "wrong"}},
                            {"manifest.json": {"size": 4, "sha256": "wrong"}},
                            {**expected, "missing": {"size": 1, "sha256": "wrong"}}):
                with self.assertRaises(p.Blocked):
                    b.verify_tar(path, invalid)

    def test_traversal_symlinks_absolute_and_duplicate_members_fail_closed(self):
        digest = hashlib.sha256(b"test").hexdigest()
        for names, link in ((["../outside"], False), (["/absolute"], False),
                            (["normal", "normal"], False), (["link"], True)):
            with tempfile.TemporaryDirectory() as directory:
                path = self.archive(directory, names, symlink=link)
                expected = {name: {"size": 4, "sha256": digest} for name in names}
                with self.subTest(names=names), self.assertRaises(p.Blocked):
                    b.verify_tar(path, expected)


class UploadTests(unittest.TestCase):
    def test_only_expected_https_upload_host_and_path_are_allowed(self):
        self.assertTrue(b.upload_url_allowed("https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic"))
        for url in ("http://www.googleapis.com/upload/drive/v3/files",
                    "https://www.googleapis.com.attacker.invalid/upload/drive/v3/files",
                    "https://user@www.googleapis.com/upload/drive/v3/files",
                    "https://www.googleapis.com:444/upload/drive/v3/files",
                    "https://www.googleapis.com/unexpected-path"):
            with self.subTest(url=url):
                self.assertFalse(b.upload_url_allowed(url))

    def test_resumable_upload_requires_exact_acknowledgement_and_final_confirmation(self):
        cfg = p.configuration(settings())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.bin"
            with path.open("wb") as stream:
                stream.truncate(8 * 1024 * 1024 + 1)
            replies = [(200, {"Location": "https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic"}, b""),
                       (308, {"Range": "bytes=0-8388607"}, b""),
                       (200, {}, b'{"id":"synthetic_file_12345"}')]
            with patch.object(b, "transfer", side_effect=replies) as call:
                self.assertEqual(b.upload_drive(cfg, "synthetic", path, "synthetic.gpg", "test"),
                                 "synthetic_file_12345")
                self.assertEqual(call.call_args.kwargs["headers"]["Content-Range"],
                                 "bytes 8388608-8388608/8388609")
            replies[1] = (308, {"Range": "bytes=0-1"}, b"")
            with patch.object(b, "transfer", side_effect=replies), self.assertRaises(p.Blocked):
                b.upload_drive(cfg, "synthetic", path, "synthetic.gpg", "test")

    def test_untrusted_upload_location_never_receives_credentials(self):
        cfg = p.configuration(settings())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic.bin"
            path.write_bytes(b"synthetic")
            with patch.object(b, "transfer", return_value=(200, {"Location": "https://attacker.invalid"}, b"")) as call:
                with self.assertRaises(p.Blocked):
                    b.upload_drive(cfg, "synthetic-token", path, "synthetic.gpg", "test")
                self.assertEqual(call.call_count, 1)


class StorageTests(unittest.TestCase):
    def test_server_key_is_selected_without_exporting_other_keys(self):
        keys = [{"name": "anon", "type": "legacy", "api_key": "eyJsyntheticAnon"},
                {"name": "service_role", "type": "legacy", "api_key": "eyJsyntheticServer"}]
        with patch.object(p, "json_request", return_value=keys):
            self.assertEqual(b.service_key(p.configuration(settings()), "a" * 20), "eyJsyntheticServer")
        with patch.object(p, "json_request", return_value=keys[:1]), self.assertRaises(p.Blocked):
            b.service_key(p.configuration(settings()), "a" * 20)

    def test_storage_names_never_become_filesystem_paths(self):
        cfg = p.configuration(settings())
        items = [{"bucket_id": "synthetic", "name": "../other/ç.txt", "metadata": {"size": 4}}]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "objects").mkdir()

            def download(url, **kwargs):
                self.assertIn("..%2Fother%2F%C3%A7.txt", url)
                kwargs["destination"].write_bytes(b"test")

            with patch.object(b, "service_key", return_value="synthetic"), patch.object(b, "transfer", side_effect=download):
                result = b.capture_storage(cfg, items, root)
            self.assertEqual(result[0]["sha256"], hashlib.sha256(b"test").hexdigest())
            self.assertRegex(result[0]["blob"], r"^objects/[a-f0-9]{64}$")
            self.assertEqual(len(list(root.iterdir())), 1)

    def test_missing_or_wrong_storage_sizes_do_not_approve_partial_data(self):
        cfg = p.configuration(settings())
        for metadata in ({}, {"size": -1}, {"size": b.MAX_OBJECT + 1}):
            with patch.object(b, "service_key", return_value="synthetic"), self.assertRaises(p.Blocked):
                b.capture_storage(cfg, [{"bucket_id": "bucket", "name": "name", "metadata": metadata}], Path("unused"))


class EncryptionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("gpg"), "Real GPG archive roundtrip runs on Linux CI")
    def test_real_encryption_readback_and_member_verification(self):
        cfg = p.configuration(settings())
        encrypted_bytes = None

        def upload(config, token, path, name, kind):
            nonlocal encrypted_bytes
            encrypted_bytes = path.read_bytes()
            self.assertNotIn(b"synthetic-private-content", encrypted_bytes)
            return "synthetic_file_12345"

        def download(url, **kwargs):
            kwargs["destination"].write_bytes(encrypted_bytes)

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            bundle = directory / "bundle"
            bundle.mkdir()
            (bundle / "manifest.json").write_text("synthetic-private-content")
            with patch.object(b, "upload_drive", side_effect=upload), patch.object(b, "transfer", side_effect=download):
                receipt = b.seal_and_store(cfg, "synthetic", directory, bundle, "synthetic-backup")
            self.assertEqual(receipt["state"], "backup-readback-verified-restore-not-tested")
            self.assertEqual(receipt["encrypted_sha256"], hashlib.sha256(encrypted_bytes).hexdigest())

    def test_no_customer_export_without_cloud_cofre_confirmation(self):
        with patch.dict(os.environ, settings(), clear=True), patch.object(b, "export") as export:
            with patch("builtins.print"):
                self.assertEqual(b.main(), 1)
            export.assert_not_called()


if __name__ == "__main__":
    unittest.main()
