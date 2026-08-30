window.__ModuleLoader__.load({
	id: "@biliye/dsh-voice-call",
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
			ensure: "/api/voice-call/ensure",
			setPersona: "/api/voice-call/persona",
			viewing: "/api/voice-call/viewing",
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
			ttsMinimaxBase: 'https://api.minimax.chat/v1/t2a_v2',
			ttsKey: '',
			ttsGroupId: '',
			ttsVoice: '',
			ttsSpeed: 1,
			ttsMaxChars: 300,
			persona: '',
			autoSend: true,
			announceOtherDone: true,
			wakeMode: false,
			wakeWord: '小鲸鱼',
			sleepAfterMs: 8000,
			vadEnabled: true,
			vadSilenceMs: 1200,
			vadRms: 0.02,
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
.va-badge.failed { background: #d6303155; color: #ff7675; }
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
			const [otherDones, setOtherDones] = React.useState([])
			const [text, setText] = React.useState('')
			const [status, setStatus] = React.useState('空闲')
			const [wake, setWake] = React.useState('asleep')
			const [busy, setBusy] = React.useState(false)
			const [drag, setDrag] = React.useState(null)
			const [dedicated, setDedicated] = React.useState(null)
			const list = useSessions((s) => s)
			// 语音通话始终绑定专属会话（由 Host 保证固定 ID，跨重启保持同一会话）
			const sessionId = dedicated?.voiceSessionId || null
			const refs = React.useRef({ ws: null, stream: null, actx: null, proc: null, recorder: null, chunks: [], settings, sessionId: null, since: (() => { try { return Number(window.localStorage.getItem('dsh.voiceCall.since.v1')) || 0 } catch { return 0 } })(), pollBusy: false, vad: null, vadBusy: false, ttsUntil: 0, pendingPcm: [], audioQueue: [], audioBusy: false, suppressClick: false, lastStreamText: '', lastStreamAt: 0, wake: 'asleep', sleepTimer: null })
			React.useEffect(() => { refs.current.settings = settings }, [settings])
			React.useEffect(() => { refs.current.list = list }, [list])
			React.useEffect(() => {
				refs.current.sessionId = sessionId
				call(API.bindSession, { sessionId: sessionId || null }).catch(() => {})
			}, [sessionId])
			// 上报 GUI 当前查看的会话：该会话完成任务时不播报（用户正在看）
			React.useEffect(() => {
				const cur = list?.current || null
				if (cur) call(API.viewing, { sessionId: cur }).catch(() => {})
			}, [list?.current])
			// 拉取专属工作区/会话状态；未就绪时每 2 秒轮询直到就绪
			React.useEffect(() => {
				let disposed = false
				const refresh = () => call(API.getState)
					.then((r) => {
						if (!r?.ok || disposed) return
						setDedicated({ ready: !!r.ready, voiceSessionId: r.voiceSessionId || null, workspaceId: r.workspaceId || null, workspaceTitle: r.workspaceTitle || '' })
						if (r.otherDones?.length) setOtherDones((d) => [...r.otherDones, ...d].filter((x, i, arr) => arr.findIndex((y) => y.sessionId === x.sessionId && y.time === x.time) === i).slice(0, 20))
					})
					.catch(() => {})
				refresh()
				if (dedicated?.ready) return undefined
				const iv = ctxRef.interval(refresh, 2000)
				return () => { disposed = true; iv() }
			}, [dedicated?.ready])
			// 专属会话就绪提示（每页只提示一次）
			const noticeShown = React.useRef(false)
			React.useEffect(() => {
				if (dedicated?.ready && !noticeShown.current) {
					noticeShown.current = true
					setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '✅ 专属工作区「' + (dedicated.workspaceTitle || '语音通话') + '」与专属会话已就绪：所有语音通话保存在该会话，本体重启后保持同一会话；耗时任务自动分发给其他会话执行。' }])
				}
			}, [dedicated])
			React.useEffect(() => { call(API.setPersona, { persona: settings.persona }).catch(() => {}) }, [settings.persona])
			React.useEffect(() => {
				call(API.taskList).then((r) => { if (r?.ok) setTasks(r.tasks || []) }).catch(() => {})
				// 打开面板时刷新会话/工作区基线，确保专属工作区与会话出现在侧边栏
				try { ctxRef.get('sessions')?.refresh?.().catch?.(() => {}) } catch {}
				try { ctxRef.get('workspaces')?.refresh?.().catch?.(() => {}) } catch {}
			}, [open])
			React.useEffect(() => {
				const dispose = ctxRef.interval(() => {
					const r = refs.current
					if (r.pollBusy) return
					r.pollBusy = true
					call(API.pollEvents + '?since=' + r.since)
						.then((res) => {
							if (res?.ok && res.events?.length) {
								r.since = res.events[res.events.length - 1].seq
								try { window.localStorage.setItem('dsh.voiceCall.since.v1', String(r.since)) } catch {}
								const s = r.settings
								for (const ev of res.events) {
									if (ev.kind === 'reply') {
										setMsgs((m) => [...m.slice(-19), { role: 'assistant', text: ev.text }])
										if (s.ttsEnabled) {
											// 播报前压缩：先取第一句（到句末标点），最长不超过 100 字，避免长篇朗读
											const speak = briefForTts(ev.text, Math.min(Number(s.ttsMaxChars) || 300, 100))
											setStatus('回复中…')
											const estMs = Math.max(2500, (speak || '').length * 160 + 1500)
											const base = effectiveBase(s)
											const urlErr = urlProblem(base)
											if (urlErr) {
												refs.current.ttsUntil = 0
												setStatus('语音回复失败: ' + urlErr)
												setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ TTS 地址不安全: ' + urlErr + '（请在设置页修改）' }])
											} else if (!speak) {
												refs.current.ttsUntil = 0
												setStatus('聆听中…')
											} else {
												call(API.tts, { text: speak, config: ttsConfig(s) })
													.then((t) => {
														if (t?.ok && t.audio) playAudio(t.audio, t.mime || 'audio/mpeg', t.truncated, estMs)
														else {
															refs.current.ttsUntil = 0
															const err = String(t?.error || '未知错误').slice(0, 200)
															setStatus('语音回复失败: ' + err)
															setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 语音回复失败: ' + err + '（请在设置页检查 TTS 提供商 / Key / GroupId）' }])
														}
													})
													.catch((e) => { refs.current.ttsUntil = 0; setStatus('语音回复失败: ' + String(e?.message || e).slice(0, 120)) })
											}
										} else setStatus('聆听中…（语音回复已关闭，设置页可开启）')
									} else if (ev.kind === 'task') {
										call(API.taskList).then((r2) => { if (r2?.ok) setTasks(r2.tasks || []) }).catch(() => {})
									} else if (ev.kind === 'other-done') {
										const item = { sessionId: String(ev.sessionId || ''), text: String(ev.text || '').slice(0, 300), time: ev.time || Date.now() }
										setOtherDones((d) => [item, ...d.filter((x) => !(x.sessionId === item.sessionId && x.time === item.time))].slice(0, 20))
										// 简要语音播报（可关闭）；只播报 2 分钟内的事件，避免刷新页面后重播旧记录
										if (s.announceOtherDone !== false && item.text && Date.now() - item.time < 120000) {
											const title = sessionTitle(r.list, item.sessionId)
											const announceText = '「' + title + '」完成任务：' + briefForTts(item.text, 80)
											const base = effectiveBase(s)
											if (!urlProblem(base)) {
												call(API.tts, { text: announceText, config: ttsConfig(s) })
													.then((t) => { if (t?.ok && t.audio) playAudio(t.audio, t.mime || 'audio/mpeg', t.truncated, Math.max(3000, announceText.length * 160 + 1500)) })
													.catch(() => {})
											}
										}
									}
								}
							}
						})
						.catch(() => {})
						.finally(() => { r.pollBusy = false })
				}, 1000)
				return dispose
			}, [])
			// 仅允许 https 或本机 http 地址，防止 API Key 通过明文/任意地址外发
			const urlProblem = (u) => {
				try {
					const url = new URL(String(u || '').trim())
					if (url.protocol === 'https:') return ''
					if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) return ''
					return '仅支持 https:// 或本机 http:// 地址'
				} catch { return 'URL 无效' }
			}
			// 有效地址原样返回；空/无效地址回退到提供商默认域名（与 Host 端一致），
			// 仅对「明确填写的非 https 且非本机地址」保留安全拦截
			const effectiveBase = (s) => {
				const raw = String((s.ttsProvider === 'minimax' ? s.ttsMinimaxBase : s.ttsBase) || '').trim()
				try { new URL(raw); return raw } catch { return s.ttsProvider === 'minimax' ? 'https://api.minimax.chat/v1/t2a_v2' : 'https://api.openai.com/v1/audio/speech' }
			}
			const ttsConfig = (s) => ({ provider: s.ttsProvider, apiKey: s.ttsKey, groupId: s.ttsGroupId, voice: s.ttsVoice, speed: s.ttsSpeed, maxChars: s.ttsMaxChars, baseUrl: effectiveBase(s) })
			// 播报前压缩：优先取第一句（到句末标点），整体不超过 maxChars；过短时按 maxChars 截断
			const briefForTts = (text, maxChars) => {
				const t = String(text || '').replace(/\s+/g, ' ').trim()
				if (!t || !(maxChars > 0)) return ''
				if (t.length <= maxChars) return t
				const m = t.match(/^.*?[。！？!?…]/)
				if (m && m[0].length > 10 && m[0].length <= maxChars) return m[0]
				return t.slice(0, maxChars) + '…'
			}
			// 用户手势内解锁浏览器自动播放（在「开始通话」点击时调用）
			const unlockAudio = () => {
				try {
					const AC = window.AudioContext || window.webkitAudioContext
					if (AC) {
						const actx = new AC()
						actx.resume().then(() => { setTimeout(() => { try { actx.close() } catch {} }, 800) }).catch(() => {})
					}
					const silent = new window.Audio()
					silent.volume = 0
					silent.play().catch(() => {})
				} catch {}
			}
			const playAudio = (b64, mime, truncated, estMs) => {
				if (truncated) setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 语音回复超过最大字数，已截断' }])
				refs.current.audioQueue.push({ b64, mime, estMs })
				nextAudio()
			}
			// 串行播放队列：同一时间只播一段，避免多条回复叠加；静音窗口优先用真实时长
			const nextAudio = () => {
				const r = refs.current
				if (r.audioBusy || !r.audioQueue.length) return
				const item = r.audioQueue.shift()
				r.audioBusy = true
				const estMs = item.estMs || 4000
				r.ttsUntil = Date.now() + estMs + 600
				setStatus('🔊 播放语音回复…')
				let a = null
				try { a = new window.Audio('data:' + item.mime + ';base64,' + item.b64) }
				catch (e) {
					r.audioBusy = false
					r.ttsUntil = 0
					setStatus('⚠ 播放异常: ' + String(e?.message || e))
					nextAudio()
					return
				}
				a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration) && a.duration > 0) r.ttsUntil = Date.now() + a.duration * 1000 + 600 })
				a.onended = () => { r.audioBusy = false; r.ttsUntil = 0; setStatus('聆听中…'); nextAudio() }
				a.onerror = () => {
					r.audioBusy = false
					r.ttsUntil = 0
					const code = a.error?.code
					const name = code === 4 ? '不支持的音频格式/解码失败' : code === 2 ? '网络错误' : '未知错误(' + (code ?? '?') + ')'
					setStatus('⚠ 音频播放失败: ' + name)
					setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 音频播放失败: ' + name }])
					nextAudio()
				}
				a.play()
					.then(() => setStatus('🔊 播放语音回复…'))
					.catch((err) => {
						r.audioBusy = false
						r.ttsUntil = 0
						const name = err?.name || 'Error'
						const hint = name === 'NotAllowedError' ? '（浏览器自动播放限制：请先点击页面任意位置，或刷新后先点「开始通话」）' : ''
						setStatus('⚠ 播放被拦截: ' + name + hint)
						setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 播放被拦截: ' + name + hint }])
						nextAudio()
					})
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
							const r = refs.current
							if (t && r.settings.autoSend) {
								const now = Date.now()
								// 同一文本在短时间内重复下发（边界刷新/结束时）只发送一次
								if (!(t === r.lastStreamText && now - r.lastStreamAt < 3000)) {
									r.lastStreamText = t
									r.lastStreamAt = now
									handleRecognizedText(t)
								}
							}
						}
					} catch {}
				}
				ws.onclose = () => { if (refs.current.ws === ws) refs.current.ws = null }
			})
			const encodeWav = (pcm) => {
				const n = pcm.length
				const buf = new ArrayBuffer(44 + n * 2)
				const dv = new DataView(buf)
				const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
				ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE')
				ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
				dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
				ws(36, 'data'); dv.setUint32(40, n * 2, true)
				new Int16Array(buf, 44).set(pcm)
				const bytes = new Uint8Array(buf)
				let bin = ''
				for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
				return window.btoa(bin)
			}
			const concatInt16 = (arrs) => {
				let total = 0
				for (const a of arrs) total += a.length
				const out = new Int16Array(total)
				let off = 0
				for (const a of arrs) { out.set(a, off); off += a.length }
				return out
			}
			const transcribePcm = async (pcm, s) => {
				const r = refs.current
				r.vadBusy = true
				setBusy(true)
				setStatus('识别中…')
				try {
					const wav = encodeWav(pcm)
					const isFunasrHttp = s.asrMode === 'funasr-http'
					const base = isFunasrHttp ? s.funasrHttpBase : s.cloudAsrBase
					const urlErr = urlProblem(base)
					if (urlErr) { setStatus('识别失败: ' + urlErr); return }
					const config = isFunasrHttp
						? { baseUrl: base, apiKey: s.funasrHttpKey, model: s.funasrHttpModel || 'fun-asr-nano' }
						: { baseUrl: base, apiKey: s.cloudAsrKey, model: s.cloudAsrModel || 'whisper-1' }
					const res2 = await call(API.cloudAsr, { audioBase64: wav, mime: 'audio/wav', ext: 'wav', config })
					if (res2?.ok && res2.text) {
						const stripped = String(res2.text).trim()
						if (stripped.length <= 1) {
							setTranscript('')
							setStatus('聆听中…')
							return
						}
						setTranscript(stripped)
						if (s.autoSend) {
							handleRecognizedText(stripped)
						} else setStatus('聆听中…')
					} else setStatus('识别失败: ' + (res2?.error || '未知错误'))
				} finally {
					setBusy(false)
					r.vadBusy = false
					if (r.pendingPcm.length) {
						const pp = r.pendingPcm.shift()
						await transcribePcm(pp, refs.current.settings)
					}
				}
			}
			const finalizeVadUtterance = async (vad) => {
				const r = refs.current
				if (!vad || vad.state !== 'speaking') return
				const pcm = concatInt16(vad.pcm)
				vad.state = 'idle'
				vad.pcm = []
				vad.silenceChunks = 0
				if (pcm.length / 16 < 200) { setStatus('聆听中…'); return }
				if (r.vadBusy) { r.pendingPcm.push(pcm); return }
				await transcribePcm(pcm, refs.current.settings)
			}
			const startVadMic = async () => {
				const s = refs.current.settings
				const stream = await window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })
				const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
				const src = actx.createMediaStreamSource(stream)
				const proc = actx.createScriptProcessor(2048, 1, 1)
				const vad = { state: 'idle', pcm: [], silenceChunks: 0 }
				refs.current.actx = actx
				refs.current.proc = proc
				refs.current.stream = stream
				refs.current.vad = vad
				const chunkMs = 2048 / 16000 * 1000
				proc.onaudioprocess = (ev) => {
					const r = refs.current
					const st = r.settings
					if (!r.vad) return
					if (Date.now() < r.ttsUntil) { r.vad.state = 'idle'; r.vad.pcm = []; r.vad.silenceChunks = 0; return }
					const input = ev.inputBuffer.getChannelData(0)
					let sum = 0
					for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
					const rms = Math.sqrt(sum / input.length)
					const thr = st.vadRms || 0.02
					const buf = new Int16Array(input.length)
					for (let i = 0; i < input.length; i++) { const v = Math.max(-1, Math.min(1, input[i])); buf[i] = v < 0 ? v * 0x8000 : v * 0x7FFF }
					if (rms > thr) {
						if (r.vad.state !== 'speaking') {
							r.vad.state = 'speaking'; r.vad.pcm = []; r.vad.silenceChunks = 0
							setStatus(r.wake === 'awake' ? '聆听中…（正在说话）' : '😴 休眠中…（正在说话）')
							if (r.wake === 'awake') scheduleSleep()
						}
						r.vad.pcm.push(buf)
						r.vad.silenceChunks = 0
					} else if (r.vad.state === 'speaking') {
						r.vad.pcm.push(buf)
						r.vad.silenceChunks++
						if (r.vad.silenceChunks * chunkMs >= (st.vadSilenceMs || 1200)) finalizeVadUtterance(r.vad)
					}
				}
				src.connect(proc)
				const silentGain = actx.createGain()
				silentGain.gain.value = 0
				proc.connect(silentGain)
				silentGain.connect(actx.destination)
				setTranscript('')
				setPartial('')
				setStatus('聆听中…（停顿自动识别发送）')
			}
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
				const mime = rec.mimeType || 'audio/webm'
				const blob = new window.Blob(r.chunks, { type: mime })
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
					const base = isFunasrHttp ? s.funasrHttpBase : s.cloudAsrBase
					const urlErr = urlProblem(base)
					if (urlErr) { setStatus('识别失败: ' + urlErr); return }
					const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm'
					const config = isFunasrHttp
						? { baseUrl: base, apiKey: s.funasrHttpKey, model: s.funasrHttpModel || 'fun-asr-nano' }
						: { baseUrl: base, apiKey: s.cloudAsrKey, model: s.cloudAsrModel || 'whisper-1' }
					const res2 = await call(API.cloudAsr, { audioBase64: b64, mime, ext, config })
					if (res2?.ok && res2.text) {
						setTranscript(res2.text)
						if (s.autoSend) handleRecognizedText(res2.text)
					} else setStatus('识别失败: ' + (res2?.error || '未知错误'))
				} finally { setBusy(false) }
			}
			const startMic = async () => {
				const s = refs.current.settings
				if (s.asrMode === 'funasr') {
					await connectFunasr()
					const ws = refs.current.ws
					const stream = await window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })
						.catch(async (e) => { try { if (ws) ws.close() } catch {}; throw e })
					const actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
					const src = actx.createMediaStreamSource(stream)
					const proc = actx.createScriptProcessor(4096, 1, 1)
					proc.onaudioprocess = (ev) => {
						const ws = refs.current.ws
						if (!ws || ws.readyState !== 1) return
						// TTS 播放期间静音，防止自听回声
						if (Date.now() < refs.current.ttsUntil) return
						const input = ev.inputBuffer.getChannelData(0)
						const buf = new Int16Array(input.length)
						for (let i = 0; i < input.length; i++) { const v = Math.max(-1, Math.min(1, input[i])); buf[i] = v < 0 ? v * 0x8000 : v * 0x7FFF }
						ws.send(buf.buffer)
					}
					refs.current.actx = actx
					refs.current.proc = proc
					refs.current.stream = stream
					src.connect(proc)
					const silentGain = actx.createGain()
					silentGain.gain.value = 0
					proc.connect(silentGain)
					silentGain.connect(actx.destination)
					setTranscript('')
					setPartial('')
					refs.current.lastStreamText = ''
					refs.current.lastStreamAt = 0
				} else if (s.vadEnabled !== false) {
					await startVadMic()
				} else {
					await startRecorder()
					setStatus('录音中…（停止后识别）')
				}
				// 唤醒词模式：开始时处于休眠状态，只有听到唤醒词才唤醒对话
				if (s.wakeMode) {
					const ww = String(s.wakeWord || '').trim() || '小鲸鱼'
					refs.current.wake = 'asleep'
					setWake('asleep')
					clearSleepTimer()
					setStatus('😴 休眠中…（说出唤醒词「' + ww + '」唤醒）')
					if (s.asrMode === 'cloud') {
						setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '💡 唤醒词模式建议使用本地部署的 ASR（如本机 FunASR Server）进行语音识别：语音不出本机、延迟低，唤醒更可靠；云端 ASR 会把每段语音上传，唤醒响应也受网络影响。可在设置页切换。' }])
					}
				}
			}
			const stopMic = async () => {
				const r = refs.current
				if (r.vad && r.vad.state === 'speaking') {
					const pcm = concatInt16(r.vad.pcm)
					r.vad.state = 'idle'
					r.vad.pcm = []
					r.vad.silenceChunks = 0
					if (pcm.length / 16 >= 200) {
						if (r.vadBusy) r.pendingPcm.push(pcm)
						else await transcribePcm(pcm, refs.current.settings)
					}
				}
				// 不要清空 pendingPcm：在途识别链会按序消化，清空会丢掉停止时的最后一句
				if (r.ws) {
					try {
						r.ws.send(JSON.stringify({ is_speaking: false }))
						// 等一拍再关闭，避免最终识别帧被连接关闭丢掉
						await new Promise((res) => ctxRef.timeout(res, 250))
						r.ws.close()
					} catch {}
					r.ws = null
				}
				if (r.proc) { try { r.proc.disconnect() } catch {} r.proc = null }
				if (r.actx) { try { r.actx.close() } catch {} r.actx = null }
				r.vad = null
				if (r.recorder) {
					await uploadAndAsr(refs.current.settings)
				}
				if (r.stream) { r.stream.getTracks().forEach((t) => t.stop()); r.stream = null }
				clearSleepTimer()
				refs.current.wake = 'asleep'
				setWake('asleep')
				setStatus('空闲')
			}
			const sendText = (t) => {
				const text0 = (t || '').trim()
				if (!text0) return
				setMsgs((m) => [...m.slice(-19), { role: 'user', text: text0 }])
				call(API.sendText, { sessionId: refs.current.sessionId, text: text0 })
					.then((r) => {
						if (!r?.ok) {
							const err = String(r?.error || '未知错误')
							setStatus('发送失败: ' + err)
							setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 消息发送失败: ' + err }])
						}
					})
					.catch((e) => {
						const err = String(e?.message || e)
						setStatus('发送失败: ' + err)
						setMsgs((m) => [...m.slice(-19), { role: 'notice', text: '⚠ 消息发送失败: ' + err }])
					})
			}
			// ===== 唤醒词通话模式 =====
			const normWakeText = (t) => String(t || '').replace(/[，。！？、,.!?…\s]+/g, '')
			const cleanWakeRest = (s) => String(s || '').replace(/^[，。！？、,.!?…\s]+|[，。！？、,.!?…\s]+$/g, '').trim()
			// 在原始文本中定位唤醒词（容忍标点/空格插入），返回去除唤醒词后的指令内容；未命中返回 null
			const matchWakeWord = (raw, ww) => {
				const t = String(raw || '')
				const word = String(ww || '').trim()
				if (!t || !word) return null
				const i = t.indexOf(word)
				if (i >= 0) return { rest: cleanWakeRest(t.slice(0, i) + t.slice(i + word.length)) }
				const tn = normWakeText(t)
				const wn = normWakeText(word)
				const p = tn.indexOf(wn)
				if (p < 0) return null
				let start = -1, end = -1, k = 0
				for (let j = 0; j < t.length; j++) {
					if (/[，。！？、,.!?…\s]/.test(t[j])) continue
					if (k === p) start = j
					if (k === p + wn.length - 1) { end = j; break }
					k++
				}
				if (start < 0 || end < 0 || end < start) return null
				return { rest: cleanWakeRest(t.slice(0, start) + t.slice(end + 1)) }
			}
			const clearSleepTimer = () => {
				const r = refs.current
				if (r.sleepTimer) { try { r.sleepTimer() } catch {} r.sleepTimer = null }
			}
			// 沉默超过设定时间（从最后一次说话/发送算起）后休眠；语音回复播放期间顺延
			const scheduleSleep = () => {
				const r = refs.current
				clearSleepTimer()
				const s = r.settings
				const sleepMs = Math.max(1000, Number(s.sleepAfterMs) || 8000)
				const doSleep = () => {
					const r2 = refs.current
					r2.sleepTimer = null
					if (Date.now() < r2.ttsUntil) {
						r2.sleepTimer = ctxRef.timeout(doSleep, Math.max(500, r2.ttsUntil - Date.now()))
						return
					}
					if (r2.wake !== 'asleep') {
						r2.wake = 'asleep'
						setWake('asleep')
						setStatus('😴 休眠中…（说出唤醒词「' + (r2.settings.wakeWord || '小鲸鱼') + '」唤醒）')
					}
				}
				r.sleepTimer = ctxRef.timeout(doSleep, sleepMs)
			}
			// 唤醒：仅唤醒词 → 本地回应「我在」；唤醒词后带指令 → 去掉唤醒词直接发送
			const wakeUp = (rest) => {
				const r = refs.current
				const s = r.settings
				r.wake = 'awake'
				setWake('awake')
				if (rest) {
					sendText(rest)
					setStatus('🔔 已唤醒，思考中…')
				} else {
					setMsgs((m) => [...m.slice(-19), { role: 'assistant', text: '我在' }])
					setStatus('🔔 已唤醒，聆听中…')
					if (s.ttsEnabled) {
						const base = effectiveBase(s)
						if (!urlProblem(base)) {
							call(API.tts, { text: '我在', config: ttsConfig(s) })
								.then((t) => { if (t?.ok && t.audio) playAudio(t.audio, t.mime || 'audio/mpeg', t.truncated, 2500) })
								.catch(() => {})
						}
					}
				}
				scheduleSleep()
			}
			// 语音识别结果的统一入口：唤醒词模式下，休眠时只有命中唤醒词才唤醒对话，否则忽略
			const handleRecognizedText = (text) => {
				const r = refs.current
				const s = r.settings
				const t = String(text || '').trim()
				if (!t) return
				if (!s.wakeMode) { sendText(t); setStatus('思考中…'); return }
				const ww = String(s.wakeWord || '').trim() || '小鲸鱼'
				if (r.wake === 'awake') {
					sendText(t)
					setStatus('思考中…')
					scheduleSleep()
					return
				}
				const m = matchWakeWord(t, ww)
				if (m) {
					wakeUp(m.rest)
				} else {
					setStatus('😴 休眠中…（未检测到唤醒词「' + ww + '」，已忽略）')
				}
			}
			const toggleCall = async () => {
				if (calling) { setCalling(false); setStatus('结束通话…'); await stopMic(); setStatus('空闲'); return }
				unlockAudio()
				setBusy(true)
				try {
					await startMic()
					setCalling(true)
				} catch (err) {
					await stopMic()
					setStatus('启动失败: ' + (err?.message || String(err)))
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
				onPointerUp: (ev) => { if (drag) { const moved = Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy); if (moved > 5) refs.current.suppressClick = true } setDrag(null) },
			}
			const pos = settings.pos.x < 0 ? { right: 24, bottom: 24 } : { left: settings.pos.x, top: settings.pos.y }
			const panelPos = settings.pos.x < 0 ? { right: 24, bottom: 88 } : { left: Math.max(0, Math.min(settings.pos.x, window.innerWidth - 440)), top: Math.max(0, Math.min(settings.pos.y, window.innerHeight - 580)) }
			return e(Fragment, null,
				e('button', { className: 'va-fab' + (calling ? ' on' : ''), style: pos, ...dragHandlers, title: '语音通话助手', onClick: () => { if (refs.current.suppressClick) { refs.current.suppressClick = false; return } setOpen(!open) } }, calling ? '🔴' : '🎙'),
				open ? e('div', { className: 'va-panel', style: panelPos },
					e('div', { className: 'va-head' },
						e('span', { className: 'va-title' }, '📞 语音助手 · ' + (sessionId ? sessionTitle(list, sessionId) : '专属会话')),
						e('button', { className: 'va-tab' + (tab === 'call' ? ' on' : ''), onClick: () => setTab('call') }, '通话'),
						e('button', { className: 'va-tab' + (tab === 'tasks' ? ' on' : ''), onClick: () => setTab('tasks') }, '任务'),
						e('button', { className: 'va-tab' + (tab === 'activity' ? ' on' : ''), onClick: () => setTab('activity') }, '动态'),
						e('button', { className: 'va-tab' + (tab === 'settings' ? ' on' : ''), onClick: () => setTab('settings') }, '设置'),
						e('button', { className: 'va-x', onClick: () => { if (calling) toggleCall(); setOpen(false) } }, '✕'),
					),
					e('div', { className: 'va-body' },
						tab === 'call' ? e(Fragment, null,
							e('div', { className: 'va-status' },
								e('span', { className: 'va-dot' + (calling ? ' live' : '') }),
								e('span', null, status),
								settings.wakeMode && calling ? e('span', { className: 'va-badge ' + (wake === 'awake' ? 'completed' : 'pending') }, wake === 'awake' ? '🔔 已唤醒' : '😴 休眠中') : null,
								e('span', null, dedicated?.ready ? ('专属工作区: ' + (dedicated.workspaceTitle || '语音通话') + ' · 会话: ' + (sessionId || '无')) : '⏳ 正在创建专属工作区/会话…'),
							),
							e('div', { className: 'va-row' },
								e('button', { className: 'va-btn' + (calling ? ' danger' : ''), disabled: busy, onClick: toggleCall }, calling ? '⏹ 结束通话' : '▶ 开始通话'),
								e('button', { className: 'va-btn ghost', disabled: busy || !transcript, onClick: () => { if (transcript) sendText(transcript) } }, '📨 发送转写'),
								e('button', { className: 'va-btn ghost', disabled: !dedicated?.ready || !sessionId, onClick: () => { try { const svc = ctxRef.get('sessions'); if (svc) svc.open(sessionId) } catch {} } }, '📂 打开会话'),
							),
							e('div', { className: 'va-transcript' }, (transcript || partial || '（说点什么…）') + (partial && partial !== transcript ? ' ▍' : '')),
							e('div', { className: 'va-sendwrap' },
								e('input', { className: 'va-input', placeholder: '文字输入（通话时也可输入）…', value: text, onChange: (ev) => setText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { sendText(text); setText('') } } }),
								e('button', { className: 'va-btn', onClick: () => { sendText(text); setText('') } }, '发送'),
							),
							msgs.length ? e('div', null, msgs.map((m, i) => e('div', { key: i, className: 'va-msg ' + (m.role === 'user' ? 'user' : '') },
								e('span', { className: 'va-tag' }, m.role === 'user' ? '我' : m.role === 'assistant' ? '助手' : '提示'), m.text)))
							: e('div', { className: 'va-hint' }, '点击「开始通话」后直接说话，停顿 1.2 秒即自动识别发送并语音回复。所有语音内容保存在专属工作区「语音通话」的专属会话中，本体重启后保持同一会话；耗时任务自动分发给其他会话执行。' + (settings.wakeMode ? '\n🔔 已开启唤醒词模式：只有说出唤醒词「' + (settings.wakeWord || '小鲸鱼') + '」才开始对话（唤醒词后可直接跟指令），沉默超过设定时间自动休眠。建议使用本地部署的 ASR 进行语音识别。' : '')),
						) : tab === 'tasks' ? e(Fragment, null,
							e('div', { className: 'va-set' },
								e('label', null, '任务标题'),
								e('input', { className: 'va-input', value: taskTitle, onChange: (ev) => setTaskTitle(ev.target.value), placeholder: '例如：整理周报' }),
								e('label', null, '任务指令（在「语音通话」工作区任务会话中执行）'),
								e('textarea', { className: 'va-input', style: { minHeight: 64, resize: 'vertical' }, value: taskPrompt, onChange: (ev) => setTaskPrompt(ev.target.value), placeholder: '详细描述任务…' }),
								e('button', { className: 'va-btn', disabled: busy || !taskPrompt.trim(), onClick: () => { createTask(taskTitle, taskPrompt); setTaskTitle(''); setTaskPrompt('') } }, '📤 分发任务'),
							),
							tasks.length ? tasks.map((t) => e('div', { key: t.taskId, className: 'va-task' },
								e('div', { className: 'va-t' },
									e('strong', null, t.title + (t.rollovers ? '（续接 ' + t.rollovers + '）' : '')),
									e('span', { className: 'va-badge ' + t.status }, t.status === 'running' ? '执行中' : t.status === 'completed' ? '已完成' : (t.status === 'failed' || t.status === 'error') ? '失败' : '等待'),
								),
								e('div', { className: 'va-hint' }, (t.failReason ? '失败原因: ' + t.failReason + '\n' : '') + (t.result || t.progress || '（暂无进度）').slice(0, 300)),
								e('div', { className: 'va-row' },
									e('button', { className: 'va-btn ghost', onClick: () => { try { const svc = ctxRef.get('sessions'); if (svc) svc.open(t.sessionId || '') } catch {} } }, '📂 打开任务会话'),
									e('span', { className: 'va-hint' }, '创建于 ' + new Date(t.createdAt).toLocaleString()),
								),
							)) : e('div', { className: 'va-hint' }, '暂无任务。分发任务后，任务在「语音通话」工作区下的任务会话中执行（上下文将满时自动新开会话续接），主会话可随时查看进度与结果。'),
						) : tab === 'activity' ? e(Fragment, null,
							e('div', { className: 'va-hint' }, '其他会话任务完成记录（完成时可选语音播报，设置页可关闭）：'),
							otherDones.length ? otherDones.map((d, i) => e('div', { key: i, className: 'va-task' },
								e('div', { className: 'va-t' },
									e('strong', null, '「' + sessionTitle(list, d.sessionId) + '」'),
									e('span', { className: 'va-hint' }, new Date(d.time).toLocaleTimeString()),
								),
								e('div', { className: 'va-hint' }, (d.text || '').slice(0, 200)),
							)) : e('div', { className: 'va-hint' }, '暂无记录。其他会话完成任务时会显示在这里，并在设置开启时语音播报。'),
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
									e('input', { className: 'va-input', value: settings.ttsGroupId, onChange: (ev) => set('ttsGroupId', ev.target.value), placeholder: 'GroupId（必填）' }),
									e('input', { className: 'va-input', value: settings.ttsMinimaxBase, onChange: (ev) => set('ttsMinimaxBase', ev.target.value), placeholder: 'https://api.minimax.chat/v1/t2a_v2' }),
									settings.ttsMinimaxBase && !/^https?:\/\//.test(settings.ttsMinimaxBase) ? e('div', { className: 'va-hint' }, '⚠ 域名需以 https:// 开头，否则使用默认国内版域名。') : null,
									e('div', { className: 'va-hint' }, 'MiniMax 必须同时填写 API Key 与 GroupId（platform.minimaxi.com → 账户管理 → 接口密钥），两者必须来自同一分组，否则报 token not match group。国内版默认域名 api.minimax.chat；国际版（minimaxi.com）填 https://api.minimaxi.com/v1/t2a_v2。'),
								) : e(Fragment, null,
									e('input', { className: 'va-input', value: settings.ttsBase, onChange: (ev) => set('ttsBase', ev.target.value), placeholder: 'https://api.openai.com/v1/audio/speech' }),
									settings.ttsBase && !/^https?:\/\//.test(settings.ttsBase) ? e('div', { className: 'va-hint' }, '⚠ 域名需以 https:// 开头。') : null,
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
								e('label', null, '唤醒词通话模式'),
								e('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, e('input', { type: 'checkbox', checked: settings.wakeMode, onChange: (ev) => set('wakeMode', ev.target.checked) }), '启用：只有说出唤醒词才开始对话，沉默超时自动休眠'),
								settings.wakeMode ? e(Fragment, null,
									e('div', { className: 'va-row' },
										e('input', { className: 'va-input', value: settings.wakeWord, onChange: (ev) => set('wakeWord', ev.target.value), placeholder: '唤醒词，默认：小鲸鱼' }),
									),
									e('div', { className: 'va-row' },
										e('input', { className: 'va-input', type: 'number', min: '1', max: '120', step: '1', value: Math.round(Number(settings.sleepAfterMs) / 1000), onChange: (ev) => set('sleepAfterMs', (Number(ev.target.value) || 8) * 1000) }),
										e('span', { className: 'va-hint' }, '沉默多少秒后休眠（默认 8 秒）'),
									),
									e('div', { className: 'va-hint' }, '说出唤醒词即唤醒并回应「我在」；唤醒词后跟指令（如「小鲸鱼帮我打开QQ」）会去掉唤醒词后直接执行。'),
									e('div', { className: 'va-hint' }, '💡 建议使用本地部署的 ASR 进行语音识别（如本机 FunASR Server：http://127.0.0.1:10095）：语音不出本机、识别延迟低，唤醒更可靠；云端 ASR 会把每段语音上传识别，唤醒响应也受网络影响。'),
								) : null,
							),
							e('div', { className: 'va-set' },
								e('label', null, '其他'),
								e('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, e('input', { type: 'checkbox', checked: settings.autoSend, onChange: (ev) => set('autoSend', ev.target.checked) }), '识别到文本自动发送'),
								e('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, e('input', { type: 'checkbox', checked: settings.vadEnabled !== false, onChange: (ev) => set('vadEnabled', ev.target.checked) }), '实时监听（说话停顿后自动识别发送）'),
								e('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } }, e('input', { type: 'checkbox', checked: settings.announceOtherDone !== false, onChange: (ev) => set('announceOtherDone', ev.target.checked) }), '播报其他会话任务完成（简要）'),
								settings.vadEnabled !== false ? e('div', { className: 'va-row' },
									e('input', { className: 'va-input', type: 'number', min: '300', max: '5000', step: '100', value: settings.vadSilenceMs, onChange: (ev) => set('vadSilenceMs', Number(ev.target.value) || 1200) }),
									e('span', { className: 'va-hint' }, '停顿判定毫秒（默认 1200）'),
								) : null,
								settings.vadEnabled !== false ? e('div', { className: 'va-row' },
									e('input', { className: 'va-input', type: 'number', min: '0.005', max: '0.2', step: '0.005', value: settings.vadRms, onChange: (ev) => set('vadRms', Number(ev.target.value) || 0.02) }),
									e('span', { className: 'va-hint' }, '语音灵敏度（越小越灵敏，默认 0.02）'),
								) : null,
								e('div', { className: 'va-hint' }, '设置保存在本机浏览器（localStorage），含 API Key 明文；仅支持 https 或本机 http 地址。FunASR Server 新版默认无需 API Key。'),
								e('div', { className: 'va-hint' }, '语音内容固定保存在专属工作区「' + (dedicated?.workspaceTitle || '语音通话') + '」的专属会话中，本体重启后依然延续同一会话；耗时任务会自动分发给其他会话执行。'),
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
				tag.dataset.dyn = '@biliye/dsh-voice-call'
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
