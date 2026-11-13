# 内置词书的数据来源

三本内置词书（`verb-phrases.json`、`prep-expressions.json`、`writing-collocations.json`）由 `scripts/books/` 中的脚本生成：

1. **候选短语**取自 [ECDICT](https://github.com/skywind3000/ECDICT) 英汉词典中的多词条目（MIT 许可，版权声明见下）。
2. 按每个短语在 [Tatoeba](https://tatoeba.org) 英文句库（约 200 万句）中出现的句子数统计频率并排序。
3. 由大模型（DeepSeek）剔除自由组合、语法结构和复合名词，按类别分书；再为每个短语从 Tatoeba 的英汉对照句中挑选例句、按例句写出中文释义，并校对例句翻译。
4. 去重、校验后写成 JSON。

## 例句与翻译

条目中带 `tatoeba` 字段的，例句取自 Tatoeba，字段值为句子编号（`https://tatoeba.org/sentences/show/<编号>`）。
Tatoeba 的句子以 [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) 许可发布，版权归各句作者所有。
部分中文翻译由人工翻译经校对修改，或在原句没有中文翻译时新译。

不带 `tatoeba` 字段的条目（约 9%），例句为生成时新写。

## ECDICT 版权声明

```
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
