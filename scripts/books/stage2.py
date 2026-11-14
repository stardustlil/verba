"""第二步：为每个保留的短语挑例句、写释义、校对翻译。"""
import json, sys, concurrent.futures as cf
from llm import chat

SYSTEM = """你是英语教学专家，正在为中国的中级英语学习者（四六级到考研、雅思水平）编写短语书。每个短语要配一个例句，用于“语境填空”练习：学习者看着例句和中文释义，在空白处写出短语。

第一步，判断短语是否值得收录（keep）。值得收录的是母语者当作整体使用、意思不等于字面相加或搭配固定的表达：短语动词（give up）、动词固定搭配（take advantage of, make sense）、介词短语与固定表达（in charge of, at least, as if）、习语、写作衔接表达（as a result, in terms of）。
以下一律 keep=false：
- 字面意思的自由组合，即使词典里有：on the table（在桌子上）、live with someone、go home、very good、at the station
- 语法结构、功能词组合：have to、used to、a lot of、one of、there is
- 复合名词、专有名词、术语
- 过于生僻、过时、粗俗的说法

第二步，从候选例句（来自开放的双语例句库，附人工翻译）中挑一个最合适的：
- 例句里这个短语用的是最常用、最值得学的意思
- 句子自然、完整、有实际内容，最好 6～20 个词；不要过于简单的（如 "I gave up."），不要生僻、粗俗、涉及政治宗教或令人不适的内容
- 例句库里大量句子以 Tom、Mary 为主角，有其他同样好的句子时优先选不含这两个名字的

然后给出：
- lemma：短语的规范原形，全部小写，只写一种形式（不要用 / 或括号列出多种）。指人的宾语写 someone，指物写 something，物主写 one's，反身写 oneself。宾语只在它夹在短语中间时才写进原形（take something off、make up one's mind）；短语末尾的宾语不写（agree with，不写 agree with someone）
- meaning：短语在这个例句中的中文释义，简洁准确，一般 2～8 个字，最多两个近义说法用“，”隔开（如“放弃”“照顾，照料”）。不写词性，不加解释，不用省略号以外的符号
- surface：短语在例句中的原文形式，必须是例句中一字不差的连续片段，从短语第一个词到最后一个词。夹在中间的宾语要包含（例句 "I took my shoes off." 写 "took my shoes off"），短语后面的宾语不要包含（例句 "I agree with you." 写 "agree with"）。原形以 be 开头时，surface 也要从 be 的变化形式开始（例句 "I am proud of you." 写 "am proud of"）；中间夹了别的词导致不连续的，换一个例句
- translation：例句的中文翻译，用简体字。候选的人工翻译准确通顺就原样使用（繁体转成简体）；有错误、生硬或漏译就改好

如果所有候选例句都不合适，可以自己写一个例句（written 设为 true），要求地道、自然、有内容，8～20 个词。

返回 JSON：{"items":[{"id":编号,"keep":true,"lemma":"...","meaning":"...","example":候选编号或 null,"sentence":"自己写的例句，只在 written 为 true 时填","written":false,"surface":"...","translation":"..."}]}，每个短语返回一项；keep 为 false 时其余字段可省略。"""

def good_len(s):
    n = len(s.split())
    return 5 <= n <= 24

def candidates(x):
    zh = [e for e in x['examples'] if good_len(e['en'])]
    zh.sort(key=lambda e: abs(len(e['en'].split()) - 12))
    out = []
    seen = set()
    for e in zh:
        if e['en'] in seen: continue
        seen.add(e['en'])
        out.append({'en': e['en'], 'zh': e['zh'][0]})
        if len(out) >= 8: break
    if len(out) < 3:
        for e in x['plain']:
            if good_len(e['en']) and e['en'] not in seen:
                seen.add(e['en']); out.append({'en': e['en'], 'zh': ''})
                if len(out) >= 6: break
    return out

def run(batch):
    blocks = []
    for i, x in batch:
        lines = [f"### {i}. {x['lemma']}（词典释义：{x['zh_short']}）"]
        for k, c in enumerate(x['cands']):
            lines.append(f"[{k}] {c['en']}" + (f"\n    {c['zh']}" if c['zh'] else "\n    （无翻译）"))
        if not x['cands']: lines.append('（没有候选例句）')
        blocks.append('\n'.join(lines))
    res, usage = chat(SYSTEM, '\n\n'.join(blocks), model='deepseek-flash', effort='high')
    return res['items'], usage

if __name__ == '__main__':
    todo = json.load(open('stage2_in.json'))
    try: out = json.load(open('stage2.json'))
    except FileNotFoundError: out = {}
    keys = sorted((k for k in todo if k not in out), key=lambda k: -todo[k]['freq'])
    items = []
    for n, k in enumerate(keys):
        x = todo[k]; x['cands'] = candidates(x); items.append((n, x))
    batches = [items[k:k+10] for k in range(0, len(items), 10)]
    print('batches', len(batches), file=sys.stderr)
    with cf.ThreadPoolExecutor(int(sys.argv[1]) if len(sys.argv) > 1 else 24) as ex:
        futs = {ex.submit(run, b): b for b in batches}
        for fut in cf.as_completed(futs):
            b = futs[fut]
            try: res, usage = fut.result()
            except Exception as e:
                print('fail', b[0][0], e, file=sys.stderr); continue
            byid = dict(b)
            for it in res:
                x = byid.get(int(it['id']))
                if x is None: continue
                it['cands'] = x['cands']
                out[x['lemma']] = it
            json.dump(out, open('stage2.json', 'w'), ensure_ascii=False)
            print('ok', b[0][0], usage and usage.get('total_tokens'), file=sys.stderr)
