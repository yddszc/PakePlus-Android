'use strict';
/* 用无头 Chrome + CDP 真实渲染截图，检查视觉与布局 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const CDP = require('chrome-remote-interface');

const CHROME = 'C:\\Users\\hbpc\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PAGE = 'file:///' + path.join(__dirname, '..', '数字九宫格.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, 'shots');
const PROFILE = path.join(__dirname, '.chrome-profile');
const PORT = 9333;
const PUZZLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzles.json'), 'utf8'));

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

let child = null;
(async function main() {
  child = execFile(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--window-size=1280,1000', 'about:blank',
  ], function () {});
  await sleep(2000);

  let client;
  for (let i = 0; i < 25 && !client; i++) {
    try { client = await CDP({ port: PORT }); }
    catch (e) { await sleep(400); }
  }
  if (!client) { console.error('无法连接 Chrome'); process.exit(1); }

  const { Page, Runtime, Emulation } = client;
  await Page.enable();
  await Runtime.enable();

  const navigate = async function () {
    const loaded = Page.loadEventFired();
    await Page.navigate({ url: PAGE });
    await Promise.race([loaded, sleep(4000)]);
    await sleep(500);
  };

  const run = async function (expr) {
    const r = await Runtime.evaluate({ expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + '  @  ' + expr.slice(0, 80));
    return r.result.value;
  };
  const size = async function (w, h) {
    await Emulation.setDeviceMetricsOverride({ width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  };
  let n = 0;
  const shot = async function (name) {
    const r = await Page.captureScreenshot({ format: 'png', captureBeyondViewport: false, fromSurface: true });
    fs.writeFileSync(path.join(OUT, String(++n).padStart(2, '0') + '-' + name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('已截图 ' + String(n).padStart(2, '0') + '-' + name + '.png');
  };

  // 干净的初始状态
  await size(1280, 1000);
  await navigate();
  await run('try{localStorage.clear()}catch(e){}');
  await navigate();

  await shot('home-desktop');

  await run('document.querySelectorAll(".diff-card")[2].click()');
  await sleep(200);
  await shot('level-list');

  await run('document.querySelectorAll("#lv-grid .lv")[0].click()');
  await sleep(250);
  await shot('game-empty');

  // 造一个真实对局状态：填对若干、填错一个、加候选数、选中一格
  const d = PUZZLES.hard[0];
  await run(`(function(){
    var cells = document.querySelectorAll('#board .cell');
    var put = function(i, digit){ cells[i].click(); document.querySelector('#pad [data-num="'+digit+'"]').click(); };
    var SOL = ${JSON.stringify(d.s.split(''))};
    var PZ  = ${JSON.stringify(d.p.split(''))};
    var empty = []; for (var i=0;i<81;i++) if (PZ[i]==='.') empty.push(i);
    // 前 12 个空填正确答案
    for (var k=0;k<12;k++) put(empty[k], SOL[empty[k]]);
    // 第 13 个空填一个错误数字
    var wi = empty[12];
    var wrong = Number(SOL[wi]) === 9 ? 1 : Number(SOL[wi]) + 1;
    put(wi, wrong);
    // 笔记模式给两个空格记候选
    document.getElementById('t-note').click();
    var n1 = empty[13], n2 = empty[14], n3 = empty[15];
    cells[n1].click(); [1,4,7].forEach(function(x){ document.querySelector('#pad [data-num="'+x+'"]').click(); });
    cells[n2].click(); [2,5,9].forEach(function(x){ document.querySelector('#pad [data-num="'+x+'"]').click(); });
    cells[n3].click(); [3,6,8].forEach(function(x){ document.querySelector('#pad [data-num="'+x+'"]').click(); });
    document.getElementById('t-note').click();
    // 选中一个已填正确的格子，展示同数字高亮
    cells[empty[0]].click();
    return 'ok';
  })()`);
  await sleep(250);
  await shot('game-playing');

  // 暂停
  await run('document.getElementById("btn-pause").click()');
  await sleep(200);
  await shot('pause');
  await run('document.getElementById("btn-resume").click()');
  await sleep(150);

  // 通关弹窗（直接跳到简单第 1 关并解完）
  await run('document.getElementById("btn-back").click()');
  await sleep(150);
  await run('document.getElementById("btn-quit").click()');
  await sleep(150);
  await run('document.getElementById("btn-lv-back").click()');
  await sleep(150);
  await run('document.querySelectorAll(".diff-card")[0].click()');
  await sleep(150);
  await run('document.querySelectorAll("#lv-grid .lv")[0].click()');
  await sleep(200);
  const e1 = PUZZLES.easy[0];
  await run(`(function(){
    var cells = document.querySelectorAll('#board .cell');
    var SOL = ${JSON.stringify(e1.s.split(''))};
    var PZ  = ${JSON.stringify(e1.p.split(''))};
    for (var i=0;i<81;i++) if (PZ[i]==='.') { cells[i].click(); document.querySelector('#pad [data-num="'+SOL[i]+'"]').click(); }
    return 'ok';
  })()`);
  await sleep(900);
  await shot('win');
  await run('document.getElementById("btn-tolist").click()');
  await sleep(250);
  await shot('level-list-stars');

  // 移动端
  await size(390, 844);
  await sleep(300);
  await run('document.querySelectorAll("#lv-grid .lv")[0].click()');
  await sleep(250);
  await shot('mobile-game');

  await client.close();
  child.kill();
  console.log('完成，共 ' + n + ' 张');
  process.exit(0);
})().catch(function (e) {
  console.error('出错: ' + e.message);
  if (child) child.kill();
  process.exit(1);
});
