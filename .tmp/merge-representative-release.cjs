const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const root = process.cwd();
const destination = path.join(root, '.tmp/representative-release-worktree');
const files = ['apps/store/src/app/api/representatives/route.ts', 'apps/store/src/components/representative-portal.tsx', 'apps/store/src/lib/demo-representative-store.ts', 'apps/store/src/lib/demo-representative-store.test.ts', 'apps/store/src/app/globals.css'];
for (const file of files) {
  const base = cp.execFileSync('git', ['show', `HEAD:${file}`], {encoding:'utf8'}).replace(/\r\n/g,'\n');
  const theirs = cp.execFileSync('git', ['show', `origin/main:${file}`], {encoding:'utf8'}).replace(/\r\n/g,'\n');
  const ours = fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
  const paths = ['ours','base','theirs'].map(x => path.join(root, `.tmp/merge-${x}.tmp`));
  [ours,base,theirs].forEach((s,i) => fs.writeFileSync(paths[i],s,'utf8'));
  const result = cp.spawnSync('git',['merge-file','-p','--diff3',...paths],{encoding:'utf8'});
  let merged = result.stdout;
  if (result.status !== 0 && file.endsWith('representative-portal.tsx')) {
    merged = merged.replace(/<<<<<<< [^\n]+\n[\s\S]*?\n\|\|\|\|\|\|\| [^\n]+\n[\s\S]*?\n=======\n([\s\S]*?)\n>>>>>>> [^\n]+/g,'$1');
    merged = merged.replace('        representativeCode={representative.publicCode}\n','')
      .replace('function Kits({\n  representativeCode,\n','function Kits({\n')
      .replace('  representativeCode: string;\n  orders: NonNullable<Snapshot["kitOrders"]>;','  orders: NonNullable<Snapshot["kitOrders"]>;');
  }
  if (!merged || merged.includes('<<<<<<< ')) throw new Error(`Unresolved merge: ${file}`);
  fs.writeFileSync(path.join(destination,file),merged,'utf8');
  process.stdout.write(`Merged ${file}\n`);
}
