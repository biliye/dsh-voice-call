window.__ModuleLoader__.load({
	id: "@linxin666/dsh-voice-call",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		//#region src/client/index.js
		const NS = "voice-call";
		const inject = ["slots", "sessions", "timer"];
		const API = {
			getState: "/api/voice-call/state",
			bindSession: "/api/voice-call/bind-session",
			setPersona: "/api/voice-call/persona",
			sendText: "/api/voice-call/send-text",
			tts: "/api/voice-call/tts",
			cloudAsr: "/api/voice-call/asr",
			createTask: "/api/voice-call/tasks",
			taskList: "/api/voice-call/tasks",
			taskStatus: "/api/voice-call/task-status",
			pollEvents: "/api/voice-call/events",
		};
		const call = async (url, body) => {
			const options = body === undefined
				? { method: 'GET' }
				: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
			const res = await fetch(url, options)
			let data = null
			try { data = await res.json() } catch {}
			if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
			return data
		}
		const DEFAULTS = {
			asrMode: 'funasr-http',
			asrUrl: 'ws://127.0.0.1:10095',
			funasrHttpBase: 'http://127.0.0.1:10095/v1/audio/transcriptions',
			funasrHttpKey: '',
			funasrHttpModel: '',
			cloudAsrBase: 'https://api.openai.com/v1/audio/transcriptions',
			cloudAsrKey: '',
			cloudAsrModel: 'whisper-1',
			ttsEnabled: true,
			ttsProvider: 'minimax',
			ttsBase: 'https://api.openai.com/v1/audio/speech',
			ttsKey: '',
			ttsGroupId: '',
			ttsVoice: '',
			ttsSpeed: 1,
			ttsMaxChars: 300,
			persona: '',
			autoSend: true,
			checkMs: 30000,
			pos: { x: -1, y: -1 },
		}
		const loadSettings = () => {
			let merged = { ...DEFAULTS }
			try {
				const raw = window.localStorage.getItem('dsh.voiceCall.v1')
				if (raw) {
					const stored = JSON.parse(raw)
					merged = { ...merged, ...stored }
					if (merged.asrMode === 'funasr' && stored.funasrHttpBase === undefined) {
						merged.asrMode = 'funasr-http'
					}
				}
			} catch {}
			try { window.localStorage.setItem('dsh.voiceCall.v1', JSON.stringify(merged)) } catch {}
			return merged
		}
		const saveSettings = (s) => {
			try { window.localStorage.setItem('dsh.voiceCall.v1', JSON.stringify(s)) } catch {}
		}
		const sessionTitle = (list, id) => {
			const row = id ? list?.byId?.[id] : undefined
			return row?.displayTitle || row?.title || id || '未绑定会话'
		}
		const STYLE = `
.va-fab { position: fixed; width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg,#6c5ce7,#a29bfe); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483000; box-shadow: 0 6px 20px rgba(0,0,0,.35); font-size: 24px; user-select: none; touch-action: none; border: none; }
.va-fab:hover { transform: scale(1.08); }
.va-fab.on { background: linear-gradient(135deg,#e17055,#ff7675); animation: va-pulse 1.2s infinite; }
@keyframes va-pulse { 0%,100% { box-shadow: 0 6px 20px rgba(225,112,85,.6); } 50% { box-shadow: 0 6px 28px rgba(225,112,85,.95); } }
.va-panel { position: fixed; width: 420px; max-width: calc(100vw - 24px); height: 560px; max-height: calc(100vh - 24px); background: #1e2130; border: 1px solid #3a3f56; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.5); z-index: 2147483001; display: flex; flex-direction: column; overflow: hidden; color: #e8eaf2; font: 13px/1.5 system-ui, sans-serif; }
.va-panel .va-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #262a3d; border-bottom: 1px solid #3a3f56; }
.va-panel .va-head .va-title { font-weight: 700; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-panel .va-head .va-tab { background: transparent; color: #9aa0b5; border: none; cursor: pointer; padding: 4px 10px; border-radius: 8px; font-size: 13px; }
.va-panel .va-head .va-tab.on { background: #6c5ce7; color: #fff; }
.va-panel .va-head .va-x { background: transparent; border: none; color: #9aa0b5; cursor: pointer; font-size: 16px; padding: 2px 6px; }
.va-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.va-row { display: flex; gap: 8px; align-items: center; }
.va-btn { background: #6c5ce7; color: #fff; border: none; border-radius: 10px; padding: 8px 14px; cursor: pointer; font-size: 13px; }
.va-btn:disabled { opacity: .5; cursor: not-allowed; }
.va-btn.danger { background: #e17055; }
.va-btn.ghost { background: #33384f; }
.va-input { flex: 1; background: #161a29; color: #e8eaf2; border: 1px solid #3a3f56; border-radius: 10px; padding: 8px 10px; font-size: 13px; outline: none; }
.va-input:focus { border-color: #6c5ce7; }
.va-transcript { background: #161a29; border-radius: 10px; padding: 10px; min-height: 64px; white-space: pre-wrap; word-break: break-word; color: #cfd4e6; }
.va-msg { background: #262a3d; border-radius: 10px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; }
.va-msg.user { background: #33386e; }
.va-msg .va-tag { color: #9aa0b5; font-size: 11px; margin-right: 6px; }
.va-task { background: #262a3d; border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.va-task .va-t { display: flex; justify-content: space-between; gap: 8px; }
.va-badge { font-size: 11px; padding: 1px 8px; border-radius: 8px; white-space: nowrap; }
.va-badge.running { background: #fdcb6e55; color: #ffeaa7; }
.va-badge.completed { background: #00b89455; color: #55efc4; }
.va-badge.error { background: #d6303155; color: #ff7675; }
.va-badge.pending { background: #636e7255; color: #dfe6e9; }
.va-hint { color: #9aa0b5; font-size: 12px; }
.va-set { display: flex; flex-direction: column; gap: 3px; }
.va-set label { color: #9aa0b5; font-size: 12px; }
.va-select, .va-input { width: 100%; box-sizing: border-box; }
.va-status { display: flex; gap: 10px; align-items: center; font-size: 12px; color: #9aa0b5; flex-wrap: wrap; }
.va-dot { width: 8px; height: 8px; border-radius: 50%; background: #636e72; }
.va-dot.live { background: #00b894; animation: va-pulse 1.2s infinite; }
.va-sendwrap { display: flex; gap: 8px; }
`
		const e = React.createElement
		const Fragment = React.Fragment
		let ctxRef = null
		function Fab(props) {
			const { useSessions } = props
			const [settings, setSettings] = React.useState(loadSettings)
			const [open, setOpen] = React.useState(false)
			const [tab, setTab] = React.useState('call')
			const [calling, setCalling] = React.useState(false)
			const [transcript, setTranscript] = React.useState('')
			const [partial, setPartial] = React.useState('')
			const [msgs, setMsgs] = React.useState([])
			const [tasks, setTasks] = React.useState([])
			const [text, setText] = React.useState('')
			const [status, setStatus] = React.useState('空闲')
			const [busy, setBusy] = React.useState(false)
			const [drag, setDrag] = React.useState(null)
			const list = useSessions((s) => s)
			const sessionId = list?.current
			const refs = React.useRef({ ws: null, stream: null, actx: null, proc: null, recorder: null, chunks: [], settings, sessionId: null, since: 0, pollBusy: false })
			React.useEffect(() => { refs.current.settings = settings }, [settings])
			React.useEffect(() => {
				refs.current.sessionId = sessionId
				call(API.bindSession, { sessionId: sessionId || null }).catch(() => {})
			}, [sessionId])
			React.useEffect(() => { call(API.setPersona, { persona: settings.persona }).catch(() => {}) }, [settings.persona])
			React.useEffect(() => { call(API.taskList).then((r) => { if (r?.ok) setTasks(r.tasks || []) }).catch(() => {}) }, [open])
			React.useEffect(() => {
				if (!open) return
				const dispose = ctxRef.interval(() => {
					const r = refs.current
					if (r.pollBusy) return
					r.pollBusy = true
					call(API.pollEvents + '?since=' + r.since)
						.then((res) => {
							if (res?.ok && res.events?.length) {
								r.since = res.events[res.events.length - 1].seq
								const s = r.settings
								for (const ev of res.events) {
									if (ev.kind === 'reply') {
										setMsgs((m) => [...m.slice(-19), { role: 'assistant', text: ev.text }])
										if (s.ttsEnabled) {
											call(API.tts, { text: ev.text, config: ttsConfig(s) })
												.then((t) => { if (t?.ok && t.audio) playAudio(t.audio, t.mime || 'audio/mpeg', t.truncated) })
												.catch(() => {})
										}
									} else if (ev.kind === 'task') {
										call(API.taskList).then((r2) => { if (r2?.ok) setTasks(r2.tasks || []) }).catch(() => {})
									}
								}
							}
						})
						.catch(() => {})
						.finally(() => { r.pollBusy = false })
				}, 1000)
				return dispose
			}, [open])
			const ttsConfig = (s) => ({ provider: s.ttsProvider, apiKey: s.ttsKey, groupId: s.ttsGroupId, voice: s.ttsVoice, speed: s.ttsSpeed, maxChars: s.ttsMaxChars, baseUrl: s.ttsBase })
			const playAudio = (b64, mime, truncated) => {
				try {
					const a = new window.Audio('data:' + mime + ';base64,' + b64)
					a.play().catch(() => {})
					if (truncated) setMsgs((m) => [...m, { role: 'notice', text: '⚠ 语音回复超过最大字数，已截断' }])
				} catch {}
			}
			const connectFunasr = () => new Promise((resolve, reject) => {
				const s = refs.current.settings
				const ws = new window.WebSocket(s.asrUrl)
				const cancelTimeout = ctxRef.timeout(() => { try { ws.close() } catch {}; reject(new Error('FunASR 连接超时')) }, 8000)
				ws.onopen = () => {
					cancelTimeout()
					ws.send(JSON.stringify({ mode: '2pass', chunk_size: [5, 10, 5], wav_name: 'va', is_speaking: true, itn: true, hotword: '' }))
					refs.current.ws = ws
					setStatus('识别中…')
					resolve()
				}
				ws.onerror = () => { cancelTimeout(); reject(new Error('FunASR 连接失败（' + s.asrUrl + '）。若使用的是新版 FunASR Server（HTTP /v1），请在设置中切换为「FunASR Server HTTP」模式')) }
				ws.onmessage = (ev) => {
					try {
						const d = JSON.parse(ev.data)
						const t = d.text || ''
						if (d.mode === '2pass-online') { setPartial(t); if (t) setTranscript(t) }
						else if (d.mode === '2pass-offline') {
							setTranscript(t)
							if (t && refs.current.settings.autoSend) sendText(t)
						}
					} catch {}
				}
				ws.onclose = () => { if (refs.current.ws === ws) refs.current.ws = null }
			})
			const startRecorder = async () => {
				const stream = await window.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
				const rec = new window.MediaRecorder(stream)
				refs.current.stream = stream
				refs.current.recorder = rec
				refs.current.chunks = []
				rec.ondataavailable = (ev) => { if (ev.data.size) refs.current.chunks.push(ev.data) }
				rec.start(250)
			}
			const uploadAndAsr = async (s) => {
				const r = refs.current
				const rec = r.recorder
				if (!rec) return
				r.recorder = null
				await new Promise((res) => {
					rec.onstop = res
					try { rec.stop() } catch { res() }
				})
				const blob = new window.Blob(r.chunks, { type: 'audio/webm' })
				r.chunks = []
				if (blob.size === 0) return
				setStatus('识别中…')
				const ab = await blob.arrayBuffer()
				const bytes = new Uint8Array(ab)
				let bin = ''
				for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
				const b64 = window.btoa(bin)
				setBusy(true)
				try {
					const isFunasrHttp = s.asrMode === 'funasr-http'
					const config = isFunasrHttp
						? { baseUrl: s.funasrHttpBase, apiKey: s.funasrHttpKey, model: s.funasrHttpModel || '' }
						: { baseUrl: s.cloudAsrBase, apiKey: s.cloudAsrKey, model: s.cloudAsrModel || 'whisper-1' }
					const res2 = await call(API.cloudAsr, { audioBase64: b64, mime: 'audio/webm', ext: 'webm', config })
					if (res2?.ok && res2.text) {
						setTranscript(res2.text)
						if (s.autoSend) sendText(res2.text)
					} else setStatus('识别失败: ' + (res2?.error || '未知错误'))
				} finally { setBusy(false) }
			}
			const startMic = async () => {
				const s = refs.current.settings
				if (s.asrMode === 'funasr') {
					await connectFunasr()
					const stream = await window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })
					const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
					const src = actx.createMediaStreamSource(stream)
					const proc = actx.createScriptProcessor(4096, 1, 1)
					proc.onaudioprocess = (ev) => {
						const ws = refs.current.ws
						if (!ws || ws.readyState !== 1) return
						const input = ev.inputBuffer.getChannelData(0)
						const buf = new Int16Array(input.length)
						for (let i = 0; i < input.length; i++) { const v = Math.max(-1, Math.min(1, input[i])); buf[i] = v < 0 ? v * 0x8000 : v * 0x7FFF }
						ws.send(buf.buffer)
					}
					refs.current.actx = actx
					refs.current.proc = proc
					refs.current.stream = stream
					src.connect(proc)
					proc.connect(actx.destination)
					setTranscript('')
					setPartial('')
					return
				}
				await startRecorder()
				setStatus('录音中…（停止后识别）')
			}
			const stopMic = async () => {
				const r = refs.current
				if (r.ws) { try { r.ws.send(JSON.stringify({ is_speaking: false })); r.ws.close() } catch {} r.ws = null }
				if (r.proc) { try { r.proc.disconnect() } catch {} r.proc = null }
				if (r.actx) { try { r.actx.close() } catch {} r.actx = null }
				if (r.stream) { r.stream.getTracks().forEach((t) => t.stop()); r.stream = null }
				if (r.recorder) {
					await uploadAndAsr(refs.current.settings)
				}
				setStatus('空闲')
			}
			const sendText = (t) => {
				const text0 = (t || '').trim()
				if (!text0) return
				setMsgs((m) => [...m.slice(-19), { role: 'user', text: text0 }])
				call(API.sendText, { sessionId: refs.current.sessionId, text: text0 }).catch(() => {})
			}
			const toggleCall = async () => {
				if (calling) { setCalling(false); setStatus('结束通话…'); await stopMic(); setStatus('空闲'); return }
				setBusy(true)
				try {
					await startMic()
					setCalling(true)
				} catch (err) {
					setStatus('启动失败: ' + (err?.message || String(err)))
					await stopMic()
				} finally { setBusy(false) }
			}
			const createTask = (title, prompt) => {
				setBusy(true)
				call(API.createTask, { parentSessionId: refs.current.sessionId, title, prompt })
					.then((r) => {
						if (r?.ok) { call(API.taskList).then((r2) => { if (r2?.ok) setTasks(r2.tasks || []) }).catch(() => {}) }
						else setStatus('创建任务失败: ' + (r?.error || ''))
					})
					.catch(() => setStatus('创建任务失败'))
					.finally(() => setBusy(false))
			}
			const [taskTitle, setTaskTitle] = React.useState('')
			const [taskPrompt, setTaskPrompt] = React.useState('')
			const set = (k, v) => setSettings((s) => { const n = { ...s, [k]: v }; saveSettings(n); return n })
			const dragHandlers = {
				onPointerDown: (ev) => { if (open) return; setDrag({ sx: ev.clientX, sy: ev.clientY, ox: settings.pos.x < 0 ? window.innerWidth - 84 : settings.pos.x, oy: settings.pos.y < 0 ? window.innerHeight - 110 : settings.pos.y }); ev.currentTarget.setPointerCapture(ev.pointerId) },
				onPointerMove: (ev) => { if (!drag) return; const nx = Math.max(0, Math.min(window.innerWidth - 60, drag.ox + ev.clientX - drag.sx)); const ny = Math.max(0, Math.min(window.innerHeight - 60, drag.oy + ev.clientY - drag.sy)); set('pos', { x: nx, y: ny }) },
				onPointerUp: () => setDrag(null),
			}
			const pos = settings.pos.x < 0 ? { right: 24, bottom: 24 } : { left: settings.pos.x, top: settings.pos.y }
			const panelPos = settings.pos.x < 0 ? { right: 24, bottom: 88 } : { left: Math.min(settings.pos.x, window.innerWidth - 440), top: Math.min(settings.pos.y, window.innerHeight - 580) }
			return e(Fragment, null,
				e('button', { className: 'va-fab' + (calling ? ' on' : ''), style: pos, ...dragHandlers, title: '语音通话助手', onClick: () => setOpen(!open) }, calling ? '🔴' : '🎙'),
				open ? e('div', { className: 'va-panel', style: panelPos },
					e('div', { className: 'va-head' },
						e('span', { className: 'va-title' }, '📞 语音助手 · ' + sessionTitle(list, sessionId)),
						e('button', { className: 'va-tab' + (tab === 'call' ? ' on' : ''), onClick: () => setTab('call') }, '通话'),
						e('button', { className: 'va-tab' + (tab === 'tasks' ? ' on' : ''), onClick: () => setTab('tasks') }, '任务'),
						e('button', { className: 'va-tab' + (tab === 'settings' ? ' on' : ''), onClick: () => setTab('settings') }, '设置'),
						e('button', { className: 'va-x', onClick: () => { if (calling) toggleCall(); setOpen(false) } }, '✕'),
					),
					e('div', { className: 'va-body' },
						tab === 'call' ? e(Fragment, null,
							e('div', { className: 'va-status' },
								e('span', { className: 'va-dot' + (calling ? ' live' : '') }),
								e('span', null, status),
								e('span', null, '会话: ' + (sessionId || '无')),
							),
							e('div', { className: 'va-row' },
								e('button', { className: 'va-btn' + (calling ? ' danger' : ''), disabled: busy, onClick: toggleCall }, calling ? '⏹ 结束通话' : '▶ 开始通话'),
								e('button', { className: 'va-btn ghost', disabled: busy || !transcript, onClick: () => { if (transcript) sendText(transcript) } }, '📨 发送转写'),
							),
							e('div', { className: 'va-transcript' }, (transcript || partial || '（说点什么…）') + (partial && partial !== transcript ? ' ▍' : '')),
							e('div', { className: 'va-sendwrap' },
								e('input', { className: 'va-input', placeholder: '文字输入（通话时也可输入）…', value: text, onChange: (ev) => setText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { sendText(text); setText('') } } }),
								e('button', { className: 'va-btn', onClick: () => { sendText(text); setText('') } }, '发送'),
							),
							msgs.length ? e('div', null, msgs.map((m, i) => e('div', { key: i, className: 'va-msg ' + (m.role === 'user' ? 'user' : '') },
								e('span', { className: 'va-tag' }, m.role === 'user' ? '我' : m.role === 'assistant' ? '助手' : '提示'), m.text)))
							: e('div', { className: 'va-hint' }, '点击「开始通话」后说话，停止后识别文本自动发送；助手回复可语音朗读。'),
						) : tab === 'tasks' ? e(Fragment, null,
							e('div', { className: 'va-set' },
								e('label', null, '任务标题'),
								e('input', { className: 'va-input', value: taskTitle, onChange: (ev) => setTaskTitle(ev.target.value), placeholder: '例如：整理周报' }),
								e('label', null, '任务指令（独立子代理会话执行）'),
								e('textarea', { className: 'va-input', style: { minHeight: 64, resize: 'vertical' }, value: taskPrompt, onChange: (ev) => setTaskPrompt(ev.target.value), placeholder: '详细描述任务…' }),
								e('button', { className: 'va-btn', disabled: busy || !taskPrompt.trim(), onClick: () => { createTask(taskTitle, taskPrompt); setTaskTitle(''); setTaskPrompt('') } }, '📤 分发任务'),
							),
							tasks.length ? tasks.map((t) => e('div', { key: t.taskId, className: 'va-task' },
								e('div', { className: 'va-t' },
									e('strong', null, t.title),
									e('span', { className: 'va-badge ' + t.status }, t.status === 'running' ? '执行中' : t.status === 'completed' ? '已完成' : t.status === 'error' ? '出错' : '等待'),
								),
								e('div', { className: 'va-hint' }, (t.result || t.progress || '（暂无进度）').slice(0, 300)),
								e('div', { className: 'va-hint' }, '创建于 ' + new Date(t.createdAt).toLocaleString()),
							)) : e('div', { className: 'va-hint' }, '暂无任务。分发任务后，任务在独立子代理会话中执行，主会话可随时查看进度与结果。'),
						) : e(Fragment, null,
							e('div', { className: 'va-set' },
								e('label', null, '语音识别引擎'),
								e('select', { className: 'va-select', value: settings.asrMode, onChange: (ev) => set('asrMode', ev.target.value) },
									e('option', { value: 'funasr-http' }, 'FunASR Server HTTP（新版 v1.x，默认）'),
									e('option', { value: 'funasr' }, 'FunASR 流式 ws://（旧版 runtime 2pass）'),
									e('option', { value: 'cloud' }, '云端 API（OpenAI 兼容）'),
								),
								settings.asrMode === 'funasr-http' ? e(Fragment, null,
									e('input', { className: 'va-input', value: settings.funasrHttpBase, onChange: (ev) => set('funasrHttpBase', ev.target.value), placeholder: 'http://127.0.0.1:10095/v1/audio/transcriptions' }),
									e('input', { className: 'va-input', type: 'password', value: settings.funasrHttpKey, onChange: (ev) => set('funasrHttpKey', ev.target.value), placeholder: 'API Key（本地服务可留空）' }),
									e('input', { className: 'va-input', value: settings.funasrHttpModel, onChange: (ev) => set('funasrHttpModel', ev.target.value), placeholder: '模型名（留空用服务默认）' }),
								) : settings.asrMode === 'funasr' ? e('input', { className: 'va-input', value: settings.asrUrl, onChange: (ev) => set('asrUrl', ev.target.value), placeholder: 'ws://127.0.0.1:10095' }) : e(Fragment, null,
									e('input', { className: 'va-input', value: settings.cloudAsrBase, onChange: (ev) => set('cloudAsrBase', ev.target.value), placeholder: 'https://api.openai.com/v1/audio/transcriptions' }),
									e('input', { className: 'va-input', type: 'password', value: settings.cloudAsrKey, onChange: (ev) => set('cloudAsrKey', ev.target.value), placeholder: 'API Key' }),
									e('input', { className: 'va-input', value: settings.cloudAsrModel, onChange: (ev) => set('cloudAsrModel', ev.target.value), placeholder: 'whisper-1' }),
								),
							),
							e('div', { className: 'va-set' },
								e('label', null, '语音回复（TTS）'),
								e('div', { className: 'va-row' },
									e('label', { style: { flex: 1 } }, e('input', { type: 'checkbox', checked: settings.ttsEnabled, onChange: (ev) => set('ttsEnabled', ev.target.checked) }), ' 开启语音回复'),
								),
								e('select', { className: 'va-select', value: settings.ttsProvider, onChange: (ev) => set('ttsProvider', ev.target.value) },
									e('option', { value: 'minimax' }, 'MiniMax TTS'),
									e('option', { value: 'openai' }, 'OpenAI 兼容 TTS'),
								),
								settings.ttsProvider === 'minimax' ? e(Fragment, null,
									e('input', { className: 'va-input', type: 'password', value: settings.ttsKey, onChange: (ev) => set('ttsKey', ev.target.value), placeholder: 'MiniMax API Key' }),
									e('input', { className: 'va-input', value: settings.ttsGroupId, onChange: (ev) => set('ttsGroupId', ev.target.value), placeholder: 'GroupId' }),
								) : e(Fragment, null,
									e('input', { className: 'va-input', value: settings.ttsBase, onChange: (ev) => set('ttsBase', ev.target.value), placeholder: 'https://api.openai.com/v1/audio/speech' }),
									e('input', { className: 'va-input', type: 'password', value: settings.ttsKey, onChange: (ev) => set('ttsKey', ev.target.value), placeholder: 'API Key' }),
								),
								e('div', { className: 'va-row' },
									e('input', { className: 'va-input', value: settings.ttsVoice, onChange: (ev) => set('ttsVoice', ev.target.value), placeholder: '音色 voice_id（留空用默认）' }),
									e('input', { className: 'va-input', style: { maxWidth: 90 }, type: 'number', step: '0.1', min: '0.5', max: '2', value: settings.ttsSpeed, onChange: (ev) => set('ttsSpeed', Number(ev.target.value) || 1) }),
									e('span', { className: 'va-hint' }, '语速'),
								),
								e('div', { className: 'va-row' },
									e('input', { className: 'va-input', type: 'number', min: '10', value: settings.ttsMaxChars, onChange: (ev) => set('ttsMaxChars', Number(ev.target.value) || 300) }),
									e('span', { className: 'va-hint' }, '最大字数（超出截断）'),
								),
							),
							e('div', { className: 'va-set' },
								e('label', null, '人格（留空用默认人格）'),
								e('textarea', { className: 'va-input', style: { minHeight: 64, resize: 'vertical' }, value: settings.persona, onChange: (ev) => set('persona', ev.target.value), placeholder: '例如：你是一位温柔耐心的语音助手…' }),
							),
							e('div', { className: 'va-set' },
								e('label', null, '其他'),
								e('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, e('input', { type: 'checkbox', checked: settings.autoSend, onChange: (ev) => set('autoSend', ev.target.checked) }), '识别到文本自动发送'),
								e('div', { className: 'va-hint' }, '设置保存在本机浏览器（localStorage）。FunASR Server 新版默认无需 API Key。'),
							),
						),
					),
				) : null,
			)
		}
		function apply(ctx) {
			ctxRef = ctx
			const styleDisposer = (() => {
				const tag = document.createElement('style')
				tag.dataset.dyn = '@linxin666/dsh-voice-call'
				tag.textContent = STYLE
				document.head.append(tag)
				return () => tag.remove()
			})()
			const slots = ctx.get('slots')
			let slotDisposer = () => {}
			if (slots !== undefined) {
				slotDisposer = slots.inject('shell.overlay', () => slots.register(
					{ name: 'shell.overlay', id: 'voice-call-assistant' },
					(props) => React.createElement(Fab, props),
				))
			}
			ctx.effect(() => () => {
				styleDisposer()
				slotDisposer()
			}, 'voice-call: ui mounts')
		}
		exports.apply = apply
		exports.inject = inject
		return module.exports
	}
})
