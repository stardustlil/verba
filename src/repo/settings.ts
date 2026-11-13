/** 非敏感设置（需求第 9 节），存在 meta 表里。API key 不在这里，由 Rust 端单独保管。 */
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from "../core/extract/defaults";
import type { Db } from "./db";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  aiBaseUrl: string;
  aiModel: string;
  /** 每日新句块数 */
  dailyNew: number;
  /** “写得慢”的时长，秒 */
  slowSeconds: number;
  theme: Theme;
  /** 跟写时自动朗读 */
  autoSpeak: boolean;
  /** 打字音效：击键声、打错字母提示音、答对 / 答错结果音 */
  typingSound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  aiBaseUrl: DEFAULT_AI_BASE_URL,
  aiModel: DEFAULT_AI_MODEL,
  dailyNew: 20,
  slowSeconds: 30,
  theme: "system",
  autoSpeak: true,
  typingSound: true,
};

const KEYS: Record<keyof Settings, string> = {
  aiBaseUrl: "ai_base_url",
  aiModel: "ai_model",
  dailyNew: "daily_new",
  slowSeconds: "slow_seconds",
  theme: "theme",
  autoSpeak: "auto_speak",
  typingSound: "typing_sound",
};

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: string }>("SELECT key, value FROM meta");
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const theme = stored.get(KEYS.theme);
  return {
    aiBaseUrl: stored.get(KEYS.aiBaseUrl)?.trim() || DEFAULT_SETTINGS.aiBaseUrl,
    aiModel: stored.get(KEYS.aiModel)?.trim() || DEFAULT_SETTINGS.aiModel,
    dailyNew: positiveInt(stored.get(KEYS.dailyNew), DEFAULT_SETTINGS.dailyNew, 500),
    slowSeconds: positiveInt(stored.get(KEYS.slowSeconds), DEFAULT_SETTINGS.slowSeconds, 600),
    theme: theme === "light" || theme === "dark" ? theme : "system",
    autoSpeak: stored.get(KEYS.autoSpeak) !== "false",
    typingSound: stored.get(KEYS.typingSound) !== "false",
  };
}

export async function saveSettings(db: Db, changes: Partial<Settings>): Promise<void> {
  const statements = Object.entries(changes).map(([name, value]) => ({
    sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    params: [KEYS[name as keyof Settings], String(value)],
  }));
  await db.transaction(statements);
}
