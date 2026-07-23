/* 정밀 점검 — 실제 탭으로 전 시스템을 순회하며 오류·잘림·상태 꼬임을 찾는다.
 * npm run serve 후  node tools/sweep.mjs */
import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Galaxy S9+'], viewport:{width:740,height:360}, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const errs = [];
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : (fail++, console.log('  ❌', n, JSON.stringify(e ?? ''))); };
p.on('pageerror', e => errs.push('PAGE: ' + e.message));
p.on('console', m => m.type() === 'error' && errs.push('CON: ' + m.text()));

await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2000);
await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4200);

/* ── 대기실 ── */
await p.evaluate(() => { for (let i=0;i<4;i++) Host.addBot(); });
await p.waitForTimeout(800);
ok('로비: 맵 모드', await p.evaluate(() => document.getElementById('screen-game').classList.contains('lobby-mode')));
// 이모트 둘 다
for (const id of ['#btn-wave', '#btn-fart']) {
  await p.evaluate((sel) => document.querySelector(sel).dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})), id);
  await p.waitForTimeout(300);
}
ok('로비: 이모트 연출 생성', await p.evaluate(() => Render.fx.some(f => f.kind === 'emoji')));
// 패널 열닫
await p.evaluate(() => UI.openLobbyPanel());
ok('로비: 패널 열림', await p.evaluate(() => !document.getElementById('screen-lobby').classList.contains('hidden')));
await p.evaluate(() => UI.closeLobbyPanel());

/* ── 게임 시작 → 모든 미니게임 모달이 탭으로 열리고 유지되는가 ── */
await p.evaluate(() => Game.start());
await p.waitForTimeout(1800);
await p.evaluate(() => document.querySelectorAll('button').forEach(b => b.textContent.includes('시작하기') && b.click()));
await p.waitForTimeout(1000);
ok('시작: 게임 화면 + lobby-mode 해제', await p.evaluate(() =>
  UI.screen === 'game' && !document.getElementById('screen-game').classList.contains('lobby-mode')));
ok('시작: 이모트 버튼 숨김', await p.evaluate(() => document.getElementById('lobby-hud').classList.contains('hidden')));

// 내 임무를 전부 순회하며 탭 → 모달 유지 확인
const nTasks = await p.evaluate(() => G.myTasks.length);
for (let i = 0; i < nTasks; i++) {
  const r = await p.evaluate((idx) => {
    const t = G.myTasks[idx];
    if (!t || t.step >= t.spots.length) return null;
    const sp = TASK_SPOTS.find(x => x.id === t.spots[t.step]);
    const me = Host.P[G.myId]; me.x = sp.wx; me.y = sp.wy; G.me.x = sp.wx; G.me.y = sp.wy;
    return { kind: sp.kind };
  }, i);
  if (!r) continue;
  // 순간이동 직후 첫 탭은 스냅샷 경합이 있을 수 있어 실패 시 한 번 재시도한다.
  // 재시도도 실패하면 진짜 버그다. (실제 플레이어는 걸어서 도착하므로 경합이 없다)
  let stay = null;
  for (let attempt = 0; attempt < 2 && !stay?.모달; attempt++) {
    await p.waitForTimeout(400);
    const bb = await (await p.$('#btn-use')).boundingBox();
    await p.touchscreen.tap(bb.x + bb.width/2, bb.y + bb.height/2);
    await p.waitForTimeout(550);
    stay = await p.evaluate(() => ({ 모달: UI.hasModal(), 대상: Game.findUseTarget(G.me)?.kind }));
  }
  ok(`임무 모달 유지: ${r.kind}`, stay.모달, stay);
  await p.evaluate(() => UI.closeAllModals());
  await p.waitForTimeout(150);
}

/* ── 회의 → 투표 → 추방 ── */
await p.evaluate(() => {
  G.settings.discussSec = 2; G.settings.voteSec = 5;
  const me = Host.P[G.myId];
  me.x = EMERGENCY_BTN.wx; me.y = EMERGENCY_BTN.wy; G.me.x = me.x; G.me.y = me.y;
  me.emergencyLeft = Math.max(1, me.emergencyLeft);
  Host.onEmergency(G.myId);
});
await p.waitForTimeout(3500);
ok('회의: 투표 단계', (await p.evaluate(() => G.meeting?.phase)) === 'vote');
await p.evaluate(() => { const t = G.order.find(i=>i!==G.myId); G.order.forEach(i => Host.onVote(i, t)); });
await p.waitForTimeout(2500);
ok('추방: 화면 표시', (await p.evaluate(() => UI.screen)) === 'eject');
await p.waitForTimeout(7000);   // 추방 연출 4.6초 + 복귀 전환
{
  // 추방된 봇이 마지막 늑대였다면 게임이 정당하게 끝난다 — 둘 다 정상
  const scr = await p.evaluate(() => UI.screen);
  ok('추방 후: 게임 복귀 또는 정상 종료', scr === 'game' || scr === 'result', scr);
  if (scr === 'result') {
    await p.evaluate(() => Host.toLobby());
    await p.waitForTimeout(1200);
  }
}

/* ── 유령 상태 (게임이 계속 중일 때만) ── */
if ((await p.evaluate(() => G.phase)) === 'play') {
  await p.evaluate(() => { const me = Host.P[G.myId]; if (me.alive) { Host.doDeath(me, G.order.find(i=>i!==G.myId)); Host.afterDeath(); Host.pushState(); } });
  await p.waitForTimeout(1500);
  ok('유령: ghost 플래그', await p.evaluate(() => !!G.ghost));
  ok('유령: 유령채팅 버튼', await p.evaluate(() => !document.getElementById('btn-ghostchat').classList.contains('hidden')));
}

/* ── 종료 → 로비 복귀 ── */
if ((await p.evaluate(() => G.phase)) === 'play') {
  await p.evaluate(() => Host.finish('duck', '테스트 종료'));
  await p.waitForTimeout(1500);
  ok('결과 화면', (await p.evaluate(() => UI.screen)) === 'result');
}
if ((await p.evaluate(() => UI.screen)) === 'result') { await p.evaluate(() => Host.toLobby()); await p.waitForTimeout(1200); }
ok('로비 복귀: 맵 모드', await p.evaluate(() =>
  UI.screen === 'game' && document.getElementById('screen-game').classList.contains('lobby-mode')));
ok('로비 복귀: 이모트 버튼 복귀', await p.evaluate(() => !document.getElementById('lobby-hud').classList.contains('hidden')));

console.log(`\n  통과 ${pass} · 실패 ${fail}`);
console.log(errs.length ? '⚠️ 오류:\n' + [...new Set(errs)].slice(0,8).join('\n') : '✅ 콘솔 오류 없음');
await b.close();
process.exit(fail || errs.length ? 1 : 0);
