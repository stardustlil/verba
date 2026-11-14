"""ECDICT 短语 × Tatoeba 英文句子：统计每个短语在句库中出现的句子数，并收集候选例句。"""
import csv, re, sys, json, collections
DL = sys.argv[1]; OUT = sys.argv[2]

SLOT_MAP = {'sb':'someone','sb.':'someone','somebody':'someone','someone':'someone',
            'sth':'something','sth.':'something','something':'something',
            "sb's":"someone's","somebody's":"someone's","someone's":"someone's",
            "one's":"one's",'oneself':'oneself','doing':'doing','do':None}

def norm_lemma(w):
    w = w.replace('’', "'").strip()
    w = re.sub(r'\s*\(.*?\)\s*', ' ', w).strip()
    toks = w.split()
    out = []
    for t in toks:
        tl = t.lower()
        if tl in SLOT_MAP and SLOT_MAP[tl]: out.append(SLOT_MAP[tl])
        else: out.append(tl)
    return ' '.join(out)

# ---------- ECDICT ----------
entries = {}
exchange = {}
with open(f'{DL}/ecdict.csv', encoding='utf-8') as f:
    for row in csv.DictReader(f):
        w = row['word']
        if ' ' not in w:
            if row['exchange']: exchange[w.lower()] = row['exchange']
            continue
        if not row['translation'] or not re.fullmatch(r"[A-Za-z' .\-’()]+", w): continue
        if any(c.isupper() for c in w): continue
        lem = norm_lemma(w)
        n = len(lem.split())
        if n < 2 or n > 7: continue
        if '.' in lem or '(' in lem: continue
        entries.setdefault(lem, {'lemma': lem, 'raw': w, 'zh': row['translation'], 'tag': row['tag'],
                                 'collins': row['collins'], 'oxford': row['oxford']})
print('ecdict phrases', len(entries), file=sys.stderr)

def forms(word):
    fs = {word}
    ex = exchange.get(word)
    if ex:
        for part in ex.split('/'):
            if ':' in part:
                k, v = part.split(':', 1)
                if k in 'pdi3' and v: fs.add(v.lower())
    if word == 'be': fs |= {'is','am','are','was','were','been','being',"'s","'re","'m"}
    return fs

POSS = r"(?:my|your|his|her|its|our|their|\S+'s)"
REFL = r"(?:myself|yourself|himself|herself|itself|ourselves|yourselves|themselves|oneself)"
def slot_re(t):
    if t == 'someone': return r"(?:\S+(?: \S+){0,2})"
    if t == 'something': return r"(?:\S+(?: \S+){0,3})"
    if t in ("one's", "someone's"): return POSS
    if t == 'oneself': return REFL
    if t == 'doing': return r"\S+ing"
    return None

phrases = []
for lem, e in entries.items():
    toks = lem.split()
    parts = []; fixed = []
    for i, t in enumerate(toks):
        s = slot_re(t)
        if s: parts.append(s); continue
        fs = forms(t) if i == 0 or t == 'be' else {t}
        parts.append('(?:' + '|'.join(re.escape(x) for x in sorted(fs, key=len, reverse=True)) + ')')
        fixed.append(fs)
    if not fixed: continue
    if all(slot_re(t) for t in toks[1:]) and len(fixed) == 1: continue  # 只有一个实词 + 占位
    e['re'] = r'(?<!\S)' + ' '.join(parts) + r'(?!\S)'
    e['fixed'] = fixed
    phrases.append(e)

# ---------- Tatoeba ----------
eng = {}
with open(f'{DL}/eng.tsv', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip('\n').split('\t')
        if len(p) >= 3: eng[p[0]] = p[2]
cmn = {}
with open(f'{DL}/cmn.tsv', encoding='utf-8') as f:
    for line in f:
        p = line.rstrip('\n').split('\t')
        if len(p) >= 3: cmn[p[0]] = p[2]
trans = collections.defaultdict(list)
with open(f'{DL}/links.tsv', encoding='utf-8') as f:
    for line in f:
        a, b = line.split()[:2]
        if a in eng and b in cmn: trans[a].append(cmn[b])
print('eng', len(eng), 'with zh', len(trans), file=sys.stderr)

def normsent(s):
    s = s.replace('’', "'").replace('‘', "'").lower()
    return ' '.join(re.findall(r"[a-z0-9]+(?:'[a-z]+)?", s))

# 单词频率，用来挑每个短语的锚点词
sents = []
uni = collections.Counter()
seen = set()
for sid, s in eng.items():
    ns = normsent(s)
    if ns in seen: continue
    seen.add(ns)
    toks = ns.split()
    if len(toks) < 3 or len(toks) > 40: continue
    sents.append((sid, ns))
    uni.update(set(toks))
print('sents', len(sents), file=sys.stderr)

anchor = collections.defaultdict(list)
for i, e in enumerate(phrases):
    best = min(e['fixed'], key=lambda fs: sum(uni[x] for x in fs))
    e['rx'] = re.compile(e['re'])
    for x in best: anchor[x].append(i)

count = collections.Counter()
examples = collections.defaultdict(list)  # 有中文翻译的候选例句
plain = collections.defaultdict(list)     # 无翻译的英文例句（少量）
for n, (sid, ns) in enumerate(sents):
    cand = set()
    for t in set(ns.split()):
        if t in anchor: cand.update(anchor[t])
    for i in cand:
        if phrases[i]['rx'].search(ns):
            count[i] += 1
            if sid in trans:
                if len(examples[i]) < 40: examples[i].append(sid)
            elif len(plain[i]) < 15: plain[i].append(sid)
    if n % 200000 == 0: print(n, file=sys.stderr)

res = []
for i, e in enumerate(phrases):
    if count[i] == 0: continue
    res.append({'lemma': e['lemma'], 'raw': e['raw'], 'zh': e['zh'], 'tag': e['tag'], 'collins': e['collins'],
                'oxford': e['oxford'], 'freq': count[i], 'zh_examples': len(examples[i]),
                'examples': [{'id': s, 'en': eng[s], 'zh': trans[s]} for s in examples[i]],
                'plain': [{'id': s, 'en': eng[s]} for s in plain[i]]})
res.sort(key=lambda r: -r['freq'])
json.dump(res, open(OUT, 'w'), ensure_ascii=False)
print('done', len(res), file=sys.stderr)
