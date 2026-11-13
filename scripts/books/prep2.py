import json, re
pre = json.load(open('pre.json'))
s1 = json.load(open('stage1.json'))
groups = {}
for k, v in s1.items():
    if not v.get('keep') or v.get('book') not in ('verb', 'prep', 'writing'): continue
    x = pre[int(k)]
    lemma = re.sub(r'\s+', ' ', (v.get('lemma') or x['lemma']).strip().lower().replace('’', "'"))
    g = groups.get(lemma)
    if g is None:
        groups[lemma] = {'lemma': lemma, 'book': v['book'], 'level': v.get('level') or 2, 'freq': x['freq'],
                         'zh_short': x['zh'].split('\\n')[0].split('\n')[0][:60],
                         'examples': list(x['examples']), 'plain': list(x['plain']), 'sources': [x['lemma']]}
    else:
        g['sources'].append(x['lemma'])
        if x['freq'] > g['freq']:
            g['freq'] = x['freq']; g['book'] = v['book']
            g['zh_short'] = x['zh'].split('\\n')[0].split('\n')[0][:60]
        g['level'] = min(g['level'], v.get('level') or 2)
        seen = {e['en'] for e in g['examples']}
        g['examples'] += [e for e in x['examples'] if e['en'] not in seen]
        seen = {e['en'] for e in g['plain']}
        g['plain'] += [e for e in x['plain'] if e['en'] not in seen]
json.dump(groups, open('stage2_in.json', 'w'), ensure_ascii=False)
import collections
print(len(groups), collections.Counter(g['book'] for g in groups.values()))
