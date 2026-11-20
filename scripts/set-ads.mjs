#!/usr/bin/env node
/**
 * Set the AdSense publisher id and ad unit id across the site.
 *
 *   node scripts/set-ads.mjs ca-pub-1234567890123456 1234567890
 *   node scripts/set-ads.mjs ca-pub-… 1234567890 --dry
 *
 * Replaces the placeholders in public/**.html and public/ads.txt.
 * Run it once, from the project root, before you deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const argv = process.argv.slice(2).filter((a) => a !== '--dry');
const dry = process.argv.includes('--dry');
const [client, slot] = argv;

if (!client || !/^ca-pub-\d{16}$/.test(client)) {
  console.error('Publisher id must look like ca-pub-1234567890123456');
  process.exit(1);
}
if (!slot || !/^\d{6,}$/.test(slot)) {
  console.error('Ad unit id must be numeric, e.g. 1234567890');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let changedFiles = 0;
let changedTags = 0;

for (const file of walk(PUBLIC)) {
  const ext = path.extname(file);
  if (ext !== '.html' && ext !== '.txt') continue;

  const before = fs.readFileSync(file, 'utf8');
  let after = before
    .replaceAll('ca-pub-XXXXXXXXXXXXXXXX', client)
    .replaceAll('data-ad-slot="0000000000"', `data-ad-slot="${slot}"`)
    .replaceAll('pub-XXXXXXXXXXXXXXXX', client.replace('ca-pub-', 'pub-'));

  if (after !== before) {
    const hits = (before.match(/XXXXXXXXXXXXXXXX|0000000000/g) || []).length;
    changedFiles++;
    changedTags += hits;
    if (!dry) fs.writeFileSync(file, after);
    console.log(`${dry ? 'would write' : 'wrote'} ${path.relative(ROOT, file)} (${hits})`);
  }
}

console.log(`\n${dry ? 'dry run' : 'done'}: ${changedFiles} files, ${changedTags} placeholders`);
if (changedFiles === 0) {
  console.log('Nothing to replace — ids are already set, or placeholders were renamed.');
}
