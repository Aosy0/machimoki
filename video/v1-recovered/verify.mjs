// v1 復元物の検証: node video/v1-recovered/verify.mjs
// modules/src/** に v1 の必須マーカーが含まれるか確認する。依存なし。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modRoot = path.join(here, 'modules', 'src');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const files = walk(modRoot);
const text = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const expectedFiles = [
  'config.ts',
  'fonts.ts',
  'index.ts',
  'Root.tsx',
  'MachimokiDemo.tsx',
  'SmokeTest.tsx',
  'components/ui.tsx',
  'scenes/Scene01Title.tsx',
  'scenes/Scene02Problem.tsx',
  'scenes/Scene03Solution.tsx',
  'scenes/Scene04Select.tsx',
  'scenes/Scene05Preview.tsx',
  'scenes/Scene06Export.tsx',
  'scenes/Scene07Showcase.tsx',
  'scenes/Scene08Outro.tsx',
];
const markers = ['#4cc2ff', '#7ee787', 'HighlightRing', 'kenBurnsScale', 'STEP 1 — 範囲を選ぶ', 'PASS — watertight', '選んで、印刷する。', 'そのままでは、印刷できない。'];

let ok = true;
for (const rel of expectedFiles) {
  const p = path.join(modRoot, rel);
  const exists = fs.existsSync(p);
  if (!exists) ok = false;
  console.log(`${exists ? 'OK ' : 'MISS'} module ${rel}`);
}
for (const m of markers) {
  const hit = text.includes(m);
  if (!hit) ok = false;
  console.log(`${hit ? 'OK ' : 'MISS'} marker ${m}`);
}
console.log(ok ? '\nALL CHECKS PASSED' : '\nCHECKS FAILED');
process.exit(ok ? 0 : 1);
