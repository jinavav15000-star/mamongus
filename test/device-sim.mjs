/* ============================================================================
 *  마몽어스 · 실기기 에뮬레이션 테스트 (Playwright)
 *    node test/device-sim.mjs
 *
 *  지금까지 갤럭시 전체화면 문제를 '추측'으로 고쳤다. 이 파일은 실제
 *  Galaxy/iPhone User-Agent · 터치 · 화면회전을 재현해 눈으로 확인한다.
 *  ※ 정적 서버가 8899 로 떠 있어야 한다 (npm run serve)
 * ==========================================================================*/
import { chromium, devices } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_URL = process.env.URL || 'http://localhost:8899/';
const SHOT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'test-shots') + '/';
if (!existsSync(SHOT)) mkdirSync(SHOT, { recursive: true });

/* 갤럭시 S9+ 는 Playwright 기본 제공, 아이폰도 동일 */
const TARGETS = [
  { name: 'galaxy-portrait',  base: devices['Galaxy S9+'] },
  { name: 'galaxy-landscape', base: devices['Galaxy S9+ landscape'] },
  { name: 'iphone-portrait',  base: devices['iPhone 13'] },
  { name: 'iphone-landscape', base: devices['iPhone 13 landscape'] },
];

let pass = 0, fail = 0;
const out = [];
const ok = (n, c, e) => { if (c) { pass++; out.push(`  ✅ ${n}`); } else { fail++; out.push(`  ❌ ${n}${e !== undefined ? '  →  ' + JSON.stringify(e) : ''}`); } };

const browser = await chromium.launch();

for (const t of TARGETS) {
  out.push(`\n▸ ${t.name}  (${t.base.viewport.width}×${t.base.viewport.height})`);
  const ctx = await browser.newContext({ ...t.base });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 기기 판정이 제대로 되는가
  const vp = await page.evaluate(() => ({
    isPhone: Viewport.isPhone, isTouch: Viewport.isTouch,
    isIPhone: Viewport.isIPhone, isAndroid: Viewport.isAndroid,
    isPortrait: Viewport.isPortrait,
    gateShown: !document.querySelector('#rotate-gate').classList.contains('hidden'),
    armed: Viewport.armed,
  }));
  ok('폰으로 인식됨', vp.isPhone, vp);
  ok('플랫폼 판정 정확',
     t.name.startsWith('galaxy') ? vp.isAndroid && !vp.isIPhone : vp.isIPhone,
     { isAndroid: vp.isAndroid, isIPhone: vp.isIPhone });

  // 세로일 때만 회전 안내가 뜨는가 (방향고정이 안 된 상태 기준)
  if (vp.isPortrait) ok('세로 → 회전 안내 표시', vp.gateShown, vp);
  else ok('가로 → 회전 안내 숨김', !vp.gateShown, vp);

  // 첫 터치가 닉네임 입력창이면 전체화면을 발동시키지 않아야 한다
  await page.evaluate(() => { window.__fs = 0;
    document.documentElement.requestFullscreen = function () { window.__fs++; return Promise.resolve(); }; });
  await page.locator('#in-name').tap().catch(() => {});
  await page.waitForTimeout(200);
  const afterInput = await page.evaluate(() => ({ fs: window.__fs, armed: Viewport.armed }));
  ok('입력창 탭은 전체화면 미발동', afterInput.fs === 0, afterInput);
  ok('입력창 탭 후에도 무장 유지', afterInput.armed === true, afterInput);

  // 화면 빈 곳 탭 → 전체화면 시도
  await page.touchscreen.tap(t.base.viewport.width / 2, t.base.viewport.height - 40);
  await page.waitForTimeout(300);
  const afterTap = await page.evaluate(() => window.__fs);
  ok('일반 탭에서 전체화면 시도', afterTap >= 1, { calls: afterTap });

  await page.screenshot({ path: `${SHOT}${t.name}.png` });
  ok('콘솔 에러 없음', errors.length === 0, errors.slice(0, 3));

  await ctx.close();
}

await browser.close();
console.log(out.join('\n'));
console.log(`\n${'─'.repeat(52)}\n  통과 ${pass}  ·  실패 ${fail}`);
console.log(`  스크린샷: test-shots/`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(fail ? 1 : 0);
