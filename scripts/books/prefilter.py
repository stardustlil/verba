import json, re
r = json.load(open('counts.json'))
lemmas = {x['lemma'] for x in r}
SLOTS = {'someone', 'something', "one's", "someone's", 'oneself', 'doing'}
SUBJ = {'i','you','he','she','we','they','it','this','that','there','me','him','her','us','them','my','your'}
out = []
for x in r:
    toks = x['lemma'].split()
    if toks[0] in SUBJ and x['lemma'] not in ('it is', ): continue
    if toks[-1] in SLOTS and ' '.join(toks[:-1]) in lemmas: continue
    if toks[0] in SLOTS: continue
    content = [t for t in toks if t not in SLOTS]
    if len(content) < 2 and not any(t in SLOTS for t in toks[1:-1]): 
        if len(content) < 2: continue
    if x['freq'] < 3: continue
    if x['zh_examples'] == 0 and x['freq'] < 8: continue
    out.append(x)
print(len(out))
json.dump(out, open('pre.json','w'), ensure_ascii=False)
for x in out[3000:3020]: print(x['freq'], x['zh_examples'], x['lemma'])
