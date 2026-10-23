'use strict';
// 给 bridge.js 补「沉降路」两处接线（vendor 原生参数，桥此前没接）
// 跑法：node _test/patch_bridge_drift.js
const fs = require('fs');

const P = '/root/jiwen-bridge/bridge.js';
const src = fs.readFileSync(P, 'utf8');

const CFG_ANCHOR = "  activityConnectionRelief: parseFloat(process.env.ACTIVITY_CONNECTION_RELIEF || '0'),";
const CFG_ADD = [
  '',
  '  // ── 沉降路：想念久了心情自然下沉（vendor 原生，默认关）2026-10-09 ──',
  '  // vendor/jiwen.js:339 —— drift = rate × mins × connection，与 connection 成正比。',
  '  // 配 valenceActivity 远低于 valenceSetpoint 使用：不依赖 poise 高位，与 contact 天然错开。',
  "  valenceConnectionDriftThreshold: parseFloat(process.env.VALENCE_CONNECTION_DRIFT_THRESHOLD || '0.0'),",
  "  valenceConnectionDriftRate: parseFloat(process.env.VALENCE_CONNECTION_DRIFT_RATE || '0'),",
].join('\n');

const RATES_ANCHOR = '    activityConnectionRelief: CFG.activityConnectionRelief,';
const RATES_ADD = [
  '',
  '    // 沉降路：connection 越高，valence 掉得越快',
  '    valenceConnectionDriftThreshold: CFG.valenceConnectionDriftThreshold,',
  '    valenceConnectionDriftRate: CFG.valenceConnectionDriftRate,',
].join('\n');

function spliceOnce(hay, needle, add, label) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) throw new Error(label + ': anchor count = ' + n + ', expected 1');
  return hay.replace(needle, needle + add);
}

let out = spliceOnce(src, CFG_ANCHOR, CFG_ADD, 'CFG');
out = spliceOnce(out, RATES_ANCHOR, RATES_ADD, 'rates');

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const bak = '/root/backup/bridge.js.bak-drift-' + ts;
fs.writeFileSync(bak, src);
fs.writeFileSync(P, out);

console.log('OK  backup -> ' + bak);
console.log('delta bytes = ' + (out.length - src.length));
