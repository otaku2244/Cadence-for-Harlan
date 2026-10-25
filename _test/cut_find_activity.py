# -*- coding: utf-8 -*-
"""
阉割 find_activity —— 范围：只动潮汐基频侧（vendor + bridge 潮汐基频消费分支 + 我们加的养 find_activity 的配置）
    冲浪本体（spawnSurf / /surf/finding / CFG.surf* / .env SURF_*）一律保留不动。

幂等：以 MARK 注释为标记。
用法：python3 cut_find_activity.py /root/cadence-bridge
"""
import sys, os, io

ROOT = sys.argv[1] if len(sys.argv) > 1 else '/root/cadence-bridge'
MARK = '[CUT-FIND-ACTIVITY 2026-10-10]'

def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()

def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)

def rep_once(text, old, new, tag):
    n = text.count(old)
    if n == 0:
        raise SystemExit('[FAIL] %s: pattern not found' % tag)
    if n > 1:
        raise SystemExit('[FAIL] %s: pattern matched %d times (ambiguous)' % (tag, n))
    return text.replace(old, new, 1)

# ══════════════════════════════════════════════════════════════
# 1) vendor/cadence.js
# ══════════════════════════════════════════════════════════════
vpath = os.path.join(ROOT, 'vendor', 'cadence.js')
v = read(vpath)
changed = False

if '// ' + MARK in v or '// ' + MARK in v:
    print('[SKIP] vendor/cadence.js 已阉割过（检测到 MARK）')
else:
    # ---- 1a. 路线 A：pride_block → 直接 contact ----
    old_a = """    if (c >= thresholds.considerContact && c < thresholds.forceContact) {
      if (p >= thresholds.prideBlock) {
        if (i < 0.2) {
          triggers.push({
            action: 'find_activity',
            reason: 'pride_block',
            urgency: c - 0.30,
          });
          trace.push({
            gate: '开口', fired: false, divertedTo: 'find_activity',
            reason: 'pride 挡住开口，转身去找事做',
            detail: { pride: r3(p), 嘴硬线: thresholds.prideBlock, immersion: r3(i) },
          });
        } else {
          trace.push({
            gate: '开口', fired: false,
            reason: 'pride 挡住开口，immersion 又缓冲住了（没转成找事做）',
            detail: { pride: r3(p), 嘴硬线: thresholds.prideBlock, immersion: r3(i), immersion上限: 0.2 },
          });
        }
      } else {
        triggers.push({
          action: 'contact',
          urgency: c - 0.30,
        });
        trace.push({
          gate: '开口', fired: true, action: 'contact',
          reason: '过了 pride 闸门',
          detail: { pride: r3(p), 嘴硬线: thresholds.prideBlock },
        });
      }
    }"""

    new_a = """    // ══════════════════════════════════════════════════════════════════
    // %s
    // find_activity 已整条阉割（原「pride_block」通道）。
    // 原逻辑：c 进考虑区且 pride ≥ prideBlock → 推 find_activity（找事做，不开口）。
    // 阉割理由：pride 涨到 prideBlock(0.5) 需 ~8h，而 c 走完 [0.35,0.50) 窗口仅
    //           36min、随即进强制 contact —— 该分支在真实时序上永远不可达，
    //           属作者设计固有缺陷（非参数可调）。
    // 现语义：pride 不再拦截开口，进考虑区即开口（等同原 else 分支）。
    // ══════════════════════════════════════════════════════════════════
    if (c >= thresholds.considerContact && c < thresholds.forceContact) {
      triggers.push({
        action: 'contact',
        urgency: c - 0.30,
      });
      trace.push({
        gate: '开口', fired: true, action: 'contact',
        reason: '进了考虑区（pride 拦截已移除）',
        detail: { pride: r3(p), 嘴硬线: thresholds.prideBlock },
      });
    }""" % MARK

    v = rep_once(v, old_a, new_a, 'vendor.routeA')

    # ---- 1b. 路线 B：整段删除 ----
    old_b = """    // 低情绪自我调节：心情差或太躁时主动找事做（与 pride_block 并列）
    if (v <= thresholds.valenceActivity || a >= thresholds.arousalAgitation) {
      const alreadyFinding = triggers.some(t => t.action === 'find_activity');
      const lowValence = v <= thresholds.valenceActivity;
      if (!alreadyFinding && i < 0.3) {
        const reason = lowValence ? 'low_valence' : 'high_arousal';
        triggers.push({
          action: 'find_activity',
          reason,
          urgency: Math.min(1, Math.abs(lowValence ? v : a) / 1),
        });
        trace.push({
          gate: '自我调节', fired: true, action: 'find_activity',
          reason: lowValence ? 'valence 过低' : 'arousal 过高',
          detail: { valence: r3(v), arousal: r3(a) },
        });
      } else if (!alreadyFinding) {
        trace.push({
          gate: '自我调节', fired: false,
          reason: 'immersion 太高，没转去找事做',
          detail: { immersion: r3(i), immersion上限: 0.3 },
        });
      }
    }

"""

    new_b = """    // %s
    // 原「低情绪自我调节」通道（valence ≤ valenceActivity || arousal ≥ arousalAgitation
    //   → find_activity）已整段删除。
    // 死因：valenceActivity 默认 -1.0（永不成立），arousal 实测上限 0.035（远低于
    //       arousalAgitation 0.7）—— 双判据均不可达。
    // 行为选择（找她 / 找事做）不再由五维情绪驱动，已移交工作流层。

""" % MARK

    v = rep_once(v, old_b, new_b, 'vendor.routeB')

    # ---- 1c. prideArousalConflictRate 引用块 ----
    old_c = """    // Pride × Connection 冲突升温：想要又端着 → 内心战争额外加热 arousal
    if (rates.prideArousalConflictRate > 0 &&
        state.connection >= thresholds.considerContact &&
        state.pride >= thresholds.prideBlock) {
      arousalRiseForce += rates.prideArousalConflictRate * mins;
    }

"""
    new_c = """    // %s
    // prideArousalConflictRate 升温块已删除：它只服务于 find_activity 的
    // pride_block 通道；通道移除后该值恒为 0，保留引用会误导。

""" % MARK
    v = rep_once(v, old_c, new_c, 'vendor.conflictRate')

    # ---- 1d. 阈值字段注释标注废弃 ----
    old_d = """    prideBlock:      0.50,
    valenceActivity:   -1.0,   // valence 低于此值时触发自我调节（-1.0=永不）
    arousalAgitation:   0.7,   // arousal 高于此值时也触发自我调节（躁动难坐）"""
    new_d = """    prideBlock:      0.50,   // %s 已废弃（find_activity 已阉割）
    valenceActivity:   -1.0,   // %s 已废弃（原自我调节通道已删除）
    arousalAgitation:   0.7,   // %s 已废弃（原自我调节通道已删除）""" % (MARK, MARK, MARK)
    v = rep_once(v, old_d, new_d, 'vendor.thresholds')

    # ---- 1e. rates 字段注释标注废弃 ----
    old_e = """    // Pride × Connection 冲突：想要又端着 → 内心战争加热 arousal
    prideArousalConflictRate: 0,    // connection≥considerContact 且 pride≥prideBlock 时额外 arousal 升温"""
    new_e = """    // %s prideArousalConflictRate 已废弃（原服务于 find_activity 的 pride_block 通道）""" % MARK
    v = rep_once(v, old_e, new_e, 'vendor.ratesField')

    write(vpath, v)
    changed = True
    print('[OK] vendor/cadence.js 已阉割')

# ══════════════════════════════════════════════════════════════
# 2) bridge.js —— 删 find_activity 消费分支（保留 spawnSurf 定义与 /surf/finding）
# ══════════════════════════════════════════════════════════════
bpath = os.path.join(ROOT, 'bridge.js')
b = read(bpath)

if MARK in b:
    print('[SKIP] bridge.js 已阉割过')
else:
    old_2a = """      } else if (t.action === 'find_activity') {
        // ⚠️ 冷却必须在这里判，且必须在 spawn 之前 ——
        //   find_activity 的触发源是"惦记 + 嘴硬"这个持续状态，
        //   状态不消失时每 tick 都会再判一次；不拦就是 50~110 条/天。
        if (!actionCooldown.ok('find_activity')) { logCooldownSkip('find_activity'); continue; }
        // 关于"桥碰不碰活动"：桥**不**决定他做什么，也不发英文活动枚举 ——
        // 具体做什么由 Operit 侧工作流与模型自理。
        // 唯一的例外是冲浪跑完之后的那一条 `setActivity` —— 那不是"安排活动"，
        // 而是把已经发生的事**如实登记**给引擎，供描述层段4 使用
        // （见 lib/activity.js；登记点挂在子进程的 'spawn' 事件上）。
        //
        // 场景统一为 find_activity，reason（pride_block / low_valence / high_arousal）
        // 只作排查线索，不再分叉成独立 scene。
        // 理由：引擎侧这三个 reason 的 action 都是 'find_activity'，
        // 语义上都是"回头去找点事做"，投递目标（独处窗口）本就该一致。
        //
        // ── 有 surf 能力时改走"伸触手"路径 ──
        // 闸门必须在 spawn **之前**：先跑再判等于白烧一次模型钱。
        // 跑完的结果由 surf 回投 /surf/finding，那条路径再拼块 + fireProactive。
        if (CFG.surfEnabled) {
          if (inQuietHours()) {
            log('INFO', `surf blocked by quiet hours (local_hour=${clock.localHour()}, quiet=${CFG.quietStart}-${CFG.quietEnd})`);
            continue;
          }
          if (!checkDailyLimit()) {
            log('INFO', 'surf blocked by daily limit');
            continue;
          }
          spawnSurf(t.reason);
          // spawn 即记账：surf 若超时/崩溃不会有 /surf/finding 回来，
          // 不在这里记就会每个 tick 反复 spawn、反复烧模型钱。
          actionCooldown.mark('find_activity');
          continue;
        }
        const notice = buildProactiveNotice(st, toneGrid, { scene: 'find_activity', reason: t.reason }, SCENE_OVERRIDE, PROACTIVE_OUTLET, describer);
        const sent = await fireProactive(notice, st, { scene: 'find_activity', reason: t.reason });
        if (sent) actionCooldown.mark('find_activity');
      }"""

    new_2a = """      } // %s
        // 原 else if (t.action === 'find_activity') 消费分支已整段删除。
        // 该分支曾负责：冷却判定 → (surfEnabled ? spawnSurf() : fireProactive())。
        // 引擎侧 find_activity 已阉割，此分支永不进入。
        // 保留的挂载点（供未来独立调度接入）：
        //   · spawnSurf()          —— 见下方「自由冲浪：spawn surf 进程一次」
        //   · POST /surf/finding   —— 见上方「自由冲浪产物回投」
        // 当前二者无调用方 / 无触发源，属待启用接口，非死代码 bug。""" % MARK

    b = rep_once(b, old_2a, new_2a, 'bridge.findConsumer')

    # surf 挂载点加标记注释
    old_s = """// ── 自由冲浪：spawn surf 进程一次 ────────────────────────"""
    new_s = """// ══ %s ══
// ⚠️ 本函数当前**无调用方**：唯一入口（tick 里的 find_activity 消费分支）已随
//    find_activity 阉割一并移除。此处保留作为「主动冲浪」的挂载点，待独立调度接入。
//    下方 CFG.surf* 与 /surf/finding 同理保留。SURF_ENABLED 目前无实际作用。
// ══════════════════════════════════════════════════════════
// ── 自由冲浪：spawn surf 进程一次 ────────────────────────""" % MARK
    b = rep_once(b, old_s, new_s, 'bridge.spawnSurfMark')

    write(bpath, b)
    print('[OK] bridge.js 消费分支已删 + surf 挂载点已标记')

print('done. changed=%s' % changed)
