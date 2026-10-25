# -*- coding: utf-8 -*-
"""用 Lattice 真实剥离函数验证潮汐基频块白名单收窄（2026-10-07）。

用法：
    python chk_whitelist_strip.py <dir_containing_lattice_package>

本地：python chk_whitelist_strip.py ../Lattice-fork/src
线上：python3 chk_whitelist_strip.py /usr/local/lib/python3.13/site-packages
"""
import sys

if len(sys.argv) < 2:
    print('usage: chk_whitelist_strip.py <dir_containing_lattice_package>')
    raise SystemExit(2)

sys.path.insert(0, sys.argv[1])
from lattice.chat_context import ClientContext, EXTERNAL_CONTEXT_BLOCK_TITLES  # noqa: E402

HER = '她说了一句题外话。'
TAIL_BOUNDARY = '【此状态为潜意识的底色沉淀，自然浸润在回应里，不作任何元说明或刻意提及。】'
# 2026-10-23：冲浪专用尾句已从桥与 Lattice 两侧删除（该块从未实际产生），对应用例一并移除。

CASES = [
    ('新块·此刻 + 边界尾句', '\n'.join(['【潮汐基频 · CADENCE】', '心情：中性。', '正文。', TAIL_BOUNDARY, HER]), 'stripped'),
    ('新块·此刻（只到块尾无她的话）', '\n'.join(['【潮汐基频 · CADENCE】', '心情：中性。', '正文。', TAIL_BOUNDARY]), 'empty'),
    ('旧块·找她 + 裸行尾句', '\n'.join(['【潮汐基频·找她】', '心情：中性。', '正文。', '以上是系统通知，供你参考。', HER]), 'kept'),
    ('旧块·独处 + 裸行尾句', '\n'.join(['【潮汐基频·独处】', '正文。', '以上是内在心绪和潜意识的自然流露，切勿对她复述或提及此状态。', HER]), 'kept'),
    ('旧头·此刻｜参考不是指令', '\n'.join(['【潮汐基频·此刻｜参考不是指令】', '正文。', '以上是系统通知。', HER]), 'kept'),
    ('纯她的话（无块）', HER, 'stripped'),
]

ctx = ClientContext()
ok = True

cadence = sorted(t for t in EXTERNAL_CONTEXT_BLOCK_TITLES if t.startswith('潮汐基频'))
print('cadence titles in whitelist :', cadence)
if cadence != ['潮汐基频 · CADENCE']:
    ok = False
    print('  !! expected exactly [\'潮汐基频·此刻\']')

print()
print('%-30s %-9s %s' % ('case', 'verdict', 'result'))
for name, text, want in CASES:
    got = ctx._strip_external_context_from_user_text(text)
    if want == 'stripped':
        good = got.strip() == HER
    elif want == 'empty':
        good = got.strip() == ''
    else:
        good = got == text
    ok = ok and good
    print('%-30s %-9s %s' % (name, 'OK' if good else 'FAIL', repr(got)[:110]))

print()
print('ALL-OK' if ok else 'HAS-FAILURES')
raise SystemExit(0 if ok else 1)
