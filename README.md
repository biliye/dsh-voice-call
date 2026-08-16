# dsh-voice-call 语音通话助手

DSH Web GUI 的个人语音通话助手插件：悬浮球通话面板、FunASR 语音识别（流式/HTTP）、云端 TTS 语音回复、子代理任务分发与进度跟踪。

## ✨ 功能

- 🎙 **悬浮球通话面板**：页面最顶层悬浮球，可拖拽，点击展开通话/任务/设置面板
- 🗣 **语音识别**：FunASR Server HTTP（新版 v1.x，默认）/ FunASR 流式 ws://（旧版 2pass）/ 云端 API（OpenAI 兼容），设置可切换
- 🔊 **语音回复（TTS）**：MiniMax TTS 或 OpenAI 兼容 TTS，可开关；支持最大字数截断检测、语速调节
- 📋 **任务分发**：语音会话（主会话）通过 `voice_task` 工具或面板把任务分发给**独立子代理会话**执行；主会话可查看进度、接收完成结果
- 🧠 **共享记忆**：任务子代理携带主会话上下文摘要；语音会话即主会话（共享历史）
- 👤 **人格设置**：可配置人格，留空用默认
- 🔔 **主动功能**：Host 定时检查任务进度，完成时注入主会话并推送
- 🔌 **联动**：提供 `voiceAssistant` 只读服务，其他插件（如桌宠）可读取任务/状态

## 📦 安装（持久化）

本插件是持久插件，重启 DSH 后仍在「设置 → 插件」中可见。

```bash
# 1. 克隆或放置源码目录
git clone https://github.com/biliye/dsh-voice-call.git ~/.dsh/voice-call-plugin

# 2. 在 web profile 中安装（file: 依赖 + bundles 挂载）
#    在 ~/.dsh/profiles/web/package.json 添加：
#    依赖: "@biliye/dsh-voice-call": "file:../../voice-call-plugin"
#    bundles 追加: "@biliye/dsh-voice-call"
cd ~/.dsh/profiles/web && pnpm install

# 3. 重启 DSH
```

安装后验证：`dsh --profile web --dump-config | grep voice-call` 应输出 `- id: voice-call`。

## 🚀 使用

1. 点右下角 🎙 悬浮球（重启后自动出现）
2. 设置页配置语音识别引擎与 TTS
3. 「▶ 开始通话」→ 说话 →「⏹ 结束通话」→ 录音上传识别 → 文本自动发送到当前会话
4. 助手回复（配置 TTS Key 后自动语音朗读）
5. 「任务」页或语音说"帮我查一下…"分发子代理任务

### 前置依赖

| 组件 | 说明 |
|---|---|
| FunASR Server | 新版 v1.x：`http://127.0.0.1:10095/v1/audio/transcriptions`（OpenAI 兼容）；旧版 runtime：ws://127.0.0.1:10095 |
| node | ≥ 18（Host 端 TTS/ASR 网络桥需要 `node` 在 PATH 中） |
| TTS | MiniMax API Key + GroupId，或 OpenAI 兼容端点 + Key（可选） |

## 🏗 架构

```
lib/
├── index.js   # Host 半：任务分发(agents.create 子代理)、语音文本注入(agent.followup)、
│              # TTS/云端ASR 中转(subprocess node 桥)、/api/voice-call/* 路由、
│              # voice_task 动态工具、voiceAssistant 服务、session/event 监听
└── client.js  # Client 半：悬浮球(shell.overlay slot)、通话面板、录音(MediaRecorder/
               # ScriptProcessor)、FunASR WebSocket/HTTP、TTS 播放、localStorage 设置
```

### 设计要点

- **任务分发**：`agents.create` 创建独立子代理会话（`va-task-*`），携带主会话最近摘要作为共享记忆；完成时 `agent.inject` 结果到主会话
- **语音文本注入**：`agent.followup`（source:user）——与打字完全一致，会话历史可见
- **网络桥**：Host 无 fetch 全局，TTS/云端 ASR 通过 `subprocess` spawn node 脚本执行 HTTPS POST
- **事件推送**：Host 维护事件队列（回复文本/任务状态），Client 轮询 `/api/voice-call/events`
- **不影响其他插件**：独立 slot id、工具 execute 内校验调用者、`voiceAssistant` 服务只读

## 📄 License

MIT
