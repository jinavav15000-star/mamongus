/* 늑대 사냥 모드 검증 — 봇 3명 + 사냥 모드로 시작해 역할 안내·카운트다운·봇 추격을 캡처.
 * npm run serve 후  node tools/shot-hunt.mjs
 * (봇 늑대는 첫 킬 유예 20초 뒤부터 사냥한다 — 스크립트가 30초쯤 걸리는 이유) */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:900,height:520} });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2500);
await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4000);
await p.evaluate(() => { for (let i = 0; i < 3; i++) Host.addBot(); });
await p.waitForTimeout(600);
await p.evaluate(() => Game.setSetting('mode', 'hunt'));
await p.waitForTimeout(400);
console.log('mode =', await p.evaluate(() => G.settings.mode));
await p.evaluate(() => Game.start());
await p.waitForTimeout(1800);
await p.screenshot({ path: 'test-shots/hunt-role.png' });          // 역할 안내 (사냥 문구)
await p.evaluate(() => { document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('시작하기')) b.click(); }); });
await p.waitForTimeout(1500);

const st = await p.evaluate(() => ({
  hunt: G.hunt, myRole: G.myRole,
  alert: document.querySelector('#alertbar')?.textContent || '',
  reportBtn: !!document.querySelector('#btn-report'),
  left: Math.round((G.hunt.endsAt - (Date.now() + Net.clockOffset)) / 1000),
}));
console.log('내 역할:', st.myRole, '· 늑대:', st.hunt.wolves, '· 남은 시간:', st.left + 's');
console.log('알림바:', st.alert.trim(), '· 신고 버튼 존재:', st.reportBtn, '(false 여야 함)');
await p.screenshot({ path: 'test-shots/hunt-play.png' });          // 카운트다운 + 🐺 배지

// 첫 킬 유예(20초)가 끝난 뒤 봇 늑대가 실제로 사냥하는지
await p.waitForTimeout(24000);
const after = await p.evaluate(() => ({
  dead: Object.values(G.players).filter(q => !q.alive).length,
  bodies: G.bodies.length, phase: G.phase,
  left: G.hunt ? Math.round((G.hunt.endsAt - (Date.now() + Net.clockOffset)) / 1000) : null,
}));
console.log('25초 후 — 사망:', after.dead, '· 시체:', after.bodies, '· phase:', after.phase, '· 남은 시간:', after.left + 's');
await p.screenshot({ path: 'test-shots/hunt-chase.png' });
await b.close();
