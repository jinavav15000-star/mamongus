/* 모자 12종 확인 — 서버 없이 캔버스로 바로 그린다.  node tools/shot-hats.mjs
 * 위: 정면 / 아래: 걷는 중(좌우 반전) — 야구모자 챙이 보는 방향을 따라가는지 확인용.
 * 모자를 추가·수정했으면 반드시 눈으로 볼 것. 좌표만 봐서는 정수리에 얹혔는지 알 수 없다. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const src = ['10-map.js', '15-roles.js', '60-render.js']
  .map(f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')).join('\n');

const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width: 1040, height: 560 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.setContent(`<body style="margin:0;background:#150f0a"><canvas id="cv" width="1040" height="560"></canvas>
<script>${src}<\/script></body>`);

const missing = await p.evaluate(() => {
  const g = document.getElementById('cv').getContext('2d');
  const COLS = ['red','blue','green','pink','orange','yellow','purple','cyan','lime','tan','coral','white'];
  const gone = HATS.filter(h => h.id !== 'none' && !Render.HAT_DRAW[h.id]).map(h => h.id);
  g.font = '600 13px system-ui'; g.textAlign = 'center';

  HATS.forEach((hat, i) => {
    const cx = 80 + (i % 7) * 140, cy = 130 + Math.floor(i / 7) * 250;
    const col = colorOf(COLS[i % COLS.length]);
    // 정면 (서 있기)
    g.save(); g.translate(cx, cy); g.scale(2.1, 2.1);
    Render.charShape(g, col, { t: 800, hat: hat.id });
    g.restore();
    // 걷는 중 + 좌우 반전 (챙·리본이 방향을 따라가는지)
    g.save(); g.translate(cx, cy + 105); g.scale(-2.1, 2.1);
    Render.charShape(g, col, { t: 180, moving: true, hat: hat.id });
    g.restore();
    g.fillStyle = '#f6ece0';
    g.fillText(hat.name, cx, cy + 145);
  });
  return gone;
});

await p.locator('#cv').screenshot({ path: 'test-shots/hats.png' });

/* HAT_TOP(이름표를 올리는 높이) 이 실제 그림과 맞는지 픽셀로 잰다.
 * 손으로 적은 표라 그림을 고치면 조용히 어긋나고, 그러면 이름표가 모자를 덮는다. */
const heights = await p.evaluate(() => {
  const cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
  const g = cv.getContext('2d');
  const out = [];
  for (const hat of HATS) {
    g.clearRect(0, 0, 200, 200);
    g.save(); g.translate(100, 120); Render.charShape(g, colorOf('red'), { t: 800, hat: hat.id }); g.restore();
    const d = g.getImageData(0, 0, 200, 200).data;
    let top = 200;
    for (let y = 0; y < 200 && top === 200; y++)
      for (let x = 0; x < 200; x++)
        if (d[(y * 200 + x) * 4 + 3] > 8) { top = y; break; }
    out.push({ id: hat.id, real: 120 - top, table: Render.HAT_TOP[hat.id] ?? null });
  }
  return out;
});
const noTop = heights.filter(x => x.table === null).map(x => x.id);
const off = heights.filter(x => x.table !== null && Math.abs(x.real - x.table) > 3);
console.log('\n모자 꼭대기 높이 (이름표를 이만큼 올린다)');
console.log('─'.repeat(46));
for (const x of heights)
  console.log(`  ${x.id.padEnd(9)} 실제 ${String(x.real).padStart(3)}  표 ${String(x.table).padStart(4)}` +
              (x.table !== null && Math.abs(x.real - x.table) > 3 ? '  ❌ 어긋남' : ''));
console.log('─'.repeat(46));
const bad = missing.length || noTop.length || off.length;
if (missing.length) console.log('❌ 그림이 없는 모자: ' + missing.join(', '));
if (noTop.length)   console.log('❌ HAT_TOP 에 빠진 모자: ' + noTop.join(', '));
if (off.length)     console.log('❌ HAT_TOP 이 그림과 어긋남 — 이름표가 모자를 덮는다: ' +
                                off.map(x => `${x.id}(실제 ${x.real} ≠ 표 ${x.table})`).join(', '));
if (!bad) console.log(`✅ 모자 ${heights.length}종 · 그림·높이표 일치 → test-shots/hats.png`);
await b.close();
process.exit(bad ? 1 : 0);
