/** 界面与 Rust 端之间的全部调用都集中在这里 */
import { invoke } from "@tauri-apps/api/core";
import type { AiClient, ChatMessage } from "../core/extract/types";
import type { Db } from "../repo/db";
import { getSettings } from "../repo/settings";
import { tauriDb } from "../repo/tauriDb";

export const db: Db = tauriDb;

/** 通过 Rust 端转发的 AI 客户端；API key 由 Rust 端注入，不经过前端 */
export const ai: AiClient = {
  async chat(messages: ChatMessage[], options: { json: boolean }): Promise<string> {
    const settings = await getSettings(db);
    return invoke<string>("ai_chat", {
      baseUrl: settings.aiBaseUrl,
      model: settings.aiModel,
      messages,
      jsonMode: options.json,
    });
  },
};

export function fetchUrl(url: string): Promise<{ html: string; final_url: string }> {
  return invoke("fetch_url", { url });
}

export function readTextFile(path: string): Promise<{ name: string; content: string }> {
  return invoke("read_text_file", { path });
}

/** 遮盖后的 API key，如 sk-****abcd；未填写时为 null */
export function getApiKeyMasked(): Promise<string | null> {
  return invoke("get_api_key_masked");
}

/** 传空字符串表示清除 */
export function setApiKey(key: string): Promise<void> {
  return invoke("set_api_key", { key });
}

export function openDataDir(): Promise<void> {
  return invoke("open_data_dir");
}

/** Rust 端的错误是字符串，其他异常取 message */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
