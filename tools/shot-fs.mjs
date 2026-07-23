/* 전체화면 버튼이 실제로 동작하는지 검증한다.  npm run serve 후  node tools/shot-fs.mjs
 * requestFullscreen 은 헤드리스에서 실제로 창을 바꾸진 못하므로,
 * (1) 버튼이 보이는가 (2) 눌렀을 때 API 가 호출되는가 (3) 실패 시 안내가 뜨는가 를 본다. */
import { chromium, devices } from 'playwright';
const CASES = [
  { name:'갤럭시(안드로이드 크롬)', dev: devices['Galaxy S9+'] },
  { name:'아이패드',               dev: devices['iPad (gen 7)'] },
  { name:'PC 크롬',                dev: { viewport:{width:1200,height:700}, isMobile:false, hasTouch:false } },
];
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  ✅', n)) : (fail++, console.log('  ❌', n, e ?? '')); };

const b = await chromium.launch();
for (const t of CASES) {
  console.log('\n▸ ' + t.name);
  const ctx = await b.newContext({ ...t.dev });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8899/index.html?v=' + Date.now());
  await p.waitForTimeout(1800);

  // 진짜 전체화면 대신 호출만 가로챈다 (헤드리스는 실제 진입이 불가)
  await p.evaluate(() => {
    window.__fs = 0;
    document.documentElement.requestFullscreen = function () { window.__fs++; return Promise.resolve(); };
  });

  const gateUp = await p.evaluate(() => !document.getElementById('rotate-gate').classList.contains('hidden'));
  const btn = gateUp ? '#btn-fs-gate' : '#btn-fs-home';
  const visible = await p.evaluate((id) => !document.querySelector(id).classList.contains('hidden'), btn);
  ok(`전체화면 버튼이 보인다 (${gateUp ? '회전 안내 위' : '홈 화면'})`, visible);

  await p.locator(btn).click();
  await p.waitForTimeout(900);
  const calls = await p.evaluate(() => window.__fs);
  ok('버튼을 누르면 전체화면 API 가 호출된다', calls >= 1, { calls });

  // 실패했을 때(=여기서는 항상 실패) 사용자에게 이유를 알려 주는가
  const toast = await p.evaluate(() => document.querySelector('.toast')?.textContent || '');
  ok('실패하면 이유를 안내한다', toast.length > 0, toast.slice(0, 40));

  ok('콘솔 에러 없음', errs.length === 0, errs.slice(0, 2));
  await p.screenshot({ path: `test-shots/fs-${t.name.split('(')[0].trim()}.png` });
  await ctx.close();
}
await b.close();
console.log(`\n  통과 ${pass} · 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
