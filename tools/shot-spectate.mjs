/* 유령 관전 검증 — 게임 시작 후 나를 죽이고, ▶ 로 봇을 따라가는 화면을 캡처한다.
 * npm run serve 후  node tools/shot-spectate.mjs */
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
await p.evaluate(() => Game.start());
await p.waitForTimeout(1800);
await p.evaluate(() => { document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('시작하기')) b.click(); }); });
await p.waitForTimeout(800);

// 내가 늑대면 봇과 역할을 바꾼다 — 늑대인 나를 죽이면 그대로 게임이 끝나버린다
await p.evaluate(() => {
  const me = Host.P[G.myId];
  if (isDuck(me.role)) {
    const bot = G.order.map(i => Host.P[i]).find(q => q.isBot);
    const r = bot.role; bot.role = me.role; me.role = r;
    Host.sendPrivateAll(); Host.pushState();
  }
});
await p.waitForTimeout(400);
// 방장(나)을 죽인다 — 유령 전환
await p.evaluate(() => { Host.doDeath(Host.P[G.myId], G.order[1]); Host.afterDeath(); });
await p.waitForTimeout(1200);
await p.evaluate(() => UI.closeAllModals());   // 킬 연출 정리
await p.waitForTimeout(600);
const s1 = await p.evaluate(() => ({
  ghost: G.ghost, phase: G.phase,
  barShown: !document.querySelector('#spectate-bar').classList.contains('hidden'),
  label: document.querySelector('#spec-name').textContent,
}));
console.log('유령:', s1.ghost, '· phase:', s1.phase, '· 관전 바 보임:', s1.barShown, '· 라벨:', s1.label);
await p.screenshot({ path: 'test-shots/spec-free.png' });

// ▶ 눌러 봇 따라가기
await p.evaluate(() => Game.spectNext(1));
await p.waitForTimeout(1500);
const s2 = await p.evaluate(() => {
  const t = G.players[G.spectate];
  if (!t) return { spectate: G.spectate, name: null, label: document.querySelector('#spec-name').textContent };
  return { spectate: G.spectate, name: t.name, label: document.querySelector('#spec-name').textContent,
           camDx: Math.round(Render.cam.x - (t.rx ?? t.x)), camDy: Math.round(Render.cam.y - (t.ry ?? t.y)) };
});
console.log('따라가는 중:', s2.name, '· 라벨:', s2.label, '· 카메라-대상 오차:', s2.camDx + ',' + s2.camDy);
await p.screenshot({ path: 'test-shots/spec-follow.png' });

// 다음 사람으로 넘기고, 이동 입력으로 해제
await p.evaluate(() => Game.spectNext(1));
await p.waitForTimeout(800);
const s3 = await p.evaluate(() => document.querySelector('#spec-name').textContent);
console.log('다음 대상:', s3);
await p.evaluate(() => { Game.stick.dx = 1; });
await p.waitForTimeout(300);
await p.evaluate(() => { Game.stick.dx = 0; });
const s4 = await p.evaluate(() => ({ spectate: G.spectate, label: document.querySelector('#spec-name').textContent }));
console.log('이동 입력 후:', s4.spectate === null ? '자유 이동 복귀 ✓' : '해제 실패 ✗', '· 라벨:', s4.label);
await p.screenshot({ path: 'test-shots/spec-off.png' });
await b.close();
