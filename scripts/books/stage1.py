import json, sys, concurrent.futures as cf
from llm import chat
SYSTEM = """你是英语教学专家，正在为中国的中级英语学习者（大学四六级到考研、雅思水平）编写“短语书”。
用户会给你一批候选英文短语（来自词典，附带词典的中文释义和语料频次）。逐个判断它是否值得收进短语书，并分类。

值得收录的：短语动词（give up, figure out）、动词固定搭配（take advantage of, make sense, pay attention to）、介词短语与固定表达（in charge of, at least, as well as, by the way, on purpose）、习惯用语（no wonder, make up one's mind）、写作中常用的搭配与衔接表达（play a role in, in terms of, as a result, take something into account）。
不收录的：
- 自由组合，意思就是字面相加、母语者不会当作一个整体的（go there, very good, last night, every day, the world, talk to, go home, interest in）
- 语法结构或功能词组合（to be, have been, going to, have to, used to, there is, one of, a lot of, such a, how many, out of, kind of 也算这一类）
- 复合名词、术语、专有名词（health care, sign language, work of art, air force）
- 词典里的残缺片段（in large, something of, up with, lot of）
- 生僻、过时或粗俗的说法

分类 book：
- "verb"：以动词开头的短语（短语动词、动词搭配、动词开头的习语）
- "prep"：介词短语、连词性/副词性固定表达、不以动词开头的习语（at least, in spite of, as soon as, no wonder, all of a sudden）
- "writing"：书面语和写作中特别有用的搭配与衔接表达（in terms of, play a role in, give rise to, with regard to, as a result）。同时属于 verb/prep 的，如果明显偏书面、偏写作，就归 writing
level：1 = 最基础、人人必会；2 = 常用；3 = 较高级

lemma：给出规范写法。指人的宾语写 someone，指物写 something，物主写 one's，反身写 oneself；词典写法如果残缺或不地道，可以修正成最常用的完整形式（如 "take into account" → "take something into account"）；不需要修正就原样返回。全部小写。

返回 JSON：{"items":[{"id":序号,"keep":true/false,"book":"verb"|"prep"|"writing"|null,"level":1|2|3|null,"lemma":"..."}]}，每个候选都要返回一项。"""

def run(batch):
    lines = []
    for i, x in batch:
        zh = x['zh'].split('\\n')[0].split('\n')[0][:40]
        lines.append(f"{i}. {x['lemma']} ｜ {zh} ｜ 频次 {x['freq']}")
    res, usage = chat(SYSTEM, "\n".join(lines), model='deepseek-flash', effort='low')
    return res['items'], usage

if __name__ == '__main__':
    pre = json.load(open('pre.json'))
    lo, hi = int(sys.argv[1]), int(sys.argv[2])
    try: out = json.load(open('stage1.json'))
    except FileNotFoundError: out = {}
    items = [(i, x) for i, x in list(enumerate(pre))[lo:hi] if str(i) not in out]
    batches = [items[k:k+40] for k in range(0, len(items), 40)]
    print('batches', len(batches), file=sys.stderr)
    with cf.ThreadPoolExecutor(int(sys.argv[3]) if len(sys.argv) > 3 else 32) as ex:
        futs = {ex.submit(run, b): b for b in batches}
        for fut in cf.as_completed(futs):
            b = futs[fut]
            try:
                items_, usage = fut.result()
            except Exception as e:
                print('fail', b[0][0], e, file=sys.stderr); continue
            ids = {i for i, _ in b}
            for it in items_:
                if int(it['id']) in ids: out[str(it['id'])] = it
            json.dump(out, open('stage1.json', 'w'), ensure_ascii=False)
            print('ok', b[0][0], usage and usage.get('total_tokens'), file=sys.stderr)
