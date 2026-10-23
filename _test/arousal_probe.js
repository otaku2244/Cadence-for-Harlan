'use strict';
// arousal 上升通道验证：在给定 rate 下，a 从 0 爬到 0.3 需要多久。
// 用法：node arousal_probe.js <rate> [threshold]
const { createJiwen } = require('/root/jiwen-bridge/vendor/jiwen.js');

const RATE = parseFloat(process.argv[2] || '0.007');
const THRESH = parseFloat(process.argv[3] || '0.5');

let fake = {
  connection: 0.50, poise: 0, valence: 0.1, arousal: 0,
  immersion: 0, lastActivity: null, lastTick: null,
  lastChatAnalysis: null, lastChatMessageId: null, lastBotMessageId: null,
  userStatus: 'active',
};

const j = createJiwen({
  getLastMessage: () => null,
  connectionRateFn: () => 0.0025,
  onSave: async () => {},
  onLoad: async () => ({ ...fake }),
  getPromptContext: () => '',
  getStyleGuidance: () => '',
  rates: {
    arousalConnectionRiseThreshold: THRESH,
    arousalConnectionRiseRate: RATE,
    // 关掉其他会干扰的通道
    valenceConnectionDriftRate: 0,
    poiseDefendThreshold: 1.0,
  },
  thresholds: { valenceActivity: -1.0 },
  verbose: false,
  onLog: () => {},
});

(async () => {
  await j.load();
  let mins = 0;
  let hit03 = null, hit06 = null;
  for (let i = 0; i < 96; i++) {          // 96 × 5min = 8h
    await j.tick(5);
    mins += 5;
    const st = await j.getState();
    if (!st) { console.log('no state'); return; }
    if (!hit03 && st.arousal >= 0.3) hit03 = mins;
    if (!hit06 && st.arousal >= 0.6) hit06 = mins;
    if (i % 12 === 0 || (hit03 && mins === hit03)) {
      console.log(`t=${String(mins).padStart(3)}min  c=${st.connection.toFixed(2)}  a=${st.arousal.toFixed(3)}  v=${st.valence.toFixed(2)}`);
    }
  }
  const fin = await j.getState();
  console.log(`\nrate=${RATE} threshold=${THRESH}`);
  console.log(`a 到 0.3: ${hit03 ? hit03 + ' 分钟' : '8h 内未达到'}`);
  console.log(`a 到 0.6: ${hit06 ? hit06 + ' 分钟' : '8h 内未达到'}`);
  console.log(`8h 末: c=${fin.connection.toFixed(2)} a=${fin.arousal.toFixed(3)}`);
})();
