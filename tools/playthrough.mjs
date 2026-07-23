/* 한 판을 끝까지 진행하며 각 화면을 잡는다.  npm run serve 후  node tools/playthrough.mjs
 * 실제 폰 크기(갤럭시 가로)로 돌려야 잘림·겹침이 드러난다. */
import { chromium, devices } from 'playwright';
const G9 = devices['Galaxy S9+'];
const b = await chromium.launch();
const ctx = await b.newContext({ ...G9, viewport:{ width:740, height:360 }, isMobile:true, hasTouch:true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('console', m => m.type() === 'error' && errs.push('CONSOLE: ' + m.text()));
const shot = async (n) => { await p.screenshot({ path: `test-shots/pt-${n}.png` }); console.log('  📸', n); };

await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(2200);
await shot('01-home');

await p.evaluate(() => Game.createRoom());
await p.waitForTimeout(4500);
await shot('02-lobby');
await p.evaluate(() => document.querySelectorAll('.tabs button')[1]?.click());
await p.waitForTimeout(400); await shot('03-settings');
await p.evaluate(() => document.querySelectorAll('.tabs button')[2]?.click());
await p.waitForTimeout(400); await shot('04-roles');
await p.evaluate(() => document.querySelectorAll('.tabs button')[0]?.click());

await p.evaluate(() => { for (let i=0;i<5;i++) Host.addBot(); });
await p.waitForTimeout(700);
await p.evaluate(() => Game.start());
await p.waitForTimeout(1800);
await shot('05-role-reveal');
await p.evaluate(() => document.querySelectorAll('button').forEach(b => b.textContent.includes('시작하기') && b.click()));
await p.waitForTimeout(1600);
await shot('06-game');
console.log('  내 직업:', await p.evaluate(() => G.myRole));

// 임무 목록 · 지도
await p.evaluate(() => UI.openMap('map')); await p.waitForTimeout(600); await shot('07-map');
await p.evaluate(() => UI.closeModal());
await p.evaluate(() => UI.openMenu()); await p.waitForTimeout(500); await shot('08-menu');
await p.evaluate(() => UI.closeModal());

// 사보타주 경보
await p.evaluate(() => { Host.onSabotage(Object.keys(G.players).find(id=>Host.P[id]?.role==='duck')||G.myId, 'lights'); });
await p.waitForTimeout(900); await shot('09-sabotage');
await p.evaluate(() => { G.sabotage=null; Host.G && (Host.G.sabotage=null); if (Host.P) Host.clearSab?.(); });

// 회의 → 투표 → 추방 → 결과
await p.evaluate(() => { const me=Host.P[G.myId]; me.ventId=null; Host.startMeeting(G.myId, null); });
await p.waitForTimeout(1500); await shot('10-meeting');
await p.evaluate(() => Meeting.send?.('테스트 발언입니다') ?? Net.toHost('chat',{text:'테스트 발언입니다',channel:'meeting'}));
await p.waitForTimeout(600); await shot('11-meeting-chat');
await p.evaluate(() => Host.toVote?.() ?? Host.startVote?.());
await p.waitForTimeout(1200); await shot('12-vote');
await p.evaluate(() => { const t = G.order.find(i=>i!==G.myId); Host.onVote(G.myId, t); G.order.forEach(i=>{ if(i!==G.myId) Host.onVote(i,t); }); });
await p.waitForTimeout(2500); await shot('13-eject');
await p.waitForTimeout(4000); await shot('14-after-eject');

console.log(errs.length ? '\n⚠️ 오류:\n' + errs.join('\n') : '\n✅ 콘솔 오류 없음');
await b.close();
