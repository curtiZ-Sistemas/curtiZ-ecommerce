"""Isolated synthetic PG17 tests. Never connects to a Supabase project."""

import json
import os
from pathlib import Path
import tempfile
import unittest

import backup as b
import preflight as p
import native_access as a


@unittest.skipUnless(os.environ.get("RUN_NATIVE_RECOVERY_TESTS") == "true",
                     "Native PG17 integration runs only in the isolated Linux CI service")
class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.admin = {"PATH": os.defpath, "LANG": "C.UTF-8", "PGHOST": "127.0.0.1",
                     "PGPORT": "5432", "PGDATABASE": "postgres", "PGUSER": "postgres",
                     "PGPASSWORD": "synthetic-ci-password", "PGSSLMODE": "disable"}
        sql = """
        CREATE ROLE supabase_read_only_user NOLOGIN BYPASSRLS;
        GRANT pg_read_all_data TO supabase_read_only_user;
        CREATE ROLE cli_login_supabase_read_only_user LOGIN NOINHERIT PASSWORD 'synthetic-ci-password';
        GRANT supabase_read_only_user TO cli_login_supabase_read_only_user WITH INHERIT FALSE, SET TRUE;
        CREATE SCHEMA private;
        CREATE SCHEMA auth;
        CREATE SCHEMA storage;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE public.orders(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text);
        ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
        CREATE TABLE private.state(id bigint PRIMARY KEY, value text);
        CREATE TABLE auth.users(id bigint PRIMARY KEY, value text);
        CREATE TABLE storage.buckets(id text PRIMARY KEY);
        CREATE TABLE storage.objects(id bigint PRIMARY KEY, bucket_id text, name text, metadata jsonb);
        CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
        INSERT INTO public.orders(value) VALUES ('synthetic-original');
        INSERT INTO private.state VALUES (1,'synthetic-private');
        INSERT INTO auth.users VALUES (1,'synthetic-auth');
        INSERT INTO storage.buckets VALUES ('synthetic-bucket');
        INSERT INTO storage.objects VALUES (1,'synthetic-bucket','synthetic.txt','{"size":4}');
        INSERT INTO supabase_migrations.schema_migrations VALUES ('synthetic-history');
        """
        p.run_tool([b.PG + "psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], env=cls.admin)
        cls.readonly = {**cls.admin, "PGUSER": "cli_login_supabase_read_only_user",
                        "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=30000"}

    def test_exported_snapshot_is_kept_alive_and_dump_matches_it(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            with b.Snapshot(self.readonly, directory) as snapshot:
                original = snapshot.query(b.fingerprint_sql("public", "orders"))
                self.assertEqual(original["count"], 1)
                p.run_tool([b.PG + "psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1",
                            "-c", "INSERT INTO public.orders(value) VALUES ('synthetic-after-snapshot');"], env=self.admin)
                self.assertEqual(snapshot.query(b.fingerprint_sql("public", "orders")), original)
                archive = directory / "application.dump"
                p.run_tool([b.PG + "pg_dump", "--format=custom", "--no-password",
                            "--role=supabase_read_only_user", "--snapshot=" + snapshot.snapshot_id,
                            "--schema=public", "--schema=private", "--schema=supabase_migrations",
                            "--file=" + str(archive)], env=self.readonly)
            payload = p.run_tool([b.PG + "pg_restore", "--data-only", "--file=-", str(archive)])
            self.assertIn(b"synthetic-original", payload)
            self.assertNotIn(b"synthetic-after-snapshot", payload)
            p.run_tool([b.PG + "psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1",
                        "-c", "DELETE FROM public.orders WHERE value='synthetic-after-snapshot';"], env=self.admin)

    def test_readonly_snapshot_rejects_writes_and_sees_rls_protected_data(self):
        with tempfile.TemporaryDirectory() as folder:
            with b.Snapshot(self.readonly, Path(folder)) as snapshot:
                metadata = snapshot.query("SELECT json_build_object('role',current_user,'read_only',"
                                          "current_setting('transaction_read_only'),'rows',"
                                          "(SELECT count(*) FROM public.orders));")
                self.assertEqual(metadata, {"role": "supabase_read_only_user", "read_only": "on", "rows": 1})
                with self.assertRaises(p.Blocked):
                    snapshot.query("INSERT INTO public.orders(value) VALUES ('forbidden');")

    def test_inventory_and_history_are_available_to_native_readonly_role(self):
        with tempfile.TemporaryDirectory() as folder:
            with b.Snapshot(self.readonly, Path(folder)) as snapshot:
                tables = snapshot.query(b.TABLES_SQL)
                self.assertIn({"schema": "private", "name": "state"},
                              [{"schema": t["schema"], "name": t["name"]} for t in tables])
                self.assertEqual(snapshot.query(b.STORAGE_SQL)[0]["metadata"]["size"], 4)
                self.assertIsInstance(snapshot.query(b.CATALOG_SQL)["policies"], list)
                self.assertEqual(snapshot.query(b.fingerprint_sql("supabase_migrations", "schema_migrations"))["count"], 1)
                roles = snapshot.query(b.ROLES_SQL)
                self.assertTrue(all(not role["name"].startswith("cli_login_") for role in roles))

    def test_native_role_archive_omits_passwords_and_supports_noinherit_login(self):
        output = p.run_tool([b.PG + "pg_dumpall", "--roles-only", "--no-role-passwords",
                             "--no-password", "--role=supabase_read_only_user"], env=self.readonly)
        self.assertIn(b"supabase_read_only_user", output)
        self.assertNotIn(b"synthetic-ci-password", output)
        self.assertNotIn(b"SCRAM-SHA-256$", output)

    def test_dedicated_scram_reader_is_idempotent_readonly_and_rejects_role_collision(self):
        password = a.reader_password("synthetic-root-only", "a" * 20)
        def admin_sql(sql):
            return p.run_tool([b.PG + "psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1",
                               "-c", sql], env=self.admin)
        try:
            admin_sql(f"CREATE ROLE {a.READER} NOLOGIN BYPASSRLS")
            with self.assertRaises(p.Blocked):
                admin_sql(a.provisioning_sql(a.scram_verifier(password)))
            admin_sql(f"DROP ROLE {a.READER}")
            admin_sql(a.provisioning_sql(a.scram_verifier(password)))
            # A second invocation must preserve the stored verifier, even if
            # its proposed password differs. Never rotate an existing login.
            before = admin_sql(f"SELECT rolpassword FROM pg_authid WHERE rolname='{a.READER}'")
            admin_sql(a.provisioning_sql(a.scram_verifier("synthetic-must-not-replace")))
            self.assertEqual(admin_sql(f"SELECT rolpassword FROM pg_authid WHERE rolname='{a.READER}'"), before)
            reader = {**self.admin, "PGUSER": a.READER, "PGPASSWORD": password,
                      "CURTIZ_NATIVE_READ_ROLE": a.READER}
            with tempfile.TemporaryDirectory() as folder:
                with b.Snapshot(reader, Path(folder)) as snapshot:
                    self.assertEqual(snapshot.query(b.fingerprint_sql("public", "orders"))["count"], 1)
                    self.assertEqual(snapshot.query("SELECT json_build_object('ro',"
                        "current_setting('transaction_read_only'));"), {"ro": "on"})
            for sql in ("INSERT INTO public.orders(value) VALUES ('forbidden')",
                        "SET default_transaction_read_only=off; INSERT INTO public.orders(value) VALUES ('forbidden')"):
                with self.assertRaises(p.Blocked):
                    p.run_tool([b.PG + "psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1",
                                "-c", sql], env=reader)
            admin_sql(f"ALTER ROLE {a.READER} CREATEDB")
            with self.assertRaises(p.Blocked):
                admin_sql(a.provisioning_sql(a.scram_verifier(password)))
        finally:
            admin_sql(f"DROP OWNED BY {a.READER}; DROP ROLE IF EXISTS {a.READER}")


if __name__ == "__main__":
    unittest.main()
