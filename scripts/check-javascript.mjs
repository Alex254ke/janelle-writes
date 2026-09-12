import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:');

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && path.endsWith('.js') ? [path] : [];
  });
}

const standaloneJavaScript = [
  ...javascriptFiles(join(root, 'api')),
  ...javascriptFiles(join(root, 'assets')),
  join(root, 'sw.js')
];

for (const file of standaloneJavaScript) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  console.log(`syntax ok: ${relative(root, file)}`);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
let match;
let inlineIndex = 0;

while ((match = scriptPattern.exec(html))) {
  if (/\bsrc\s*=/i.test(match[1])) continue;
  inlineIndex += 1;
  const filename = `index.html:inline-script-${inlineIndex}`;
  if (/\btype\s*=\s*["']module["']/i.test(match[1])) {
    new vm.SourceTextModule(match[2], { identifier: filename });
  } else {
    new vm.Script(match[2], { filename });
  }
  console.log(`syntax ok: index.html inline script ${inlineIndex}`);
}

if (inlineIndex === 0) {
  throw new Error('No inline JavaScript was found in index.html');
}
