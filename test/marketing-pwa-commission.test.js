import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const html = read('index.html');

test('landing navigation opens focused marketing pages', () => {
  for (const route of ['how-it-works', 'for-you', 'features', 'reviews', 'students']) {
    const pagePath = new URL(`${route}/index.html`, root);
    assert.ok(existsSync(pagePath), `${route} page should exist`);
    assert.ok(statSync(pagePath).size < 25_000, `${route} page should stay lightweight`);
    assert.match(html, new RegExp(`href="/${route}/"`));
    assert.match(read(`${route}/index.html`), /href="\/manifest\.webmanifest"/);
  }

  assert.match(html, /class="landing-section" id="landing-how" hidden/);
  assert.match(html, /class="landing-section" id="landing-features" hidden/);
  assert.match(html, /class="landing-section" id="landing-reviews" hidden/);
  assert.match(html, /Everything you need, without one endless page\./);
});

test('PWA manifest has production install metadata and real PNG icons', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);

  const declaredSizes = new Set(manifest.icons.map(icon => icon.sizes));
  assert.ok(declaredSizes.has('192x192'));
  assert.ok(declaredSizes.has('512x512'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));

  for (const icon of manifest.icons) {
    const path = new URL(icon.src.replace(/^\//, ''), root);
    assert.ok(existsSync(path), `${icon.src} should exist`);
    const bytes = readFileSync(path);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(bytes.length > 2_000, `${icon.src} should contain a real rendered icon`);
  }
});

test('service worker does not cache authentication, API, admin, or payment traffic', () => {
  const worker = read('sw.js');
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/admin'\)/);
  assert.match(worker, /if \(url\.search\) return true/);
  assert.doesNotMatch(worker, /caches\.put\([^\n]*(supabase|pesapal|mpesa)/i);
  assert.match(read('assets/pwa-install.js'), /beforeinstallprompt/);
  assert.match(read('assets/pwa-install.js'), /Add to Home Screen/);
});

test('new orders use 5 percent while historical commission rows remain untouched', () => {
  assert.match(html, /const COMMISSION_RATE = 0\.05;/);
  assert.doesNotMatch(html, /const COMMISSION_RATE = 0\.12;/);
  assert.match(html, /const hasStoredRate = Number\.isFinite\(storedRate\) && storedRate >= 0/);
  assert.match(html, /const rate = hasStoredRate \? storedRate : COMMISSION_RATE/);

  const migration = read('supabase/migrations/20260911154500_new_order_commission_five_percent.sql');
  assert.match(migration, /alter column commission_rate set default 0\.05/);
  assert.match(migration, /before insert on public\.jw_tasks/);
  assert.match(migration, /new\.commission_rate := v_rate/);
  assert.doesNotMatch(migration, /update\s+public\.jw_tasks/i);
  assert.doesNotMatch(migration, /update\s+public\.jw_commission_ledger/i);
});
