'use strict';
// ============================================================
// 实时块渲染：读线上真实 state.json + tone-harlan.json
//              喂真实 vendor/cadence.js 的 getPromptContext/getStyleGuidance
//              → 用 lib/inject-text.js 的真函数渲染出「此刻块」
//
// 目的：直接看「此时此刻基线对应的提示词长什么样」，而不是靠推算。
// ⚠️ 只读，不写任何线上文件。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = '/root/cadence';
const statePath = path.join(ROOT, 'data/state.json');
const tonePath = path.join(ROOT, 'config/tone-harlan.json');

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
// 兼容旧字段：改名前的 state 里叫 pride
if (state.poise === undefined && state.pride !== undefined) state.poise = state.pride;
const toneCfg = JSON.parse(fs.readFileSync(tonePath, 'utf8'));

const { createCadence } = require(path.join(ROOT, 'vendor/cadence.js'));
const { createToneGrid } = require(path.join(ROOT, 'vendor/tone-grid.js'));
const { createDescriber } = require(path.join(ROOT, 'lib/describe.js'));
const { buildInjectionBlock, buildProactiveNotice } = require(path.join(ROOT, 'lib/inject-text.js'));

const toneGrid = createToneGrid({
  profiles: toneCfg.profiles,
  urgencyBoost: toneCfg.urgencyBoost,
});
const describer = createDescriber(toneCfg.describe);

// 用真实 state 造一个引擎实例（onLoad 直接返回线上 state）
const cadence = createCadence({
  getLastMessage: () => null,
  connectionRateFn: () => 0.0025,
  onSave: async () => {},
  onLoad: async () => state,
  getPromptContext: (s) => toneGrid.getPromptContext(s),
  getStyleGuidance: (s) => toneGrid.getStyleGuidance(s),
  rates: {
    valenceSetpoint: -0.05,
    connectionAccel: 1.5,
    accelDelay: 30,
    poiseDefendThreshold: 1.0,
    poiseDefendRate: 0.004,
    activityConnectionRelief: 0,
    valenceConnectionDriftThreshold: 0.0,
    valenceConnectionDriftRate: 0,
  },
  thresholds: { valenceActivity: -1.0 },
  verbose: false,
  onLog: () => {},
});

const fmt = (n) => (typeof n === 'number' ? n.toFixed(3) : String(n));

(async () => {
  const s = await cadence.getState();
  console.log('════ 当前五轴 ════');
  console.log('  connection(想念) = ' + fmt(s.connection));
  console.log('  poise     (从容) = ' + fmt(s.poise));
  console.log('  valence   (心情) = ' + fmt(s.valence));
  console.log('  arousal   (唤醒) = ' + fmt(s.arousal));
  console.log('  immersion (沉浸) = ' + fmt(s.immersion) +
    (s.lastActivity ? '  [' + s.lastActivity.label + ']' : ''));
  console.log('  getStateSummary  = ' + cadence.getStateSummary());
  console.log();

  // 描述层（此刻块：withConnection=false）
  const ctx = describer(s, { withConnection: false });
  console.log('════ 描述层（此刻块用，withConnection=false）════');
  console.log('  ' + (ctx.length ? ctx.join('\n  ') : '（空）'));
  console.log();

  // getStyleGuidance（27 格）
  let style = '';
  try { style = toneGrid.getStyleGuidance(s); } catch (e) { style = '[err] ' + e.message; }
  console.log('════ getStyleGuidance（27 格）（getStyleGuidance）════');
  console.log('  ' + style);
  console.log();

  // 45 格状态描述（主动唤醒侧用）
  let prompt = '';
  try { prompt = toneGrid.getPromptContext(s); } catch (e) { prompt = '[err] ' + e.message; }
  console.log('════ getPromptContext（主动唤醒侧用）════');
  console.log('  ' + prompt);
  console.log();

  // 真实渲染「此刻块」
  const block = buildInjectionBlock(s, toneGrid, describer);
  console.log('════ ⭐ 此刻块（reactive，她开口时注入）════');
  console.log(block.split('\n').map((l) => '  | ' + l).join('\n'));
  console.log();

  // 主动唤醒块（contact / find_activity）
  for (const scene of ['contact', 'find_activity']) {
    const nb = buildProactiveNotice(s, toneGrid, {
      scene,
      reason: scene === 'find_activity' ? 'low_valence' : undefined,
      finding: null,
    }, toneCfg.sceneOverride, toneCfg.proactiveOutlet, describer);
    console.log('════ 主动唤醒块：' + scene + ' ════');
    console.log(nb.split('\n').map((l) => '  | ' + l).join('\n'));
    console.log();
  }
})();
