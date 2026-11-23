import { readFile,readdir } from "node:fs/promises";
import { PGlite } from "./package/dist/index.js";
import { pgcrypto } from "./package/dist/contrib/pgcrypto.js";
import { citext } from "./package/dist/contrib/citext.js";
import { pg_trgm } from "./package/dist/contrib/pg_trgm.js";
import { unaccent } from "./package/dist/contrib/unaccent.js";
const db=new PGlite({extensions:{pgcrypto,citext,pg_trgm,unaccent}});
await db.exec(String.raw`
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema extensions;
create schema auth;
create schema storage;
create publication supabase_realtime;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub'),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),auth.jwt()->>'role')$$;
create table auth.users(id uuid primary key,email text,phone text,raw_app_meta_data jsonb,raw_user_meta_data jsonb,
  email_confirmed_at timestamptz,phone_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,
  owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select (string_to_array($1,'/'))[1:cardinality(string_to_array($1,'/'))-1] $$;
create function storage.extension(text) returns text language sql immutable as $$select lower(substring($1 from '\\.([^.]*)$'))$$;
grant usage on schema auth,storage,extensions to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
grant select on storage.buckets to anon,authenticated,service_role;
alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
set search_path=public,extensions;
`);
const base=new URL("../fiscal-kits-mg-20261119/supabase/migrations/",import.meta.url);
const migrations=(await readdir(base)).filter(n=>n.endsWith(".sql")).sort();
let count=0;
for (const name of migrations) {
  try { await db.exec(await readFile(new URL(name,base),"utf8")); count++ }
  catch(e) { console.error(JSON.stringify({name,count,code:e.code,message:e.message,where:e.where})); process.exit(1); }
}
console.log("Applied "+count+" migrations on PostgreSQL.");
await db.close();

