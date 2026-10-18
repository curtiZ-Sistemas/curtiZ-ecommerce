"""Isolated synthetic PG17 tests. Never connects to a Supabase project."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backup as b
import preflight as p
import native_access as a
import restore as r


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

    def test_reviewed_native_restore_is_atomic_and_preserves_auth_rls_data_and_sequences(self):
        target = {**self.admin, "PGDATABASE": "synthetic_restore"}
        target_reader = {**self.readonly, "PGDATABASE": "synthetic_restore"}
        platform_admin = {**self.admin, "PGUSER": "fixture_platform_admin", "PGPASSWORD": "synthetic-platform-password"}
        def query(sql, env):
            return p.run_tool([b.PG + "psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"],
                              env=env, input_bytes=sql)
        query(b"CREATE DATABASE synthetic_restore;", self.admin)
        query(b"CREATE ROLE fixture_platform_admin LOGIN SUPERUSER PASSWORD 'synthetic-platform-password'; "
              b"CREATE ROLE supabase_admin NOLOGIN SUPERUSER; "
              b"ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO postgres; "
              b"CREATE FUNCTION public.synthetic_helper() RETURNS integer LANGUAGE sql AS 'SELECT 1'; "
              b"GRANT SET ON PARAMETER session_replication_role TO postgres;", self.admin)
        try:
            query(b"CREATE PUBLICATION synthetic_app FOR TABLE public.orders (id) WHERE (id > 0);", self.admin)
            query(b"CREATE SCHEMA auth; CREATE TABLE auth.users(id bigint PRIMARY KEY,value text); "
                  b"CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY); "
                  b"CREATE PUBLICATION synthetic_app; "
                  b"ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO postgres; "
                  b"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO supabase_read_only_user; "
                  b"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO supabase_read_only_user;", target)
            # Model the actual platform: postgres is powerful but not a superuser,
            # and cannot alter the reserved administrator's default privileges.
            query(b"ALTER ROLE postgres NOSUPERUSER;", platform_admin)
            with tempfile.TemporaryDirectory() as folder:
                bundle = Path(folder)
                for name, options in {
                    "database.dump": [],
                    "application.dump": ["--schema=public", "--schema=private", "--schema=supabase_migrations"],
                    "auth-data.dump": ["--schema=auth", "--data-only"],
                    "storage-data.dump": ["--data-only", "--table=storage.buckets"]
                }.items():
                    p.run_tool([b.PG + "pg_dump", "--format=custom", "--no-password",
                                "--file=" + str(bundle / name), *options], env=self.admin)
                tables = b.native_json(self.readonly, b.TABLES_SQL)
                manifest = {"catalog": b.native_json(self.readonly, b.CATALOG_SQL), "tables": tables,
                    "fingerprints": [{"schema": t["schema"], "table": t["name"],
                        **b.native_json(self.readonly, b.fingerprint_sql(t["schema"], t["name"]))} for t in tables]}
                payload = b"\n".join(r.sql_sections(bundle)) + r.publication_sql(bundle, manifest)
                with self.assertRaises(p.Blocked) as denied:
                    query(b"BEGIN; SET LOCAL session_replication_role=replica;\n" + payload
                          + b"\nSELECT 1/0; COMMIT;", target)
                self.assertIn("permission", str(denied.exception))
                self.assertEqual(query(b"SELECT count(*) FROM auth.users;", target).strip(), b"0")
                self.assertEqual(query(b"SELECT count(*) FROM pg_tables WHERE schemaname='private';", target).strip(), b"0")
                target_platform_admin = {**platform_admin, "PGDATABASE": "synthetic_restore"}
                query(b"ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON TABLES TO supabase_read_only_user;", target_platform_admin)
                with self.assertRaises(p.Blocked):
                    r.default_acl_plan(bundle, target_reader)
                query(b"ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE UPDATE ON TABLES FROM supabase_read_only_user;", target_platform_admin)
                reset, selection = r.default_acl_plan(bundle, target_reader)
                self.assertNotIn(b"FOR ROLE supabase_admin", reset)
                payload = reset + b"\n" + b"\n".join(r.sql_sections(bundle, selection)) + r.publication_sql(bundle, manifest)
                config = {"source_project_ref": "a" * 20, "restore_project_ref": "b" * 20,
                          "recovery_passphrase": "synthetic-recovery-root", "supabase_access_token": "synthetic"}
                def management(_url, **kwargs):
                    self.assertTrue(_url.endswith("/" + "b" * 20 + "/cli/login-role"))
                    self.assertEqual(kwargs["body"], {"read_only": False})
                    query(b"CREATE ROLE cli_login_postgres LOGIN NOINHERIT PASSWORD 'synthetic-writer'; "
                          b"GRANT postgres TO cli_login_postgres;", platform_admin)
                    return {"role": "cli_login_postgres", "password": "synthetic-writer", "ttl_seconds": 600}
                with patch.dict(os.environ, {"GITHUB_RUN_ID": "98765", "GITHUB_RUN_ATTEMPT": "1"}), \
                     patch.object(p, "json_request", side_effect=management), patch.object(r.time, "sleep"):
                    with r.TargetWriter(config, target) as writer:
                        # The synthetic PG service uses direct usernames, rather
                        # than the Supavisor role.project routing suffix.
                        writer.env["PGUSER"] = writer.role
                        # Keep the production destination assertion; the fixture
                        # username is mapped only immediately before libpq runs.
                        original_run = p.run_tool
                        def fixture_run(args, **kwargs):
                            env = kwargs.get("env")
                            if env and env.get("PGUSER", "").endswith("." + "b" * 20):
                                kwargs["env"] = {**env, "PGUSER": writer.role}
                            return original_run(args, **kwargs)
                        writer.env["PGUSER"] = writer.role + "." + "b" * 20
                        with patch.object(p, "run_tool", side_effect=fixture_run):
                            writer.execute(b"BEGIN; SET LOCAL session_replication_role=replica;\n" + payload + b"\nCOMMIT;")
                for schema, table in (("public", "orders"), ("private", "state"), ("auth", "users"),
                                      ("supabase_migrations", "schema_migrations")):
                    expected = b.native_json(self.readonly, b.fingerprint_sql(schema, table))
                    self.assertEqual(b.native_json(target_reader, b.fingerprint_sql(schema, table)), expected)
                self.assertEqual(query(b"SELECT relrowsecurity FROM pg_class WHERE oid='public.orders'::regclass;", target).strip(), b"t")
                self.assertEqual(r.verify_sequences(bundle, target_reader), 1)
                self.assertEqual(r.verify_application(manifest, target_reader), 4)
                r.verify_default_privileges(bundle, target_reader)
                self.assertEqual(query(b"SELECT proacl IS NULL FROM pg_proc WHERE oid='public.synthetic_helper()'::regprocedure;", target).strip(), b"t")
                self.assertEqual(query(b"SELECT to_json(attnames) FROM pg_publication_tables WHERE pubname='synthetic_app';", target).strip(), b'["id"]')
                pub_query = b"SELECT json_build_object('columns',attnames,'filter',rowfilter) FROM pg_publication_tables WHERE pubname='synthetic_app';"
                self.assertEqual(query(pub_query, target), query(pub_query, self.admin))
                self.assertEqual(query(b"SELECT count(*) FROM pg_roles WHERE rolname LIKE 'curtiz_restore_%';", self.admin).strip(), b"0")
        finally:
            query(b"ALTER ROLE postgres SUPERUSER;", platform_admin)
            query(b"DROP DATABASE synthetic_restore WITH (FORCE);", self.admin)
            query(b"DROP PUBLICATION IF EXISTS synthetic_app;", self.admin)
            query(b"DROP FUNCTION IF EXISTS public.synthetic_helper(); DROP OWNED BY supabase_admin;", self.admin)
            query(b"DROP ROLE IF EXISTS cli_login_postgres;", self.admin)
            query(b"DROP ROLE IF EXISTS supabase_admin; DROP ROLE IF EXISTS fixture_platform_admin;", self.admin)
            r.TargetWriter.credentials.clear()


if __name__ == "__main__":
    unittest.main()
