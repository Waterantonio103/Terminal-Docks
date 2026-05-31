use serde::{Deserialize, Serialize};
use std::io::Read;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkHttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkHttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SdkHttpStreamEvent {
    stream_id: String,
    status: Option<u16>,
    status_text: Option<String>,
    headers: Option<Vec<(String, String)>>,
    chunk: Option<Vec<u8>>,
    done: bool,
    error: Option<String>,
}

fn is_allowed_sdk_url(url: &str) -> bool {
    url.starts_with("https://api.openai.com/")
}

fn response_headers(response: &ureq::Response) -> Vec<(String, String)> {
    ["content-type", "x-request-id"]
        .iter()
        .filter_map(|name| {
            response
                .header(name)
                .map(|value| ((*name).to_string(), value.to_string()))
        })
        .collect()
}

fn read_response_body(response: ureq::Response) -> String {
    let mut reader = response.into_reader();
    let mut body = String::new();
    let _ = reader.read_to_string(&mut body);
    body
}

fn response_from_ureq(response: ureq::Response) -> SdkHttpResponse {
    let status = response.status();
    let status_text = response.status_text().to_string();
    let headers = response_headers(&response);
    let body = read_response_body(response);
    SdkHttpResponse {
        status,
        status_text,
        headers,
        body,
    }
}

#[tauri::command]
pub async fn sdk_http_request(request: SdkHttpRequest) -> Result<SdkHttpResponse, String> {
    if !is_allowed_sdk_url(&request.url) {
        return Err("SDK HTTP bridge only allows OpenAI API requests".to_string());
    }

    let method = request.method.trim().to_uppercase();
    if method != "POST" && method != "GET" {
        return Err(format!("SDK HTTP bridge does not allow {method} requests"));
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(125))
        .timeout_write(Duration::from_secs(30))
        .build();
    let mut builder = match method.as_str() {
        "GET" => agent.get(&request.url),
        _ => agent.post(&request.url),
    };

    for (name, value) in request.headers {
        let lower = name.to_ascii_lowercase();
        if lower == "host" || lower == "content-length" || lower == "connection" {
            continue;
        }
        builder = builder.set(&name, &value);
    }

    let result = if let Some(body) = request.body {
        builder.send_string(&body)
    } else {
        builder.call()
    };

    match result {
        Ok(response) => Ok(response_from_ureq(response)),
        Err(ureq::Error::Status(_, response)) => Ok(response_from_ureq(response)),
        Err(error) => Err(format!("SDK HTTP bridge request failed: {error}")),
    }
}

fn emit_sdk_stream_event(app: &AppHandle, event: SdkHttpStreamEvent) {
    let _ = app.emit("sdk-http-stream", event);
}

fn emit_sdk_stream_error(app: &AppHandle, stream_id: String, error: String) {
    emit_sdk_stream_event(
        app,
        SdkHttpStreamEvent {
            stream_id,
            status: None,
            status_text: None,
            headers: None,
            chunk: None,
            done: true,
            error: Some(error),
        },
    );
}

#[tauri::command]
pub async fn sdk_http_stream(
    app: AppHandle,
    request: SdkHttpRequest,
    stream_id: String,
) -> Result<(), String> {
    if !is_allowed_sdk_url(&request.url) {
        return Err("SDK HTTP bridge only allows OpenAI API requests".to_string());
    }

    let method = request.method.trim().to_uppercase();
    if method != "POST" && method != "GET" {
        return Err(format!("SDK HTTP bridge does not allow {method} requests"));
    }

    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(125))
            .timeout_write(Duration::from_secs(30))
            .build();
        let mut builder = match method.as_str() {
            "GET" => agent.get(&request.url),
            _ => agent.post(&request.url),
        };

        for (name, value) in request.headers {
            let lower = name.to_ascii_lowercase();
            if lower == "host" || lower == "content-length" || lower == "connection" {
                continue;
            }
            builder = builder.set(&name, &value);
        }

        let result = if let Some(body) = request.body {
            builder.send_string(&body)
        } else {
            builder.call()
        };

        let response = match result {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(error) => {
                emit_sdk_stream_error(
                    &app,
                    stream_id,
                    format!("SDK HTTP bridge request failed: {error}"),
                );
                return;
            }
        };

        let status = response.status();
        let status_text = response.status_text().to_string();
        let headers = response_headers(&response);
        emit_sdk_stream_event(
            &app,
            SdkHttpStreamEvent {
                stream_id: stream_id.clone(),
                status: Some(status),
                status_text: Some(status_text),
                headers: Some(headers),
                chunk: None,
                done: false,
                error: None,
            },
        );

        let mut reader = response.into_reader();
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => emit_sdk_stream_event(
                    &app,
                    SdkHttpStreamEvent {
                        stream_id: stream_id.clone(),
                        status: None,
                        status_text: None,
                        headers: None,
                        chunk: Some(buffer[..count].to_vec()),
                        done: false,
                        error: None,
                    },
                ),
                Err(error) => {
                    emit_sdk_stream_error(
                        &app,
                        stream_id,
                        format!("SDK HTTP bridge stream failed: {error}"),
                    );
                    return;
                }
            }
        }

        emit_sdk_stream_event(
            &app,
            SdkHttpStreamEvent {
                stream_id,
                status: None,
                status_text: None,
                headers: None,
                chunk: None,
                done: true,
                error: None,
            },
        );
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_sdk_url;

    #[test]
    fn only_allows_openai_https_api_urls() {
        assert!(is_allowed_sdk_url("https://api.openai.com/v1/responses"));
        assert!(is_allowed_sdk_url(
            "https://api.openai.com/v1/chat/completions"
        ));
        assert!(!is_allowed_sdk_url("http://api.openai.com/v1/responses"));
        assert!(!is_allowed_sdk_url("https://example.com/v1/responses"));
        assert!(!is_allowed_sdk_url(
            "https://api.openai.com.evil.test/v1/responses"
        ));
        assert!(!is_allowed_sdk_url("https://api.anthropic.com/v1/messages"));
    }
}
