/* 봇 4명을 넣고 게임 화면·지도를 캡처한다.  npm run serve 후  node tools/shot-game.mjs */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:900,height:520} });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2500);
await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4000);
const ok = await p.evaluate(() => { for (let i=0;i<4;i++) Host.addBot?.() ?? Game.addBot?.(); return Object.keys(G.players||{}).length; });
console.log('players', ok);
await p.waitForTimeout(800);
await p.evaluate(() => Game.start?.() ?? Host.startGame?.());
await p.waitForTimeout(2500);
// 역할 안내 모달 닫기
await p.evaluate(() => { document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('시작하기')) b.click(); }); });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'test-shots/game.png' });
await p.evaluate(() => UI.openMap('map'));
await p.waitForTimeout(900);
await p.screenshot({ path: 'test-shots/game-map.png' });
await b.close();
