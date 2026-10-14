'use strict';
/* 把题库注入模板，产出最终单文件 HTML */
const fs = require('fs');
const path = require('path');

const tplPath = path.join(__dirname, 'game.template.html');
const dataPath = path.join(__dirname, 'puzzles.json');
const outPath = path.join(__dirname, '..', '数字九宫格.html');

const tpl = fs.readFileSync(tplPath, 'utf8');
const data = fs.readFileSync(dataPath, 'utf8');

if (tpl.indexOf('__PUZZLE_DATA__') === -1) {
  console.error('模板中未找到占位符 __PUZZLE_DATA__');
  process.exit(1);
}

// JSON 中不含反引号 / ${，可安全嵌入模板字符串
const out = tpl.replace('__PUZZLE_DATA__', data.replace(/\\/g, '\\\\').replace(/`/g, '\\`'));
fs.writeFileSync(outPath, out);

const count = Object.keys(JSON.parse(data)).reduce((a, k) => a + JSON.parse(data)[k].length, 0);
console.log('已生成 ' + outPath);
console.log('题目总数 ' + count + ' 题，文件大小 ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
