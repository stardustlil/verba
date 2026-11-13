"""把第二步的结果组装成三本词书 JSON，并做和 books.test.ts 相同的校验。"""
import json, re, sys, collections
OUT = sys.argv[1]
todo = json.load(open('stage2_in.json'))
res = json.load(open('stage2.json'))
eng_ids = {}  # 例句原文 → Tatoeba 编号
for x in todo.values():
    for e in x['examples'] + x['plain']: eng_ids[e['en']] = int(e['id'])

CJK = re.compile(r'[一-鿿]')
PRONOUN = re.compile(r"\b(my|your|his|her|its|our|their|myself|yourself|himself|herself|itself|ourselves|themselves|him|them|me|us)\b", re.I)
TRAD = set('們這個來時會說為對過還點麼後國學開關見長門問間題體頭臉電話車愛書讀寫聽買賣錢銀飯飲雞魚鳥馬東車從給讓認識覺歡應該當經處現發動實樣種與歲號邊幾機氣請誰風')
def straight(s): return s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')

def locate(sentence, surface):
    hay = straight(sentence).lower(); needle = straight(surface).lower().strip()
    start = 0
    while True:
        i = hay.find(needle, start)
        if i < 0: return None
        j = i + len(needle)
        if (i == 0 or not hay[i-1].isalnum()) and (j == len(hay) or not hay[j].isalnum()): return i
        start = i + 1

books = {'verb': [], 'prep': [], 'writing': []}
problems = collections.Counter(); seen = set()
for key, x in sorted(todo.items(), key=lambda kv: (kv[1]['level'], -kv[1]['freq'])):
    it = res.get(key)
    if not it: problems['未处理'] += 1; continue
    if not it.get('keep'): problems['不收录'] += 1; continue
    lemma = re.sub(r'\s+', ' ', straight(it.get('lemma') or '').strip().lower())
    if it.get('written'):
        example = (it.get('sentence') or '').strip(); source = None
    else:
        idx = it.get('example')
        if idx is None or not isinstance(idx, int) or idx >= len(it['cands']): problems['没有例句'] += 1; continue
        example = it['cands'][idx]['en'].strip(); source = eng_ids.get(example)
    surface = (it.get('surface') or '').strip().strip('.,!?;:')
    meaning = (it.get('meaning') or '').strip(); translation = (it.get('translation') or '').strip()
    why = None
    n = len(lemma.split()); m = len(surface.split())
    if not lemma or re.search(r"[/()…]|\.\.\.", lemma): why = '原形格式'
    elif n < 2 or n > 8 or m < 2 or m > 8: why = '词数'
    elif PRONOUN.search(lemma) or re.search(r'[A-Z]', lemma): why = '原形人称/大写'
    elif not CJK.search(meaning) or not CJK.search(translation): why = '缺中文'
    elif any(c in TRAD for c in meaning + translation): why = '繁体'
    elif not re.search(r'[.!?]["”’]?$', example): why = '句末标点'
    elif locate(example, surface) is None: why = '原文形式不在例句中'
    elif len(meaning) > 16: why = '释义太长'
    if why: problems[why] += 1; continue
    if lemma in seen: problems['重复'] += 1; continue
    seen.add(lemma)
    pos = locate(example, surface)
    entry = {'lemma': lemma, 'surface': example[pos:pos + len(surface)], 'meaning': meaning,
             'example': example, 'translation': translation}
    if source: entry['tatoeba'] = source
    books[todo[key]['book']].append(entry)
print({k: len(v) for k, v in books.items()}, dict(problems))
written = sum(1 for v in books.values() for e in v if 'tatoeba' not in e)
print('自写例句', written)
json.dump(books, open(OUT, 'w'), ensure_ascii=False, indent=1)
