-- 清理重复的词书例句。
-- 开发模式下启动流程会执行两遍，旧版本里两次写入词书同时进行，每个例句被插了两份
-- （现在写入已改为排队，见 repo/books.ts 的 seedBuiltinBooks）。
-- 同一个句块、同一本书、同一个句子只保留最早写入的一条。

-- 复习记录里指向重复例句的，改指向保留的那一条
UPDATE reviews
SET example_id = (
  SELECT k.id
  FROM examples d
  JOIN examples k
    ON k.chunk_id = d.chunk_id AND k.book_id = d.book_id AND k.sentence_text = d.sentence_text
  WHERE d.id = reviews.example_id
  ORDER BY k.rowid
  LIMIT 1
)
WHERE example_id IN (
  SELECT d.id
  FROM examples d
  WHERE d.book_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM examples k
      WHERE k.chunk_id = d.chunk_id AND k.book_id = d.book_id
        AND k.sentence_text = d.sentence_text AND k.rowid < d.rowid
    )
);

DELETE FROM examples
WHERE rowid IN (
  SELECT d.rowid
  FROM examples d
  WHERE d.book_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM examples k
      WHERE k.chunk_id = d.chunk_id AND k.book_id = d.book_id
        AND k.sentence_text = d.sentence_text AND k.rowid < d.rowid
    )
);
