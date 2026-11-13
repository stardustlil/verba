//! 网页抓取与 AI 请求转发。在 Rust 端发请求可以避开 webview 的跨域限制，
//! 也让 API key 不必进入前端。

use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};

use crate::settings;

const MAX_PAGE_BYTES: usize = 5 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; Verba/0.1)";

#[derive(Serialize)]
pub struct FetchedPage {
    pub html: String,
    pub final_url: String,
}

fn http_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "网址格式不正确".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("只支持 http 和 https 网址".to_string()),
    }
}

/// 从 Content-Type 或 HTML 开头的 meta 标签中找出字符集。
fn detect_charset(content_type: Option<&str>, head: &[u8]) -> Option<String> {
    fn after_charset(text: &str) -> Option<String> {
        let lower = text.to_ascii_lowercase();
        let start = lower.find("charset=")? + "charset=".len();
        let value: String = lower[start..]
            .trim_start_matches(['"', '\''])
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            .collect();
        (!value.is_empty()).then_some(value)
    }
    content_type.and_then(after_charset).or_else(|| {
        let head = &head[..head.len().min(2048)];
        after_charset(&String::from_utf8_lossy(head))
    })
}

fn decode(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = detect_charset(content_type, bytes)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

#[tauri::command]
pub async fn fetch_url(url: String) -> Result<FetchedPage, String> {
    let url = http_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .send()
        .await
        .map_err(|e| format!("无法打开网页：{e}"))?;
    if !response.status().is_success() {
        return Err(format!("网页返回了错误状态 {}", response.status().as_u16()));
    }
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    if let Some(kind) = &content_type {
        let kind = kind.to_ascii_lowercase();
        if !(kind.contains("html") || kind.starts_with("text/")) {
            return Err("这个网址不是网页".to_string());
        }
    }
    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取网页失败：{e}"))?;
        if bytes.len() + chunk.len() > MAX_PAGE_BYTES {
            return Err("网页内容过大".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(FetchedPage {
        html: decode(&bytes, content_type.as_deref()),
        final_url,
    })
}

fn completions_url(base_url: &str) -> Result<reqwest::Url, String> {
    let base = base_url.trim().trim_end_matches('/');
    let full = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    };
    http_url(&full)
}

/// 转发一次 OpenAI 兼容的对话请求，返回模型输出的文本。
#[tauri::command]
pub async fn ai_chat(
    app: tauri::AppHandle,
    base_url: String,
    model: String,
    messages: Value,
    json_mode: bool,
) -> Result<String, String> {
    let key = settings::read_api_key(&app)?.ok_or_else(|| "尚未填写 API key".to_string())?;
    let url = completions_url(&base_url)?;
    let mut body = json!({
        "model": model,
        "messages": messages,
        "temperature": 0,
        "stream": false,
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 AI 服务失败：{e}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 服务响应失败：{e}"))?;
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回错误 {}：{snippet}", status.as_u16()));
    }
    let parsed: Value =
        serde_json::from_str(&text).map_err(|_| "AI 服务返回的不是 JSON".to_string())?;
    parsed["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "AI 服务的响应中没有内容".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_are_allowed() {
        assert!(http_url("https://example.com/a").is_ok());
        assert!(http_url(" http://example.com ").is_ok());
        assert!(http_url("file:///etc/passwd").is_err());
        assert!(http_url("javascript:alert(1)").is_err());
        assert!(http_url("not a url").is_err());
    }

    #[test]
    fn completions_url_appends_path_once() {
        assert_eq!(
            completions_url("https://api.deepseek.com").unwrap().as_str(),
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(
            completions_url("https://api.openai.com/v1/").unwrap().as_str(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            completions_url("https://x.test/v1/chat/completions")
                .unwrap()
                .as_str(),
            "https://x.test/v1/chat/completions"
        );
    }

    #[test]
    fn charset_from_header_then_meta() {
        assert_eq!(
            detect_charset(Some("text/html; charset=ISO-8859-1"), b""),
            Some("iso-8859-1".to_string())
        );
        assert_eq!(
            detect_charset(Some("text/html"), b"<meta charset=\"windows-1252\">"),
            Some("windows-1252".to_string())
        );
        assert_eq!(detect_charset(None, b"<html>"), None);
    }

    #[test]
    fn decodes_windows_1252_quotes() {
        // 0x92 在 windows-1252 中是右单引号
        let html = decode(b"it\x92s", Some("text/html; charset=windows-1252"));
        assert_eq!(html, "it\u{2019}s");
        assert_eq!(decode("it’s".as_bytes(), None), "it’s");
    }
}
