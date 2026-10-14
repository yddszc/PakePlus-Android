'use strict';
/*
 * 数独题库生成器
 * 4 个难度 × 20 关 = 80 道唯一解题
 * 策略：种子随机 -> 生成完整终盘 -> 挖洞（每挖一次校验唯一解）-> 多轮取最优
 */
const fs = require('fs');
const path = require('path');

/* ---------------- 基础工具 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROW = new Int32Array(81);
const COL = new Int32Array(81);
const BOX = new Int32Array(81);
for (let i = 0; i < 81; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
  BOX[i] = (((i / 9) | 0) / 3 | 0) * 3 + (((i % 9) / 3) | 0);
}

const POP = new Int32Array(512);
for (let m = 0; m < 512; m++) POP[m] = (m & 1) + POP[m >> 1];
const BITVAL = new Int32Array(512);
for (let d = 1; d <= 9; d++) BITVAL[1 << (d - 1)] = d;

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/* ---------------- 求解 / 计数（位运算 + MRV） ---------------- */
function buildMasks(board) {
  const rows = new Int32Array(9);
  const cols = new Int32Array(9);
  const boxes = new Int32Array(9);
  for (let i = 0; i < 81; i++) {
    const v = board[i];
    if (v) {
      const b = 1 << (v - 1);
      rows[ROW[i]] |= b;
      cols[COL[i]] |= b;
      boxes[BOX[i]] |= b;
    }
  }
  return { rows, cols, boxes };
}

/** 统计解的个数，最多数到 limit 个就提前返回 */
function countSolutions(board, limit) {
  const { rows, cols, boxes } = buildMasks(board);
  let count = 0;

  function rec() {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (board[i]) continue;
      const avail = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 0x1ff;
      const c = POP[avail];
      if (c === 0) return;
      if (c < bestCount) {
        bestCount = c;
        best = i;
        bestMask = avail;
        if (c === 1) break;
      }
    }
    if (best === -1) {
      count++;
      return;
    }
    const r = ROW[best];
    const c = COL[best];
    const b = BOX[best];
    let m = bestMask;
    while (m) {
      const bit = m & -m;
      m ^= bit;
      board[best] = BITVAL[bit];
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      rec();
      board[best] = 0;
      rows[r] ^= bit;
      cols[c] ^= bit;
      boxes[b] ^= bit;
      if (count >= limit) return;
    }
  }

  rec();
  return count;
}

/** 找出唯一解（用于校验） */
function solveOnce(board) {
  const work = Int8Array.from(board);
  const { rows, cols, boxes } = buildMasks(work);
  function rec() {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (work[i]) continue;
      const avail = ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & 0x1ff;
      const c = POP[avail];
      if (c === 0) return false;
      if (c < bestCount) {
        bestCount = c;
        best = i;
        bestMask = avail;
        if (c === 1) break;
      }
    }
    if (best === -1) return true;
    const r = ROW[best];
    const c = COL[best];
    const b = BOX[best];
    let m = bestMask;
    while (m) {
      const bit = m & -m;
      m ^= bit;
      work[best] = BITVAL[bit];
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (rec()) return true;
      work[best] = 0;
      rows[r] ^= bit;
      cols[c] ^= bit;
      boxes[b] ^= bit;
    }
    return false;
  }
  rec();
  return work;
}

/* ---------------- 生成完整终盘 ---------------- */
function generateFull(rng) {
  const board = new Int8Array(81);
  const rows = new Int32Array(9);
  const cols = new Int32Array(9);
  const boxes = new Int32Array(9);
  function rec(pos) {
    if (pos === 81) return true;
    const r = ROW[pos];
    const c = COL[pos];
    const b = BOX[pos];
    const used = rows[r] | cols[c] | boxes[b];
    const avail = shuffle(
      Array.from({ length: 9 }, (_, k) => k + 1).filter((d) => !(used & (1 << (d - 1)))),
      rng
    );
    for (const d of avail) {
      const bit = 1 << (d - 1);
      board[pos] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (rec(pos + 1)) return true;
      board[pos] = 0;
      rows[r] ^= bit;
      cols[c] ^= bit;
      boxes[b] ^= bit;
    }
    return false;
  }
  rec(0);
  return board;
}

/* ---------------- 逻辑难度评估 ----------------
 * 只用「唯余法(裸单/隐单)」能推进的格数越多 -> 题目越简单。
 * 返回可被逻辑解出的格数（越小越难，需要回溯猜测）。
 */
function logicScore(board) {
  const g = Int8Array.from(board);
  let filled = 0;

  function candidates(pos) {
    let used = 0;
    for (let k = 0; k < 9; k++) {
      const rv = g[ROW[pos] * 9 + k];
      const cv = g[k * 9 + COL[pos]];
      if (rv) used |= 1 << (rv - 1);
      if (cv) used |= 1 << (cv - 1);
    }
    const br = ((ROW[pos] / 3) | 0) * 3;
    const bc = ((COL[pos] / 3) | 0) * 3;
    for (let a = 0; a < 3; a++) {
      for (let b2 = 0; b2 < 3; b2++) {
        const v = g[(br + a) * 9 + bc + b2];
        if (v) used |= 1 << (v - 1);
      }
    }
    return ~used & 0x1ff;
  }

  let guard = 0;
  let progress = true;
  while (progress && guard++ < 200) {
    progress = false;
    // 裸单
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = candidates(i);
      if (m === 0) return filled;
      if ((m & (m - 1)) === 0) {
        g[i] = BITVAL[m];
        filled++;
        progress = true;
      }
    }
    if (progress) continue;
    // 隐单：某单元内某数字只剩一个可能位置
    const units = [];
    for (let u = 0; u < 9; u++) {
      const r = [];
      const c = [];
      const bx = [];
      for (let k = 0; k < 9; k++) {
        r.push(u * 9 + k);
        c.push(k * 9 + u);
        bx.push((((u / 3) | 0) * 3 + ((k / 3) | 0)) * 9 + ((u % 3) * 3 + (k % 3)));
      }
      units.push(r, c, bx);
    }
    outer: for (const unit of units) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        let spot = -1;
        let n = 0;
        let taken = false;
        for (const p of unit) {
          if (g[p] === d) {
            taken = true;
            break;
          }
          if (g[p]) continue;
          if (candidates(p) & bit) {
            n++;
            spot = p;
          }
        }
        if (!taken && n === 1) {
          g[spot] = d;
          filled++;
          progress = true;
          break outer;
        }
      }
    }
  }
  return filled;
}

/* ---------------- 挖洞 ---------------- */
function dig(solution, rng, targetGivens) {
  const board = Int8Array.from(solution);
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i), rng);
  let givens = 81;
  for (const pos of order) {
    if (givens <= targetGivens) break;
    const save = board[pos];
    board[pos] = 0;
    if (countSolutions(board, 2) === 1) {
      givens--;
    } else {
      board[pos] = save;
    }
  }
  return { board, givens };
}

/* ---------------- 难度配置 ----------------
 * 统一难度标尺 hardness = 空格数 - 唯余法可解格数
 *   也就是「必须靠试探/回溯才能确定的格子数」，越大越难。
 * givens / hardness 均为该难度 20 关从第 1 关到第 20 关的目标区间。
 */
const LEVELS = [
  { key: 'easy',   name: '简单', givens: [46, 41], hardness: [0, 1],   attempts: 14 },
  { key: 'medium', name: '中级', givens: [38, 33], hardness: [1, 6],   attempts: 34 },
  { key: 'hard',   name: '高级', givens: [31, 27], hardness: [10, 25], attempts: 120 },
  { key: 'hell',   name: '地狱', givens: [24, 22], hardness: [28, 50], attempts: 200 },
];

const TOTAL_PER_LEVEL = 20;

function evaluate(board, givens) {
  const empty = 81 - givens;
  const filled = logicScore(board);
  return { empty: empty, filled: filled, hardness: empty - filled };
}

/* ---------------- 主流程 ---------------- */
const result = {};
const report = [];

for (const cfg of LEVELS) {
  const picked = [];

  for (let lv = 1; lv <= TOTAL_PER_LEVEL; lv++) {
    const t = (lv - 1) / (TOTAL_PER_LEVEL - 1);
    const targetGivens = Math.round(cfg.givens[0] + (cfg.givens[1] - cfg.givens[0]) * t);
    const targetHardness = cfg.hardness[0] + (cfg.hardness[1] - cfg.hardness[0]) * t;

    let best = null;
    for (let a = 0; a < cfg.attempts; a++) {
      const seed = (0x9e3779b9 ^ (cfg.key.length * 7919) ^ (lv * 104729) ^ (a * 2654435761)) >>> 0;
      const rng = mulberry32(seed);
      const full = generateFull(rng);
      const { board, givens } = dig(full, rng, targetGivens);
      const ev = evaluate(board, givens);
      const err = Math.abs(ev.hardness - targetHardness) / 8 + Math.abs(givens - targetGivens) / 4;
      const cand = { board: board, full: full, givens: givens, ev: ev, err: err };
      if (!best || err < best.err) best = cand;
      if (best.err < 0.12) break;
    }
    picked.push(best);
  }

  // 同难度内按难度标尺严格递增重排（同分则提示数多的在前），保证第 20 关最难
  picked.sort(function (a, b) {
    if (a.ev.hardness !== b.ev.hardness) return a.ev.hardness - b.ev.hardness;
    return b.givens - a.givens;
  });

  result[cfg.key] = picked.map(function (c, idx) {
    return {
      d: cfg.key,
      l: idx + 1,
      p: Array.from(c.board).map(function (v) { return v || '.'; }).join(''),
      s: Array.from(c.full).join(''),
    };
  });

  picked.forEach(function (c, idx) {
    report.push(
      `${cfg.name} 第${String(idx + 1).padStart(2)}关  提示数=${String(c.givens).padStart(2)}` +
        `  需试探格数=${String(c.ev.hardness).padStart(2)}/${c.ev.empty}  推理可解=${c.ev.filled}`
    );
  });
}

/* ---------------- 校验 ---------------- */
let errors = 0;
for (const key of Object.keys(result)) {
  for (const item of result[key]) {
    const board = Int8Array.from(item.p, (ch) => (ch === '.' ? 0 : Number(ch)));
    const uniq = countSolutions(Int8Array.from(board), 2);
    const solved = solveOnce(board);
    const solvedStr = Array.from(solved).join('');
    if (uniq !== 1) {
      console.error(`[错误] ${key} 第${item.l}关 解不唯一 (${uniq})`);
      errors++;
    }
    if (solvedStr !== item.s) {
      console.error(`[错误] ${key} 第${item.l}关 答案不匹配`);
      errors++;
    }
    const givens = item.p.split('').filter((c) => c !== '.').length;
    if (givens < 17) {
      console.error(`[错误] ${key} 第${item.l}关 提示数过少 ${givens}`);
      errors++;
    }
  }
}

console.log(report.join('\n'));

// 区间汇总
console.log('\n难度区间汇总：');
for (const cfg of LEVELS) {
  const items = result[cfg.key];
  const gs = [];
  const hs = [];
  items.forEach(function (it) {
    const b = Int8Array.from(it.p, function (ch) { return ch === '.' ? 0 : Number(ch); });
    const g = it.p.split('').filter(function (c) { return c !== '.'; }).length;
    gs.push(g);
    hs.push(evaluate(b, g).hardness);
  });
  let mono = true;
  for (let i = 1; i < hs.length; i++) if (hs[i] < hs[i - 1]) mono = false;
  console.log(
    `  ${cfg.name}\t提示数 ${Math.min.apply(null, gs)}~${Math.max.apply(null, gs)}` +
      `\t需试探格数 ${Math.min.apply(null, hs)}~${Math.max.apply(null, hs)}` +
      `\t单调递增=${mono ? '是' : '否'}\n` +
      `\t\t需试探序列 ${hs.join(',')}\n\t\t提示数序列 ${gs.join(',')}`
  );
}

console.log(`\n共 ${Object.keys(result).length} 个难度 × ${TOTAL_PER_LEVEL} 关`);
console.log(errors === 0 ? '校验通过：全部唯一解、答案一致。' : `校验失败：${errors} 处问题`);

const outPath = path.join(__dirname, 'puzzles.json');
fs.writeFileSync(outPath, JSON.stringify(result));
console.log('已写入 ' + outPath + ' (' + fs.statSync(outPath).size + ' 字节)');
if (errors > 0) process.exit(1);
