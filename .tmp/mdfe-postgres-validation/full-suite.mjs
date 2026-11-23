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
﻿await db.exec(String.raw`
create function extensions.no_plan() returns text language sql as $$select 'test suite'::text$$;
create function extensions.finish() returns setof text language sql as $$select ''::text where false$$;
create function extensions.ok(actual boolean, label text) returns text language plpgsql as $$
begin if actual is not true then raise exception 'Assertion failed: % [actual %]', label,actual; end if;
return 'ok - '||label; end $$;
create function extensions.is(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is distinct from expected then raise exception 'Assertion failed: % [actual % expected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function extensions.isnt(actual anycompatible, expected anycompatible,label text) returns text language plpgsql as $$
begin if actual is not distinct from expected then raise exception 'Assertion failed: % [actual % unexpected %]', label,actual,expected; end if;
return 'ok - '||label; end $$;
create function extensions.results_eq(actual text, expected text,label text) returns text language plpgsql as $$
declare result text[]; target text[];
begin execute 'select array_agg(r::text) from ('||actual||') as r' into result;
execute 'select array_agg(r::text) from ('||expected||') as r' into target;
return extensions.is(result,target,label); end $$;
create function extensions.throws_ok(statement text, code text, expected_message text,label text) returns text language plpgsql as $$
declare seen_code text; seen_message text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics seen_code=returned_sqlstate,seen_message=message_text; end;
  if seen_code is distinct from code or (expected_message is not null and seen_message is distinct from expected_message)
    then raise exception 'Assertion failed: % [actual %: % expected %: %]',label,seen_code,seen_message,code,expected_message;
  end if;
  return 'ok - '||label;
end $$;
`);
const testPath = new URL("../fiscal-kits-mg-20261119/supabase/tests/representative_kit_commercial_orders_test.sql",import.meta.url);
try {
  const suite=(await readFile(testPath,"utf8")).replace("create extension if not exists pgtap with schema extensions;","");
  const assertions=(await db.exec(suite)).flatMap(output => output.rows).flatMap(row => Object.values(row))
    .filter(value => typeof value==="string" && value.startsWith("ok - "));
  console.log("Passed "+assertions.length+" assertions from the commercial-order SQL suite.");
} catch(e) { console.error(JSON.stringify({code:e.code,message:e.message,where:e.where,position:e.position})); process.exit(1); }


await db.close();

