const fs=require("node:fs");
const dir="supabase/migrations/", scratch="../../.tmp/mdfe-postgres-validation/";
const map=JSON.parse(fs.readFileSync(scratch+"remote-alignment.json","utf8").replace(/^\uFEFF/,""));
const extra=fs.readdirSync(dir).filter(x=>/^20261120\d+_representative_kit_.*\.sql$/.test(x)).sort();
const suspicious=/(?:\bCOPY\b[\s\S]{0,120}\bPROGRAM\b|\b(?:dblink|pg_net|webhook)\b|\b(?:net\.http|cron\.schedule|vault\.)|\bCREATE\s+INDEX\s+CONCURRENTLY\b)/i;
const blocks=[...map.map(x=>x.file),...extra].map(file=>{
  let sql=fs.readFileSync(dir+file,"utf8").replace(/^\uFEFF/,"").trim();
  if(file.startsWith("20261117110542_")){
    if(!/^begin;\s+[\s\S]*\ncommit;$/i.test(sql))throw Error("Expected wrapper changed: "+file);
    sql=sql.replace(/^begin;\s+/i,"").replace(/\ncommit;$/i,"");
  }
  if(/^\s*(?:COMMIT|ROLLBACK|PREPARE TRANSACTION)\s*;/im.test(sql))throw Error("Unexpected transaction: "+file);
  if(suspicious.test(sql))throw Error("Check for side effects in "+file);
  return "-- "+file+"\n"+sql;
});
const fixture=fs.readFileSync("supabase/tests/representative_kit_commercial_orders_test.sql","utf8")
  .replace(/^begin;\s+create extension if not exists pgtap with schema extensions;\s*/i,"")
  .replace(/\s*rollback;\s*$/i,"")
  .replace(/\bselect (ok|is|isnt|results_eq|throws_ok|no_plan)\(/g,"select pg_temp.$1(")
  .replace(/\bselect \* from finish\(\)/g,"select * from pg_temp.finish()");
const shims=fs.readFileSync(scratch+"suite-part.txt","utf8").split(String.fromCharCode(96))[1].replaceAll("extensions.","pg_temp.");
const prelude="begin;\nset local lock_timeout='2s';\nset local statement_timeout='25s';\n"+
  "do $stage_guard$ begin\n"+
  "  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261030105219'\n"+
  "    or to_regclass('private.representative_kit_orders') is not null then\n"+
  "    raise exception 'unexpected staging baseline';\n  end if;\nend $stage_guard$;";
const proof="rollback;\nselect 'staging rehearsal rollback completed' as result,\n"+
  "  to_regclass('private.representative_kit_orders') is null as rolled_back,\n"+
  "  (select max(version) from supabase_migrations.schema_migrations) as history;";
const joined=[prelude,...blocks,shims,fixture,proof].join("\n\n");
fs.writeFileSync(scratch+"remote-rehearsal.sql",joined);
console.log(JSON.stringify({bytes:Buffer.byteLength(joined),scripts:blocks.length,lines:joined.split("\n").length}));

