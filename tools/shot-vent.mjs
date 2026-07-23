/* 벤트에 들어갔을 때 화면을 확인한다.  npm run serve 후  node tools/shot-vent.mjs */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:900,height:560} });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2000);
await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4000);
await p.evaluate(() => { for (let i=0;i<4;i++) Host.addBot(); });
await p.waitForTimeout(800);
// 반드시 늑대가 되도록 역할을 고정한 뒤 시작
await p.evaluate(() => { Host.startGame(); const me = Host.P[G.myId]; me.role = 'duck'; G.myRole = 'duck'; Host.pushState(); });
await p.waitForTimeout(2000);
await p.evaluate(() => document.querySelectorAll('button').forEach(b => b.textContent.includes('시작하기') && b.click()));
await p.waitForTimeout(1500);
// 가장 가까운 벤트로 순간이동 후 진입
await p.evaluate(() => {
  const v = VENTS[0];
  const me = Host.P[G.myId]; me.x = v.wx; me.y = v.wy; G.me.x = v.wx; G.me.y = v.wy;
  Host.onVent(G.myId, v.id); Host.pushState();
});
await p.waitForTimeout(1200);
const st = await p.evaluate(() => ({
  벤트안: !!G.me.ventId,
  사용버튼_비활성: document.getElementById('btn-use').disabled,
  신고버튼_비활성: UI.btn.report?.disabled,
  벤트버튼_라벨: UI.btn.vent?.querySelector('span:nth-child(2)')?.textContent,
}));
console.log(JSON.stringify(st, null, 1));
await p.screenshot({ path: 'test-shots/vent-in.png' });
await b.close();
