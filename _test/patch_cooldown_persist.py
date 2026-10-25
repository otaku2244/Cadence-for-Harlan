# -*- coding: utf-8 -*-
"""bridge.js 冷却持久化补丁（幂等，纯追加/替换既有行）。

三处改动：
  1. NEUTRAL_SEED 加 cooldown: {}          —— 首次启动有字段
  2. saveState() 强制刷新 cooldown 字段     —— 单点真相，避免被 vendor state 覆盖
  3. createSceneCooldown 接 onChange + 启动 restore
"""
import io, sys

P = "/root/cadence-bridge/bridge.js"

# ── 改动 1：NEUTRAL_SEED 加 cooldown ──────────────────
A1 = """  lastBotMessageId: null,
  userStatus: 'active',
};"""
B1 = """  lastBotMessageId: null,
  userStatus: 'active',
  // 场景冷却表快照（2026-10-10 起持久化）：
  //   { contact: <epoch_ms>, find_activity: <epoch_ms> }
  // 由 createSceneCooldown 的 onChange 维护，saveState 时刷新。
  cooldown: {},
};"""

# ── 改动 2：saveState 强制刷新 cooldown ───────────────
A2 = """function saveState(s) {
  _stateCache = s;
  _stateDirty = true;
}"""
B2 = """function saveState(s) {
  // ⚠️ 冷却表是桥的私有字段，vendor 传进来的 s 里没有。
  //    每次落盘都从冷却模块现取快照，避免被 vendor 的 state 整体覆盖。
  try {
    if (typeof _cooldownSnapshot === 'function') s.cooldown = _cooldownSnapshot();
  } catch (_) {}
  _stateCache = s;
  _stateDirty = true;
}
// 由 createSceneCooldown 装配时注入（见下）。
let _cooldownSnapshot = null;"""

# ── 改动 3：createSceneCooldown 接 onChange ───────────
A3 = """const actionCooldown = createSceneCooldown({ minutes: CFG.actionCooldownMinutes });"""
B3 = """const actionCooldown = createSceneCooldown({
  minutes: CFG.actionCooldownMinutes,
  // 冷却变更 → 标脏落盘（搭 state.json 的车，不自己写文件）。
  onChange: () => {
    if (_stateCache) {
      try { _stateCache.cooldown = actionCooldown.snapshot(); } catch (_) {}
      _stateDirty = true;
      scheduleFlush();
    }
  },
});
// 暴露给 saveState：始终取冷却模块的最新快照。
_cooldownSnapshot = () => actionCooldown.snapshot();"""

# ── 改动 4：启动时 restore（放在 cadence 实例创建之后）──
A4 = """// ── 潮汐基频实例（全局唯一）──────────────────────────"""
B4 = """// ── 冷却表恢复（2026-10-10）──────────────────────
// 必须在首次 tick / 首次主动唤醒判断之前执行，否则重启后的第一轮
// 会当成"从未触发过"直接放行。loadState() 读的就是 state.json。
try {
  const persisted = loadState();
  if (persisted && persisted.cooldown) {
    actionCooldown.restore(persisted.cooldown);
    const snap = actionCooldown.snapshot();
    const scenes = Object.keys(snap);
    if (scenes.length) {
      log('INFO', 'cooldown restored: ' + scenes.map(
        (s) => s + '=' + Math.round(actionCooldown.remainingMinutes(s)) + 'min left'
      ).join(', '));
    }
  }
} catch (e) {
  log('WARN', 'cooldown restore failed: ' + e.message);
}

// ── 潮汐基频实例（全局唯一）──────────────────────────"""


def patch(text, anchor, block, tag):
    if block.split("\n")[0] in text and tag == "skip":
        pass
    if anchor not in text:
        print("ERROR: anchor not found -> " + tag)
        print("  anchor head: " + anchor.split("\n")[0][:60])
        sys.exit(1)
    return text.replace(anchor, block, 1), True


def main():
    with io.open(P, "r", encoding="utf-8") as f:
        text = f.read()

    # 幂等检查
    if "_cooldownSnapshot" in text:
        print("SKIP: already patched (found _cooldownSnapshot)")
        return

    for anchor, block, tag in [
        (A1, B1, "NEUTRAL_SEED.cooldown"),
        (A2, B2, "saveState refresh"),
        (A3, B3, "createSceneCooldown onChange"),
        (A4, B4, "startup restore"),
    ]:
        if anchor not in text:
            print("ERROR: anchor not found -> " + tag)
            sys.exit(1)
        text = text.replace(anchor, block, 1)
        print("OK: " + tag)

    with io.open(P, "w", encoding="utf-8") as f:
        f.write(text)
    print("WRITTEN")


main()
