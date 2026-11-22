# Agnes AI 接入参考（实测整理）

> 本文件由一次实测整理而成：以下模型清单、端点、返回码均已在 2026-11-19 用实际 API Key 验证。
> 不要把真实 Key 写进前端代码、仓库或日志，运行时从环境变量读取。

## 1. 基本信息

| 项目 | 值 |
| --- | --- |
| 国际站控制台（建 Key / 看用量） | https://platform.agnes-ai.com |
| OpenAI 兼容 Base URL | `https://apihub.agnes-ai.com/v1` |
| 图片接口根地址 | `https://apihub.agnes-ai.com` |
| 文档 | https://wiki.agnes-ai.com/zh-Hans/docs/quickstart.md |
| 国内站 | `https://api.agnes-ai.cn/v1`（**不同的 Key 体系**，国际站 Key 在此返回 401） |

鉴权：

```text
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

Anthropic 兼容的 `/v1/messages` 用 `x-api-key` + `anthropic-version: 2023-06-01`。

## 2. 可用模型

`GET /v1/models` 实测返回（国际站）：

| 模型 ID | 类型 | 端点 | 实测 |
| --- | --- | --- | --- |
| `agnes-3.0-flash` | 文本/Agent，最新 | `/chat/completions` | 200 |
| `agnes-2.5-flash` | 文本/Agent，主力 | `/chat/completions` | 200 |
| `agnes-2.5-pro` | 文本，稳定版 Pro | `/chat/completions` | 200 |
| `agnes-2.5-pro-beta` | 文本，Pro Beta | `/chat/completions` | 200 |
| `agnes-2.5-pro-alpha` | 文本，Pro Alpha | `/chat/completions` | 200 |
| `agnes-image-2.5-flash` | 图像（最新） | `/images/generations` | 200 |
| `agnes-image-2.1-flash` | 图像 | `/images/generations` | — |
| `agnes-image-2.0-flash` | 图像 | `/images/generations` | — |
| `agnes-video-2.5` | 视频 | `/videos` | — |
| `agnes-video-2.5-flash` | 视频（限时免费） | `/videos` | — |

文档里出现但当前 Key / 当前服务不可用：

| 模型 ID | 实测结果 |
| --- | --- |
| `agnes-1.5-flash` | `500 get_channel_failed`（模型暂时不可用） |
| `agnes-2.5-pro-theta` | `404 model_not_found`（不在当前分组） |
| `agnes-2.0-flash` | 文档标注已废弃，`/models` 中已移除 |
| `agnes-3.0-pro` | 即将上线 |

**没有 TTS / 语音模型。** `POST /v1/audio/speech` 返回 404（`Model tts-1 is not available`）。因此「文本转语音」不能走 Agnes，只有文本、图像、视频。

## 3. 文本调用

### 3.1 Chat Completions（与 OpenAI 完全兼容）

```js
const res = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.AGNES_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'agnes-2.5-flash',
    messages: [
      { role: 'system', content: '你是中文助理。' },
      { role: 'user', content: '你好' },
    ],
    temperature: 0.7,
    max_tokens: 1024,
    stream: false,
  }),
});
const data = await res.json();
console.log(data.choices[0].message.content);
```

要点：

- 支持 `stream: true`（SSE，末尾有 `[DONE]`）、`tools` / `tool_choice` 函数调用、图像 URL 输入。
- 响应带 `usage.completion_tokens_details.reasoning_tokens`，说明模型有推理 token；推理会消耗输出预算，`max_tokens` 给小了正文可能是空的。
- 图像输入格式：`content: [{ type: 'text', text }, { type: 'image_url', image_url: { url } }]`，URL 必须公网可访问。
- Thinking 模式：OpenAI 格式加 `chat_template_kwargs: { enable_thinking: true }`；Anthropic 格式加 `thinking: { type: 'enabled', budget_tokens: 2048 }`。

实测响应（`agnes-2.5-flash`，短问句）：

```json
{"completion_tokens":50,"prompt_tokens":290,"total_tokens":340,
 "completion_tokens_details":{"reasoning_tokens":46,"text_tokens":4},
 "prompt_tokens_details":{"cached_tokens":256}}
```

### 3.2 Responses API（OpenAI 新版格式）

`POST /v1/responses`，用 `input` 代替 `messages`。

- ✅ `input: "纯文本"` 可用（实测 `agnes-2.5-flash` 200）。
- ❌ 结构化输入数组（`input: [{ role, content: [{ type: 'input_text' }] }]`）目前返回 `500 bad_response_body`；`agnes-3.0-flash` + 字符串输入也返回同样的 500。**接入时优先用 Chat Completions。**
- 响应没有顶层 `output_text`，正文在 `output[].content[]` 中 `type === 'output_text'` 的 `text` 字段。

### 3.3 Anthropic Messages API

`POST /v1/messages`，头用 `x-api-key`，实测 `agnes-3.0-flash` 200：

```json
{"type":"message","role":"assistant","content":[{"type":"text","text":"你好"}],
 "stop_reason":"end_turn","usage":{"input_tokens":76,"output_tokens":2}}
```

好处：可以直接给 Claude Code / Claude Desktop 之类只认 Anthropic 协议的客户端用。

## 4. 图像调用

`POST /v1/images/generations`，必填 `model`、`prompt`、`size`（推荐档位 `1K`/`2K`/`3K`/`4K` 配 `ratio`）。

```js
const res = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'agnes-image-2.5-flash',
    prompt: '一只戴耳机的橘猫，扁平插画风格',
    size: '1K',
    ratio: '1:1',
    extra_body: { response_format: 'url' }, // 不要放顶层
  }),
});
```

实测返回：

```json
{"data":[{"url":"https://platform-outputs.agnes-ai.space/images/t2i/task_.../output_....png","b64_json":"","revised_prompt":""}],
 "created":1795054171,"task_id":"task_..."}
```

- 图生图 / 多图合成：`extra_body.image: [url 或 data URI]`，不要传 `tags: ['img2img']`。
- Base64 输出：文生图用 `return_base64: true`，图生图用 `extra_body.response_format: 'b64_json'`。
- `size` 是档位，不是像素；`1920x1080` 这类会被映射（16:9 的 1K 是 `1312x736`）。
- 生成耗时可能几十秒，客户端超时建议 60–360s。

## 5. 视频调用

`POST /v1/videos`（OpenAI Videos 兼容），异步任务，按 `video_id` 轮询：

```text
GET https://apihub.agnes-ai.com/agnesapi?video_id=<VIDEO_ID>
```

旧格式 `GET /v1/videos/{task_id}` 仅作兼容。当前调色板 `agnes-video-2.5`（按秒计费）与 `agnes-video-2.5-flash`（限时 $0）。

## 6. 价格与限额（刊例价 / 当前优惠）

文本：

| 模型 | 输入缓存命中 | 输入 | 输出 | 当前 |
| --- | --- | --- | --- | --- |
| `agnes-3.0-flash` | $0.005/M | $0.05/M | $0.15/M | **全免** |
| `agnes-2.5-flash` | $0.005/M | $0.05/M | $0.15/M | **全免** |
| `agnes-2.5-pro` / `-beta` / `-theta` | $0.01–0.045/M | $0.10–0.45/M | $0.30–0.90/M | 按刊例价 |

图像：1K/2K/3K/4K 分别 $10/$18/$21/$24 每千张，第 4 张起的参考图 $0.003/张 —— **当前全部 $0**。

视频：`agnes-video-2.5` 720P $0.025/秒、1080P/1K $0.040/秒、2K $0.055/秒；`agnes-video-2.5-flash` 当前 $0。

限速（免费 / 默认账户）：文本 30 RPM（实际可执行 20），图片 1K 30 RPM / 2K 20 RPM / 3K 2 RPM / 4K 1 RPM，视频 2 RPM。Token Plan 可到文本 1000 RPM。

上下文：`agnes-2.5-flash` 512K 上下文 / 65.5K 输出；`agnes-1.5-flash`、`agnes-2.0-flash` 256K / 64K。

## 7. 常见错误

| 状态码 | 含义 |
| --- | --- |
| 401 | Key 无效或用了国内站的 Key 打国际站 |
| 402 | 余额 / 订阅 / 调用前校验未通过 |
| 404 `model_not_found` | 模型不在当前账户分组 |
| 500 `get_channel_failed` | 模型通道暂时不可用，换模型 |
| 500 `bad_response_body` | 请求体结构被网关判定非法（见 `/responses` 结构化输入问题） |
| 429 | 超 RPM 或订阅配额 |

排查时保留状态码、完整响应体、时间和 `request id`（响应 body 里带），但不要公开完整 Key。

## 8. 与「TTS Vue next」项目的关系

本项目的「OpenAI 兼容语音接口」走的是 `POST /audio/speech`（`tts-1` 那套协议），Agnes 没有这个端点，**把 Base URL 指向 Agnes 会在 TTS 通道直接失败**。

Agnes 在这个项目里能用的位置：

- 生成 / 改写配音文案、批量脚本、多语言翻译 → `agnes-2.5-flash`（当前免费，512K 上下文够长剧本）；
- 封面图、插图、缩略图 → `agnes-image-2.5-flash`（当前免费）；
- 宣传短视频素材 → `agnes-video-2.5-flash`。
