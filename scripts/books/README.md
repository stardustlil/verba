# 生成内置词书

数据来源与许可见 [src/data/books/SOURCES.md](../../src/data/books/SOURCES.md)。脚本需要 Python 3 和环境变量 `DEEPSEEK_API_KEY`，中间文件写在当前目录。

```bash
# 1. 下载数据（约 100 MB）到 dl/
curl -L -o dl/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
curl -L https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2 | bunzip2 > dl/eng.tsv
curl -L https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2 | bunzip2 > dl/cmn.tsv
curl -L https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2 | bunzip2 > dl/links.tsv

# 2. 统计频率、收集候选例句，粗筛
python3 count.py dl counts.json
python3 prefilter.py

# 3. 大模型判断是否收录、分书（stage1.json），汇总同义写法（stage2_in.json）
python3 stage1.py 0 100000 32
python3 prep2.py

# 4. 挑选候选（每本的数量在 run 前手动截取 stage2_in.json），挑例句、写释义、校对翻译
python3 stage2.py 24

# 5. 校验并组装
python3 assemble.py books.json
```

两步大模型调用都可以中断后重跑，已完成的部分会跳过。最后一步之后还做了一次去重：同一段例句里短语后面紧跟介词、能和它组成另一个已收录短语的（如 in front 与 in front of），去掉较短的那个。
