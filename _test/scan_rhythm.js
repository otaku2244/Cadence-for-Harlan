'use strict';
// ════════════════════════════════════════════════════
// 节奏扫描（v2）：找「唤醒间隔短 + 冲浪优先 + 不撞车」的参数组合
//
// 三条约束：
//   ① 首动作时间 ≈ considerContact / (rate × ~1.3)
//   ② 升温窗口（仅嘴硬通道）：(0.35 - pT) / rate >= 0.5 / pR
//   ③ 沉降路净下沉：valenceConnectionDriftRate × connection > valenceRegress(0.005)
//      → driftRate 太小则 valence 沉不到 valenceActivity，find 永不触发
//   ④ 冷却窗口：(0.50-0.35) / rate >= ACTION_COOLDOWN_MINUTES（防冲浪被 forceContact 锁死）
//
// 跑法：node _test/scan_rhythm.js
// ════════════════════════════════════════════════════

const { createCadence } = require('../vendor/cadence.js');

let VNOW = new Date('2026-10-05T00:00:00+08:00').getTime();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(VNOW); else super(...a); }
  static now() { return VNOW; }
}
Date = FakeDate;

const DAYS = 30;
const TICK = 5;
const DAY_MIN = 24 * 60;
const BASE_RATES = { valenceSetpoint: -0.05, connectionAccel: 1.5, accelDelay: 30 };
const DRIFT = (th, rt) => ({ valenceConnectionDriftThreshold: th, valenceConnectionDriftRate: rt });

const PATTERNS = [
  { name: '她整日不出现', fn: () => false },
  { name: '她来2次/日', fn: (m) => (m >= 480 && m < 490) || (m >= 1200 && m < 1210) },
];

const CASES = [
  {
    name: '① 现状 87a8542（恒成立）',
    rates: { poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0.10 },
    thresholds: { valenceActivity: -0.04 }, rate: 0.0025, cooldown: 60,
  },
  {
    name: '② 回滚基线 r.0007 cd180 pT.20',
    rates: { poiseDefendThreshold: 0.20, poiseDefendRate: 0.004, activityConnectionRelief: 0 },
    thresholds: { valenceActivity: -1.0 }, rate: 0.0007, cooldown: 180,
  },
  {
    name: '③ 嘴硬提速 r.002 cd60 pT.08',
    rates: { poiseDefendThreshold: 0.08, poiseDefendRate: 0.008, activityConnectionRelief: 0 },
    thresholds: { valenceActivity: -1.0 }, rate: 0.002, cooldown: 60,
  },
  {
    name: '④ 沉降 .20/.020 va-.25（弱）',
    rates: Object.assign({ poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0 }, DRIFT(0.20, 0.020)),
    thresholds: { valenceActivity: -0.25 }, rate: 0.0025, cooldown: 180,
  },
  {
    name: '⑤ 沉降 .20/.050 va-.25',
    rates: Object.assign({ poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0 }, DRIFT(0.20, 0.050)),
    thresholds: { valenceActivity: -0.25 }, rate: 0.0025, cooldown: 180,
  },
  {
    name: '⑥ 沉降 .15/.050 va-.25',
    rates: Object.assign({ poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0 }, DRIFT(0.15, 0.050)),
    thresholds: { valenceActivity: -0.25 }, rate: 0.0025, cooldown: 180,
  },
  {
    name: '⑦ 沉降 .20/.080 va-.25',
    rates: Object.assign({ poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0 }, DRIFT(0.20, 0.080)),
    thresholds: { valenceActivity: -0.25 }, rate: 0.0025, cooldown: 180,
  },
  {
    name: '⑧ 沉降 .20/.050 va-.25 r.0015',
    rates: Object.assign({ poiseDefendThreshold: 1.0, poiseDefendRate: 0.004, activityConnectionRelief: 0 }, DRIFT(0.20, 0.050)),
    thresholds: { valenceActivity: -0.25 }, rate: 0.0015, cooldown: 180,
  },
];

async function runOne(cfg, patternFn) {
  const t0 = VNOW;
  let store = null;
  const j = createCadence({
    getLastMessage: () => ({ id: 1, content: 'x', timestamp: new RealDate(VNOW - 86400000).toISOString() }),
    connectionRateFn: () => cfg.rate,
    onSave: async (s) => { store = s; },
    onLoad: async () => store || {
      connection: 0, poise: 0, valence: 0, arousal: 0, immersion: 0,
      lastActivity: null, lastTick: null, lastChatAnalysis: null,
      lastChatMessageId: null, lastBotMessageId: null, userStatus: 'active',
    },
    rates: Object.assign({}, BASE_RATES, cfg.rates || {}),
    thresholds: cfg.thresholds || {},
    onLog: () => {},
  });
  await j.load();

  let lastC = null, lastF = null, lastMsgAt = VNOW;
  let totalC = 0, totalF = 0, clash = 0, poiseHigh = 0, ticks = 0;
  let firstAt = null, firstKind = null;

  for (let d = 0; d < DAYS; d++) {
    for (let m = 0; m < DAY_MIN; m += TICK) {
      VNOW += TICK * 60 * 1000;
      if (patternFn(m)) { await j.applyDelta({ connection: -0.35 }); lastMsgAt = VNOW; continue; }

      const trig = await j.tick(TICK);
      ticks++;
      if (store && store.poise >= 0.5) poiseHigh++;

      const cOk = trig.some((t) => t.action === 'contact') &&
        (lastC === null || (VNOW - lastC) >= cfg.cooldown * 60000);
      const fOk = trig.some((t) => t.action === 'find_activity') &&
        (lastF === null || (VNOW - lastF) >= cfg.cooldown * 60000);

      if (cOk && fOk) clash++;
      if (cOk) {
        if (firstAt === null) { firstAt = (VNOW - t0) / 60000; firstKind = 'C'; }
        totalC++; lastC = VNOW;
        await j.applyDelta({ connection: -0.35 });
      }
      if (fOk) {
        if (firstAt === null) { firstAt = (VNOW - t0) / 60000; firstKind = 'F'; }
        totalF++; lastF = VNOW;
      }
    }
  }
  return { firstAt, firstKind, c: totalC / DAYS, f: totalF / DAYS, clash: clash / DAYS, ph: poiseHigh / ticks };
}

(async () => {
  console.log(`模拟 ${DAYS} 天 | tick=${TICK}min | accel=1.5 delay=30 | F=冲浪 C=找你\n`);
  for (const p of PATTERNS) {
    console.log(`【场景：${p.name}】`);
    console.log('  配置'.padEnd(34) + '首动作'.padEnd(13) + 'C/日'.padStart(8) +
      'F/日'.padStart(8) + '撞车/日'.padStart(10) + 'poise>=0.5'.padStart(12));
    for (const c of CASES) {
      const r = await runOne(c, p.fn);
      const fa = r.firstAt === null ? '从不' : `${Math.round(r.firstAt)}min/${r.firstKind}`;
      console.log('  ' + c.name.padEnd(32) + fa.padEnd(13) +
        r.c.toFixed(2).padStart(8) + r.f.toFixed(2).padStart(8) +
        r.clash.toFixed(2).padStart(10) + (r.ph * 100).toFixed(0).padStart(11) + '%');
    }
    console.log('');
  }
  console.log('⚠️ 本脚本未模拟 surf 跑完后的 setActivity（immersion→0.35），而低情绪通道要求 immersion<0.3');
  console.log('   → 真实线上「冲浪后短时间内不能再冲浪」，find/日 会比这里更低。');
})().catch((e) => { console.error(e); process.exit(1); });
