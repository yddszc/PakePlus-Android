'use strict';
/* 冒烟测试：用 jsdom 真实加载成品页面，模拟完整通关流程 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = path.join(__dirname, '..', '数字九宫格.html');
const PUZZLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'puzzles.json'), 'utf8'));

let failed = 0;
const errors = [];
function ok(cond, label, extra) {
  if (cond) {
    console.log('  [通过] ' + label);
  } else {
    failed++;
    console.log('  [失败] ' + label + (extra !== undefined ? '  -> ' + extra : ''));
  }
}

const vc = new VirtualConsole();
vc.on('jsdomError', function (e) {
  if (/scrollTo/.test(e.message)) return;
  errors.push(e.message);
});
vc.on('error', function (m) { errors.push(m); });

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const win = dom.window;
const doc = win.document;
const $ = function (id) { return doc.getElementById(id); };
const q = function (sel, root) { return (root || doc).querySelector(sel); };
const qa = function (sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); };
const click = function (el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); };
const sleep = function (ms) { return new Promise(function (r) { win.setTimeout(r, ms); }); };

(async function run() {
  await sleep(50);

  console.log('\n1) 首页渲染');
  ok(errors.length === 0, '脚本无运行时报错', errors.join(' | '));
  ok(qa('.diff-card').length === 4, '四个难度卡片', qa('.diff-card').length);
  ok($('m-total').textContent === '80', '总关卡数 80', $('m-total').textContent);
  ok(!$('screen-home').classList.contains('hide'), '首页可见');

  console.log('\n2) 关卡列表');
  click(qa('.diff-card')[0]);          // 简单
  ok($('screen-levels').classList.contains('hide') === false, '进入关卡列表');
  var lvs = qa('#lv-grid .lv');
  ok(lvs.length === 20, '简单模式 20 关', lvs.length);
  ok(qa('#lv-grid .lv.locked').length === 19, '初始仅第 1 关解锁', qa('#lv-grid .lv.locked').length);
  click(lvs[19]);
  ok($('toast').textContent.indexOf('解锁') >= 0, '点击未解锁关卡被拦截');
  ok($('lv-title').textContent === '简单模式', '标题正确', $('lv-title').textContent);

  console.log('\n3) 开局渲染');
  click(lvs[0]);
  ok(!$('screen-game').classList.contains('hide'), '进入游戏页');
  ok(qa('#board .cell').length === 81, '棋盘 81 格', qa('#board .cell').length);
  ok($('g-level').textContent === '简单 1', '关卡标题', $('g-level').textContent);
  var data = PUZZLES.easy[0];
  var givens = data.p.split('').filter(function (c) { return c !== '.'; }).length;
  ok(qa('#board .cell.given').length === givens, '给定数字数量 ' + givens, qa('#board .cell.given').length);
  ok(qa('#board .cell .val').filter(function (v) { return v.textContent !== ''; }).length === givens, '给定数字已渲染');
  ok(qa('#board .cell.br').length === 18, '3×3 宫粗竖线 18 处', qa('#board .cell.br').length);
  ok(qa('#board .cell.bb').length === 18, '3×3 宫粗横线 18 处', qa('#board .cell.bb').length);
  ok($('g-hint').textContent === '3', '初始 3 次提示', $('g-hint').textContent);

  console.log('\n4) 交互：选中 / 高亮 / 笔记 / 擦除 / 撤销 / 错误计数');
  var emptyIdx = [];
  for (var i = 0; i < 81; i++) if (data.p[i] === '.') emptyIdx.push(i);
  var cells = qa('#board .cell');
  click(cells[emptyIdx[0]]);
  ok(cells[emptyIdx[0]].classList.contains('sel'), '选中单元格');
  var peers = qa('#board .cell.peer').length;
  ok(peers === 20, '同行同列同宫高亮 20 格', peers);

  // 填一个错误数字
  var wrongDigit = Number(data.s[emptyIdx[0]]) === 9 ? 1 : Number(data.s[emptyIdx[0]]) + 1;
  click(q('#pad [data-num="' + wrongDigit + '"]'));
  ok($('g-mistake').textContent === '1', '错误计数 +1', $('g-mistake').textContent);
  ok(cells[emptyIdx[0]].classList.contains('wrong'), '错误格标红');

  // 撤销
  click($('t-undo'));
  ok($('g-mistake').textContent === '0', '撤销后错误计数回退', $('g-mistake').textContent);
  ok(!cells[emptyIdx[0]].classList.contains('wrong'), '撤销后红标消失');

  // 笔记模式
  function noteOn(cell, n) {
    return cell.lastChild.children[n - 1].style.visibility === 'visible';
  }
  click($('t-note'));
  ok($('t-note').classList.contains('on'), '笔记模式开启');
  click(q('#pad [data-num="5"]'));
  ok(noteOn(cells[emptyIdx[0]], 5), '候选数 5 已记录');
  click(cells[emptyIdx[0]]);
  click(q('#pad [data-num="5"]'));
  ok(!noteOn(cells[emptyIdx[0]], 5), '再次点击取消候选 5');
  click($('t-note'));
  ok(!$('t-note').classList.contains('on'), '笔记模式关闭');

  // 提示
  click($('t-hint'));
  ok($('g-hint').textContent === '2', '提示次数递减', $('g-hint').textContent);
  ok(qa('#board .cell.hinted').length === 1, '提示格有标记', qa('#board .cell.hinted').length);
  ok(cells[emptyIdx[0]].firstChild.textContent === data.s[emptyIdx[0]], '提示填入了正确答案');

  console.log('\n5) 完整通关简单第 1 关');
  // 重置一局，避免提示影响星级
  click($('btn-back'));
  click($('btn-replay'));
  await sleep(20);
  cells = qa('#board .cell');
  var placed = 0;
  for (var k = 0; k < 81; k++) {
    if (data.p[k] !== '.') continue;
    click(cells[k]);
    click(q('#pad [data-num="' + data.s[k] + '"]'));
    placed++;
  }
  ok(placed === 81 - givens, '填完所有空位 ' + placed + ' 个');
  ok($('g-mistake').textContent === '0', '全程零错误', $('g-mistake').textContent);
  await sleep(600);
  ok(!$('ov-win').classList.contains('hide'), '通关弹窗弹出');
  ok(qa('#win-stars span.on').length === 3, '获得三星', qa('#win-stars span.on').length);
  ok($('w-time').textContent.match(/^\d\d:\d\d$/) !== null, '用时格式正确', $('w-time').textContent);

  console.log('\n6) 进度保存与解锁');
  var saved = JSON.parse(win.localStorage.getItem('sudoku9.progress.v1'));
  ok(saved.easy.done['1'].stars === 3, '星级已写入 localStorage', JSON.stringify(saved.easy.done));
  ok(saved.easy.u === 2, '第 2 关已解锁', saved.easy.u);

  console.log('\n7) 下一关按钮');
  click($('btn-next'));
  await sleep(20);
  ok($('g-level').textContent === '简单 2', '进入下一关', $('g-level').textContent);
  ok(qa('#board .cell.given').length ===
      PUZZLES.easy[1].p.split('').filter(function (c) { return c !== '.'; }).length, '第 2 关题目正确');

  console.log('\n8) 暂停 / 恢复');
  click($('btn-pause'));
  ok(!$('ov-pause').classList.contains('hide'), '暂停遮罩弹出');
  click($('btn-resume'));
  ok($('ov-pause').classList.contains('hide'), '恢复游戏');

  console.log('\n9) 难度切换（地狱）');
  click($('btn-back'));
  click($('btn-quit'));
  click($('btn-lv-back'));
  click(qa('.diff-card')[3]);
  ok($('lv-title').textContent === '地狱模式', '切入地狱模式', $('lv-title').textContent);
  click(qa('#lv-grid .lv')[0]);
  ok($('g-level').textContent === '地狱 1', '地狱第 1 关', $('g-level').textContent);
  var hp = PUZZLES.hell[0];
  var hg = hp.p.split('').filter(function (c) { return c !== '.'; }).length;
  ok(qa('#board .cell.given').length === hg, '地狱第 1 关给定数 ' + hg, qa('#board .cell.given').length);

  console.log('\n10) 键盘操作');
  var kb = function (key, opts) {
    var e = new win.KeyboardEvent('keydown', Object.assign({ key: key, bubbles: true, cancelable: true }, opts || {}));
    doc.dispatchEvent(e);
  };
  var firstEmpty = -1;
  var secondEmpty = -1;
  for (var m = 0; m < 81; m++) {
    if (hp.p[m] !== '.') continue;
    if (firstEmpty < 0) firstEmpty = m;
    else if (secondEmpty < 0 && m === firstEmpty + 1) secondEmpty = m;
  }
  var cc = qa('#board .cell');
  click(cc[firstEmpty]);
  ok(cc[firstEmpty].classList.contains('sel'), '点击选中空格');
  kb('ArrowRight');
  ok(cc[firstEmpty + 1].classList.contains('sel'), '方向键移动光标');
  click(cc[firstEmpty]);
  kb(String(hp.s[firstEmpty]));
  ok(cc[firstEmpty].firstChild.textContent === String(hp.s[firstEmpty]), '键盘填数落格',
      cc[firstEmpty].firstChild.textContent);
  ok(cc[firstEmpty].classList.contains('wrong') === false, '正确数字不标红');
  ok($('g-mistake').textContent === '0', '键盘填错才计错', $('g-mistake').textContent);
  kb('Delete');
  ok(cc[firstEmpty].firstChild.textContent === '', 'Delete 擦除');
  kb('z', { ctrlKey: true });
  ok(cc[firstEmpty].firstChild.textContent === String(hp.s[firstEmpty]), 'Ctrl+Z 撤销恢复');
  kb('Escape');
  ok(!$('ov-pause').classList.contains('hide'), 'Esc 暂停');
  kb('Escape');
  ok($('ov-pause').classList.contains('hide'), 'Esc 恢复');
  ok(errors.length === 0, '全程无脚本报错', errors.join(' | '));

  console.log('\n' + (failed === 0 ? '全部测试通过' : '存在 ' + failed + ' 项失败'));
  dom.window.close();
  process.exit(failed === 0 ? 0 : 1);
})();
