#!/usr/bin/env node
/**
 * 枚举真实出现过的 簇×档 组合，用生产配置渲染完整此刻块。
 * 数据依据：bridge.log 2693~3280 条 TICK 采样的实际分布。
 */
const fs = require('fs');
const path = require('path');
const { createToneGrid } = require('../vendor/tone-grid.js');
const { buildInjectionBlock } = require('../lib/inject-text.js');

const cfgPath = path.join(__dirname, '..', 'config', 'tone-harlan.json');
const tone = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

// 与 bridge.js 一致的归一化（缺省档补齐）
function normalizeTiers(profiles) {
  const out = {};
  for (const cluster of Object.keys(profiles || {})) {
    const tiers = { ...profiles[cluster] };
    for (let i = 1; i <= 5; i++) {
      if (!tiers[i]) tiers[i] = (profiles[cluster]['3'] || profiles[cluster]['1'] || [''])[0];
    }
    out[cluster] = tiers;
  }
  return out;
}

const grid = createToneGrid({ profiles: normalizeTiers(tone.profiles) });

const cases = [
  ['neutral', 1, -0.05, 0.00, -0.15, 32.8],
  ['neutral', 2, -0.05, 0.00, 0.05, 13.1],
  ['neutral', 3, -0.05, 0.00, 0.25, 46.9],
  ['sullen',  1, -0.50, 0.00, -0.15,  1.9],
  ['sullen',  2, -0.50, 0.00, 0.05,  1.2],
  ['sullen',  3, -0.50, 0.00, 0.25,  3.6],
  ['restless',2, -0.05, 0.40, 0.05,  0.3],
  ['restless',3, -0.05, 0.40, 0.25,  0.1],
  ['content', 1,  0.40, -0.40, -0.15, 0.1],
];

for (const [cluster, tier, v, a, p, pct] of cases) {
  const state = { connection: 0.10, poise: p, valence: v, arousal: a, immersion: 0 };
  const block = buildInjectionBlock(state, grid, null);
  console.log('\n────────────────────────────────────────');
  console.log(`【${cluster} × 档${tier}】 真实占比 ${pct}%   (v=${v} a=${a} p=${p})`);
  console.log('────────────────────────────────────────');
  console.log(block);
}
