#!/usr/bin/env node
/**
 * 持续聊天中（c < 0.35）真实出现过的组合，用生产配置渲染此刻块。
 * 依据：bridge.log 327 条 c<0.20 采样 + 463 条 c<0.35 采样的实际分布。
 */
const fs = require('fs');
const path = require('path');
const { createToneGrid } = require('../vendor/tone-grid.js');
const { buildInjectionBlock } = require('../lib/inject-text.js');

const tone = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'tone-harlan.json'), 'utf8'));

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

// [簇, 档, v, a, p, 聊天中占比]
const cases = [
  ['neutral', 1,  0.05,  0.00, -0.15, 77.8],
  ['pleased', 1,  0.45,  0.00, -0.15,  9.3],
  ['content', 1,  0.45, -0.40, -0.15,  3.9],
  ['sullen',  1, -0.45,  0.00, -0.15,  3.2],
  ['calm',    1,  0.00, -0.40, -0.15,  0.6],
  ['neutral', 2,  0.05,  0.00,  0.05,  2.8],
  ['neutral', 3,  0.05,  0.00,  0.25,  2.4],
];

for (const [cluster, tier, v, a, p, pct] of cases) {
  const state = { connection: 0.08, poise: p, valence: v, arousal: a, immersion: 0 };
  const block = buildInjectionBlock(state, grid, null);
  console.log(`\n─── ${cluster} × 档${tier}  (聊天中 ${pct}%)  v=${v} a=${a} p=${p} ───`);
  console.log(block);
}
