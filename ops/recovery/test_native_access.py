"""Synthetic reader credentials only; no network or company secrets."""

import unittest
from unittest.mock import patch

import native_access as a
import preflight as p
from test_preflight import settings


class ReaderTests(unittest.TestCase):
    def test_derivation_is_stable_and_separate_per_project_and_key(self):
        first = a.reader_password("synthetic-root", "a" * 20)
        self.assertEqual(first, a.reader_password("synthetic-root", "a" * 20))
        self.assertEqual(len(first), 43)
        self.assertNotEqual(first, a.reader_password("synthetic-root", "b" * 20))
        self.assertNotEqual(first, a.reader_password("another-root", "a" * 20))

    def test_sql_contains_scram_verifier_without_plaintext_password(self):
        password = a.reader_password("synthetic-root", "a" * 20)
        verifier = a.scram_verifier(password, b"synthetic-salt-16")
        sql = a.provisioning_sql(verifier)
        self.assertIn(verifier, sql)
        self.assertNotIn(password, sql)
        self.assertNotIn("synthetic-root", sql)
        self.assertNotEqual(verifier, a.scram_verifier(password))
        with self.assertRaises(ValueError):
            a.provisioning_sql("unsafe'; ALTER ROLE postgres PASSWORD 'changed")

    def test_unset_workflow_variable_and_invalid_mode(self):
        for value in ("", "temporary", "dedicated"):
            self.assertEqual(p.configuration({**settings(), "BACKUP_NATIVE_AUTH_MODE": value})[
                "native_auth_mode"], value or "temporary")
        with self.assertRaises(p.Blocked):
            p.configuration({**settings(), "BACKUP_NATIVE_AUTH_MODE": "postgres"})

    def test_dedicated_mode_never_requests_or_rotates_temporary_login(self):
        config = p.configuration({**settings(), "BACKUP_NATIVE_AUTH_MODE": "dedicated"})
        with patch.object(p, "json_request", return_value=[{
                "database_type": "PRIMARY", "db_host": "aws-1.pooler.supabase.com"}]) as request:
            env = p.database_environment(config, config["source_project_ref"])
        self.assertEqual(request.call_count, 1)
        self.assertTrue(request.call_args.args[0].endswith("/config/database/pooler"))
        self.assertEqual(p.read_role(env), a.READER)
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGPASSWORD"], a.reader_password(config["recovery_passphrase"], "a" * 20))
        with self.assertRaises(p.Blocked):
            p.read_role({"CURTIZ_NATIVE_READ_ROLE": "postgres"})


if __name__ == "__main__":
    unittest.main()
