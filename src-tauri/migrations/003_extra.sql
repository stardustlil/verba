-- 额外练习：在每日额度之外学的新句块不占用当天的新句块额度。
-- introduced_extra = 1 表示这个句块是在“额外练习”中跟写完成的。
ALTER TABLE chunks ADD COLUMN introduced_extra INTEGER NOT NULL DEFAULT 0;
