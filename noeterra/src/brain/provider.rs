//! Model providers. A provider turns a question into text and nothing else: no
//! model output is ever executed, fetched or opened.
//!
//! - LM Studio (or any OpenAI-compatible server) is reached in-process over
//!   plain HTTP, and only on a loopback or private-network address.
//! - Anthropic is reached through the system `curl`, because this crate keeps a
//!   pure-Rust dependency tree and TLS would need a C toolchain. The key is read
//!   from `ANTHROPIC_API_KEY` by curl itself (`--variable`), so it never appears
//!   in a command line, a log, a record or the browser.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

#[derive(Clone, Debug)]
pub struct ChatRequest {
    pub system: String,
    pub user: String,
    pub schema_name: String,
    pub schema: Value,
    pub max_tokens: u32,
}

#[derive(Clone, Debug)]
pub struct ChatResponse {
    pub text: String,
    pub model: String,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    pub latency_ms: u64,
}

pub trait ChatProvider: Send + Sync {
    fn name(&self) -> String;
    fn model(&self) -> String;
    fn complete(&self, r: &ChatRequest) -> Result<ChatResponse, String>;
}

/// Whether `url` names a loopback or private-network host over plain HTTP.
pub fn is_local_http(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // `http://127.0.0.1:1234@example.com` names example.com: a URL with user
    // information (or a backslash, which URL parsers read as a path) is refused
    // rather than parsed by hand.
    if authority.contains(['@', '\\']) {
        return false;
    }
    let host = if let Some(h) = authority.strip_prefix('[') {
        h.split(']').next().unwrap_or("")
    } else {
        authority.rsplit_once(':').map(|(h, _)| h).unwrap_or(authority)
    };
    if host == "localhost" || host == "::1" {
        return true;
    }
    // The standard parser refuses `010.0.0.1` and `+127.0.0.1`, which URL parsers
    // read as octal or otherwise differently: a hand split would call `010` ten
    // while the connection went to 8.0.0.1.
    host.parse::<std::net::Ipv4Addr>()
        .is_ok_and(|ip| ip.is_loopback() || ip.is_private())
}

/// One local model server answers one question at a time. Seats queue here,
/// so a call's timeout measures generation rather than time spent waiting
/// behind other seats inside the server.
static LOCAL_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub struct LmStudio {
    base: String,
    model: String,
    agent: ureq::Agent,
}

impl LmStudio {
    /// `base` is the server root including `/v1`. `model` of `None` takes the
    /// first chat model the server lists.
    pub fn connect(base: &str, model: Option<String>, timeout: Duration) -> Result<LmStudio, String> {
        let base = base.trim_end_matches('/').to_string();
        if !is_local_http(&base) {
            return Err(format!(
                "{base} is not a loopback or private-network http:// address; local models stay local"
            ));
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(3))
            .timeout(timeout)
            .build();
        let model = match model {
            Some(m) => m,
            None => {
                let v: Value = agent
                    .get(&format!("{base}/models"))
                    .call()
                    .map_err(|e| format!("model server unreachable at {base}: {e}"))?
                    .into_json()
                    .map_err(|e| format!("model list unreadable: {e}"))?;
                v["data"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m["id"].as_str())
                    .find(|id| !id.contains("embed"))
                    .ok_or("the model server lists no chat model")?
                    .to_string()
            }
        };
        Ok(LmStudio { base, model, agent })
    }

    pub fn list(base: &str) -> Result<Vec<String>, String> {
        if !is_local_http(base) {
            return Err("not a local address".into());
        }
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(3)).build();
        let v: Value = agent
            .get(&format!("{}/models", base.trim_end_matches('/')))
            .call()
            .map_err(|e| e.to_string())?
            .into_json()
            .map_err(|e| e.to_string())?;
        Ok(v["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| m["id"].as_str().map(String::from))
            .collect())
    }
}

impl ChatProvider for LmStudio {
    fn name(&self) -> String {
        "lmstudio".into()
    }
    fn model(&self) -> String {
        self.model.clone()
    }
    fn complete(&self, r: &ChatRequest) -> Result<ChatResponse, String> {
        let body = json!({
            "model": self.model,
            "temperature": 0.6,
            "reasoning_effort": "low",
            // Reasoning models spend tokens thinking before they answer; a small
            // ceiling truncates the JSON, which is then refused as unusable.
            "max_tokens": r.max_tokens,
            "messages": [
                { "role": "system", "content": r.system },
                { "role": "user", "content": r.user }
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": r.schema_name, "strict": true, "schema": r.schema }
            }
        });
        let _turn = LOCAL_GATE.lock().unwrap_or_else(|p| p.into_inner());
        let t = Instant::now();
        let resp = self
            .agent
            .post(&format!("{}/chat/completions", self.base))
            .send_json(body);
        let latency_ms = t.elapsed().as_millis() as u64;
        let v: Value = match resp {
            Ok(r) => r.into_json().map_err(|e| format!("unreadable answer: {e}"))?,
            Err(ureq::Error::Status(code, r)) => {
                let detail = r.into_string().unwrap_or_default();
                return Err(format!(
                    "model server answered {code}: {}",
                    detail.chars().take(300).collect::<String>()
                ));
            }
            Err(e) => return Err(format!("model server unreachable: {e}")),
        };
        let choice = &v["choices"][0];
        let text = choice["message"]["content"].as_str().unwrap_or("").to_string();
        if text.trim().is_empty() {
            return Err(match choice["finish_reason"].as_str() {
                Some("length") => "the model ran out of tokens before answering".into(),
                _ => "the model returned no answer".into(),
            });
        }
        Ok(ChatResponse {
            text,
            model: v["model"].as_str().unwrap_or(&self.model).to_string(),
            tokens_in: v["usage"]["prompt_tokens"].as_u64(),
            tokens_out: v["usage"]["completion_tokens"].as_u64(),
            latency_ms,
        })
    }
}

pub const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
pub const ANTHROPIC_DEFAULT_MODEL: &str = "claude-opus-5-5";

pub struct Anthropic {
    model: String,
    url: String,
    timeout_s: u64,
    effort: String,
}

impl Anthropic {
    pub fn key_present() -> bool {
        std::env::var("ANTHROPIC_API_KEY")
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false)
    }
    pub fn connect(model: Option<String>, timeout: Duration) -> Result<Anthropic, String> {
        if !Self::key_present() {
            return Err("ANTHROPIC_API_KEY is not set in the server's environment".into());
        }
        Ok(Anthropic {
            model: model.unwrap_or_else(|| ANTHROPIC_DEFAULT_MODEL.into()),
            url: std::env::var("NOETERRA_ANTHROPIC_URL").unwrap_or_else(|_| ANTHROPIC_URL.into()),
            timeout_s: timeout.as_secs().max(10),
            effort: std::env::var("NOETERRA_ANTHROPIC_EFFORT").unwrap_or_else(|_| "low".into()),
        })
    }

    fn body(&self, r: &ChatRequest) -> Value {
        json!({
            "model": self.model,
            "max_tokens": r.max_tokens.max(4000),
            // The system prompt is the same every season for a seat, so it is
            // marked for caching; the per-season report follows it.
            "system": [{ "type": "text", "text": r.system, "cache_control": { "type": "ephemeral" } }],
            "messages": [{ "role": "user", "content": r.user }],
            "output_config": {
                "effort": self.effort,
                "format": { "type": "json_schema", "schema": r.schema }
            },
            // If a safety classifier declines, the API retries on a suitable model.
            "fallbacks": "default"
        })
    }
}

impl ChatProvider for Anthropic {
    fn name(&self) -> String {
        "anthropic".into()
    }
    fn model(&self) -> String {
        self.model.clone()
    }
    fn complete(&self, r: &ChatRequest) -> Result<ChatResponse, String> {
        let body = self.body(r).to_string();
        let t = Instant::now();
        let mut child = Command::new("curl")
            .args([
                "-sS",
                "--max-time",
                &self.timeout_s.to_string(),
                "--variable",
                "%ANTHROPIC_API_KEY",
                "--expand-header",
                "x-api-key: {{ANTHROPIC_API_KEY}}",
                "-H",
                "anthropic-version: 2023-06-01",
                "-H",
                "anthropic-beta: server-side-fallback-2026-07-01",
                "-H",
                "content-type: application/json",
                "--data-binary",
                "@-",
                "-w",
                "\n%{http_code}",
                &self.url,
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start curl: {e}"))?;
        child
            .stdin
            .take()
            .ok_or("curl has no stdin")?
            .write_all(body.as_bytes())
            .map_err(|e| format!("could not send the request: {e}"))?;
        let out = child.wait_with_output().map_err(|e| format!("curl failed: {e}"))?;
        let latency_ms = t.elapsed().as_millis() as u64;
        if !out.status.success() {
            return Err(format!(
                "transport error: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        let (payload, code) = stdout.rsplit_once('\n').ok_or("curl gave no status")?;
        let v: Value = serde_json::from_str(payload).map_err(|_| format!("HTTP {code}: unreadable answer"))?;
        if code.trim() != "200" {
            let msg = v["error"]["message"].as_str().unwrap_or("no detail");
            return Err(format!("Anthropic answered {}: {msg}", code.trim()));
        }
        match v["stop_reason"].as_str() {
            Some("refusal") => return Err("the model declined to answer".into()),
            Some("max_tokens") => return Err("the model ran out of tokens before answering".into()),
            _ => {}
        }
        let text: String = v["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect();
        if text.trim().is_empty() {
            return Err("the model returned no answer".into());
        }
        Ok(ChatResponse {
            text,
            model: v["model"].as_str().unwrap_or(&self.model).to_string(),
            tokens_in: v["usage"]["input_tokens"].as_u64().map(|i| {
                i + v["usage"]["cache_read_input_tokens"].as_u64().unwrap_or(0)
                    + v["usage"]["cache_creation_input_tokens"].as_u64().unwrap_or(0)
            }),
            tokens_out: v["usage"]["output_tokens"].as_u64(),
            latency_ms,
        })
    }
}

/// A provider that answers from a script. For tests and offline demonstrations;
/// everything it says is labelled as scripted by the caller.
pub struct Scripted {
    pub answers: std::sync::Mutex<Vec<Result<String, String>>>,
}

impl ChatProvider for Scripted {
    fn name(&self) -> String {
        "scripted".into()
    }
    fn model(&self) -> String {
        "test-double".into()
    }
    fn complete(&self, _r: &ChatRequest) -> Result<ChatResponse, String> {
        let mut a = self.answers.lock().map_err(|_| "poisoned")?;
        let next = if a.len() > 1 {
            a.remove(0)
        } else {
            a.first().cloned().unwrap_or(Err("no answer".into()))
        };
        next.map(|text| ChatResponse {
            text,
            model: "test-double".into(),
            tokens_in: None,
            tokens_out: None,
            latency_ms: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_plain_http_is_accepted() {
        for ok in [
            "http://127.0.0.1:1234/v1",
            "http://localhost:1234",
            "http://192.168.1.5:1234/v1",
            "http://10.0.0.2",
            "http://172.20.1.1:80",
            "http://[::1]:1234/v1",
        ] {
            assert!(is_local_http(ok), "{ok}");
        }
        for bad in [
            "https://127.0.0.1:1234",
            "http://api.example.com/v1",
            "http://8.8.8.8",
            "http://172.32.0.1",
            "http://127.0.0.1.evil.com",
            "ftp://127.0.0.1",
            "http://127.0.0.1:1234@example.com/v1",
            "http://[::1]@example.com",
            "http://user@127.0.0.1:1234",
            "http://example.com?@127.0.0.1",
            "http://127.0.0.1\\@example.com",
            // Leading zeros are octal to URL parsers: 010.0.0.1 is 8.0.0.1.
            "http://010.0.0.1:1234/v1",
            "http://0127.0.0.1",
            "http://+127.0.0.1",
            "http://0x7f.0.0.1",
        ] {
            assert!(!is_local_http(bad), "{bad}");
        }
    }
}
