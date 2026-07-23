/* 양 캐릭터를 크게 뽑아 본다.  npm run serve 후  node tools/shot-char.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{ width:1200, height:700 } });
await p.goto('http://localhost:8899/index.html?v=' + Date.now());
await p.waitForTimeout(1500);
const d = await p.evaluate(() => {
  const S = 3.6, W = 1180, H = 660;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // 실제 게임 바닥(짚) 위에 얹어 대비를 본다
  g.fillStyle = '#8a6b3b'; g.fillRect(0, 0, W, H/2);
  g.fillStyle = '#4a4033'; g.fillRect(0, 230, W, 200);
  g.fillStyle = '#7b5733'; g.fillRect(0, 430, W, 230);
  const cols = ['red','blue','white','yellow','black','pink'];
  cols.forEach((id, i) => {
    const col = colorOf(id);
    const x = 100 + i * 196, y = 110;
    // 서 있는 모습
    g.save(); g.translate(x, y); g.scale(S, S);
    Render.charShape(g, col, { moving:false, t:800 });
    g.restore();
    // 걷는 모습
    g.save(); g.translate(x, y + 215); g.scale(S, S);
    Render.charShape(g, col, { moving:true, t:180 });
    g.restore();
    // 시체
    g.save(); g.translate(x, y + 420); g.scale(S, S);
    Render.drawBody(g, { x:0, y:0, color:id });
    g.restore();
    g.fillStyle = '#fff'; g.font = '700 14px system-ui'; g.textAlign = 'center';
    g.fillText(col.name, x, y + 118);
  });
  return c.toDataURL('image/png');
});
fs.writeFileSync('test-shots/char-sheet.png', Buffer.from(d.split(',')[1], 'base64'));
await b.close();
console.log('saved test-shots/char-sheet.png');
