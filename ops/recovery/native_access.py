"""Provision only dedicated native readers; never rotate existing login passwords.

Reader passwords are domain-separated HMAC keys derived from the company recovery
secret and project reference. Only a salted SCRAM verifier reaches administrative
SQL. No plaintext password, verifier or SQL body may be logged.
"""

import base64
import hashlib
import hmac
import os
import secrets
import sys
import time

READER = "curtiz_backup_reader"
MARKER = "curtiz-native-backup-reader:v1"


def reader_password(recovery_secret, project_ref):
    context = b"curtiz:postgres-native-reader:v1\0" + project_ref.encode("ascii")
    raw = hmac.new(recovery_secret.encode("utf-8"), context, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def scram_verifier(password, salt=None):
    salt = secrets.token_bytes(16) if salt is None else salt
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("ascii"), salt, 4096)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    encode = lambda value: base64.b64encode(value).decode("ascii")
    return f"SCRAM-SHA-256$4096:{encode(salt)}${encode(stored_key)}:{encode(server_key)}"


def provisioning_sql(verifier):
    # Generated verifiers use only the fixed SCRAM format/base64 alphabet.
    import re
    if not re.fullmatch(r"SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+", verifier):
        raise ValueError("Invalid generated SCRAM verifier.")
    return f"""
DO $curtiz_native_reader$
DECLARE r record;
BEGIN
 SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
        rolinherit,rolconfig,shobj_description(oid,'pg_authid') AS description
 INTO r FROM pg_roles WHERE rolname='{READER}';
 IF NOT FOUND THEN
   CREATE ROLE {READER} NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
     NOREPLICATION BYPASSRLS;
   COMMENT ON ROLE {READER} IS '{MARKER}';
   SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
          rolinherit,rolconfig,shobj_description(oid,'pg_authid') AS description
   INTO r FROM pg_roles WHERE rolname='{READER}';
 END IF;
 IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
    OR NOT r.rolbypassrls OR NOT r.rolinherit THEN
   RAISE EXCEPTION 'Reserved backup role has incompatible privileges';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members m
    WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname='{READER}')
    AND m.roleid<>(SELECT oid FROM pg_roles WHERE rolname='pg_read_all_data')) THEN
   RAISE EXCEPTION 'Reserved backup role has unexpected memberships';
 END IF;
 IF r.rolcanlogin THEN
   IF r.description IS DISTINCT FROM '{MARKER}'
      OR NOT coalesce('default_transaction_read_only=on'=ANY(r.rolconfig),false)
      OR NOT pg_has_role('{READER}','pg_read_all_data','USAGE') THEN
     RAISE EXCEPTION 'Existing login must not be adopted or reconfigured';
   END IF;
 ELSE
   IF r.description IS DISTINCT FROM '{MARKER}' THEN
     RAISE EXCEPTION 'Existing role belongs to another purpose';
   END IF;
   GRANT pg_read_all_data TO {READER};
   ALTER ROLE {READER} SET default_transaction_read_only=on;
   ALTER ROLE {READER} LOGIN PASSWORD '{verifier}';
   COMMENT ON ROLE {READER} IS '{MARKER}';
 END IF;
END
$curtiz_native_reader$;
SELECT true AS backup_reader_ready;
"""


def main():
    import preflight as p
    try:
        config = p.configuration(os.environ)
        p.require(os.environ.get("BACKUP_CLOUD_VAULT_CONFIRMED") == "true",
                  "The company recovery secret must be confirmed in its cloud cofre.")
        for key in ("source_project_ref", "restore_project_ref"):
            ref = config[key]
            password = reader_password(config["recovery_passphrase"], ref)
            sql = provisioning_sql(scram_verifier(password))
            response = p.json_request(f"https://api.supabase.com/v1/projects/{ref}/database/query",
                                      bearer=config["supabase_access_token"], body={"query": sql})
            p.require(isinstance(response, list) and response
                      and response[-1].get("backup_reader_ready") is True,
                      "Native reader provisioning was not confirmed.")
        # Official guidance allows the shared pooler about 15s to pick up a new password.
        time.sleep(16)
        config["native_auth_mode"] = "dedicated"
        source = p.database_metadata(p.database_environment(config, config["source_project_ref"]))
        target = p.database_metadata(p.database_environment(config, config["restore_project_ref"]))
        p.validate_databases(source, target)
        print("Dedicated native readers verified in both projects with TLS and read-only sessions.")
        print("No application data, table RLS, existing user permissions or existing passwords changed.")
        return 0
    except p.Blocked as exc:
        print(f"::error::Native reader setup incomplete: {exc}")
        return 1
    except Exception:
        print("::error::Native reader setup incomplete; sensitive details suppressed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
