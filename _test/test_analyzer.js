'use strict';
// ============================================================
// 判定器实测：用真实 lib/analyzer.js + 真实 config/analyze-prompt-user.txt
//            喂几组典型的「椰椰子的话」，看 agnes-3.0-flash 给什么 delta。
//
// 负载 .env 的实际 LLM_* 配置（由 bridge 启动时已加载，这里手动读）。
// ⚠️ 会真实调用 LLM（花 token），但只读不写线上文件。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = '/root/cadence-bridge';
const envTxt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const get = (k, d) => {
  const m = envTxt.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : d;
};

// ⚠️ 关键：analyzer.js 的 maxTokens / disableThinking 是从 process.env 读的，
// 直接跑本脚本时没有 dotenv 加载 .env → 会回落到默认 max_tokens=300，
// 导致 agnes 思考链吃满配额、返回 non-JSON。这里手动把 .env 灌进 process.env。
for (const line of envTxt.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const CFG = {
  llmBase: get('LLM_BASE'),
  llmKey: get('LLM_KEY'),
  llmModel: get('LLM_MODEL'),
  llmMaxTokens: parseInt(get('LLM_MAX_TOKENS', '300'), 10),
  log: (lv, msg) => console.log('  [' + lv + '] ' + msg),
};

console.log('  env: LLM_MAX_TOKENS=' + process.env.LLM_MAX_TOKENS +
            ' LLM_DISABLE_THINKING=' + process.env.LLM_DISABLE_THINKING);

console.log('=== 生效配置 ===');
console.log('  base  = ' + CFG.llmBase);
console.log('  model = ' + CFG.llmModel);
console.log('  key   = ' + CFG.llmKey.slice(0, 14) + '...');
console.log();

const { analyzeDialog } = require(path.join(ROOT, 'lib/analyzer.js'));

// 场景：dialog 时间正序，最多 4 条。role: user=椰椰子, assistant=Harlan
const CASES = [
  {
    name: 'A 日常闲聊（她随口说句）',
    dialog: [
      { role: 'assistant', text: '嗯，在看点东西。' },
      { role: 'user', text: '今天天气挺好的' },
    ],
  },
  {
    name: 'B 敷衍短回（「哦」）',
    dialog: [
      { role: 'assistant', text: '那你想怎么弄。' },
      { role: 'user', text: '哦' },
    ],
  },
  {
    name: 'C 示弱/疲惫（规则1）',
    dialog: [
      { role: 'assistant', text: '怎么了。' },
      { role: 'user', text: '今天开会开到八点，累死了，什么都不想干' },
    ],
  },
  {
    name: 'D 专属称呼「爹咪」（规则③）',
    dialog: [
      { role: 'assistant', text: '说吧。' },
      { role: 'user', text: '爹咪，我不管了，你帮我想' },
    ],
  },
  {
    name: 'E 连续闲聊第二轮（低频回落测试）',
    dialog: [
      { role: 'user', text: '在干嘛呢' },
      { role: 'assistant', text: '刚看完一篇文章。' },
      { role: 'user', text: '什么文章呀' },
    ],
  },
];

(async () => {
  for (const c of CASES) {
    process.stdout.write('── ' + c.name + '\n');
    try {
      const delta = await analyzeDialog(c.dialog, CFG);
      console.log('   → ' + JSON.stringify(delta));
      if (delta && delta.connection === 0) console.log('   ⚠️ connection = 0（不降 c）');
    } catch (e) {
      console.log('   ❌ 失败: ' + e.message);
    }
    console.log();
  }
})();
