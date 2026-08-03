import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const identityMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202607290004_functions_rls_storage.sql"),
  "utf8"
).toLowerCase();
const rolePolicyMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608030007_authenticated_user_roles.sql"),
  "utf8"
).toLowerCase();

describe("authenticated identity invariants", () => {
  it("creates profile and only the customer role in the auth user trigger", () => {
    expect(identityMigration).toContain("create trigger on_auth_user_created");
    expect(identityMigration).toContain(
      "insert into public.profiles(id, full_name, email_snapshot, status)"
    );
    expect(identityMigration).toContain(
      "insert into public.user_roles(user_id, role) values (new.id, 'customer')"
    );
    expect(identityMigration).toContain("security definer");
    expect(identityMigration).toContain("set search_path = ''");
  });

  it("allows authenticated users to read only their own role assignments", () => {
    expect(rolePolicyMigration).toContain('create policy "user reads own roles"');
    expect(rolePolicyMigration).toContain("to authenticated");
    expect(rolePolicyMigration).toContain("user_id = (select auth.uid())");
  });
});
