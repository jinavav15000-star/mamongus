/* 연출(먼지·반짝임·충격파)이 실제로 그려지는지 확인한다.  npm run serve 후  node tools/shot-fx.mjs */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:900,height:560} });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2200);
await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4000);
await p.evaluate(() => { for (let i=0;i<4;i++) Host.addBot(); });
await p.waitForTimeout(800);
await p.evaluate(() => Game.start());
await p.waitForTimeout(2200);
await p.evaluate(() => document.querySelectorAll('button').forEach(b => b.textContent.includes('시작하기') && b.click()));
await p.waitForTimeout(1800);

// 1) 걸음 먼지 — 키보드로 걷게 한다
await p.keyboard.down('ArrowLeft');
await p.waitForTimeout(1100);
console.log('먼지 파티클 수:', await p.evaluate(() => Render.fx.filter(f => f.kind === 'dust').length));
await p.screenshot({ path: 'test-shots/fx-dust.png' });
await p.keyboard.up('ArrowLeft');

// 2) 임무 완료 반짝임 + 충격파
await p.evaluate(() => { Render.sparkleAt(G.me.x + 40, G.me.y - 20); Render.ringAt(G.me.x - 60, G.me.y + 10, '#ff4d5e', 110); Render.puffAt(G.me.x, G.me.y + 60); });
await p.waitForTimeout(220);
console.log('전체 파티클 수:', await p.evaluate(() => Render.fx.length));
await p.screenshot({ path: 'test-shots/fx-sparkle.png' });

// 3) 상한이 지켜지는지 (16명이 동시에 뛰는 상황 가정)
await p.evaluate(() => { for (let i = 0; i < 400; i++) Render.dustAt(100, 100); });
console.log('상한 확인 (180 이하여야 함):', await p.evaluate(() => Render.fx.length));
await b.close();
