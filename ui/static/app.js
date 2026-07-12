/* BhashaSakha v6.1 — Minimalist UI (Zara-inspired) */

let ws, mediaStream, mediaRecorder, audioChunks = [];
let isRecording = false, isMuted = false;
let conversations = [], currentConvId = null;

// Recording limits
const MAX_RECORD_MS = 30000; // 30 seconds max (STT is ~1.5-2x realtime on Pi 5)
let recordTimer = null;
let recordStart = 0;
let countdownInterval = null;

// Audio store: play by key, not inline strings
// Values are arrays of blob URLs (TTS arrives in chunks, played in order)
const audioStore = {};
let audioCounter = 0;

// TTS chunks for the in-flight request (streamed while later chunks synth)
let pendingTts = null;

let config = { camera: false, gender: false, age: false, mood: false };
let faceApiLoaded = false, cameraActive = false;
let currentMood = 'neutral', currentGender = '', currentAge = 0;

const L = {en: 0, hi: 1, mr: 2};
const LN = {en: 'English', hi: 'हिन्दी', mr: 'मराठी'};
const LANG_EMOJI = {en: '🇬🇧', hi: '🇮🇳', mr: '🇮🇳'};

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadConvs(); 
    loadConfig();
    connect(); 
    renderSB();
    setTimeout(() => splashUp('Connecting...', 15), 200);
});

// ═══ THEME ════════════════════════════════════════════
function loadTheme() {
    const saved = localStorage.getItem('bs_theme');
    const theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcons(theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('bs_theme', next);
    updateThemeIcons(next);
}

function updateThemeIcons(theme) {
    const sun = _('icon-sun');
    const moon = _('icon-moon');
    if (!sun || !moon) return;
    if (theme === 'dark') {
        sun.classList.add('hide');
        moon.classList.remove('hide');
    } else {
        sun.classList.remove('hide');
        moon.classList.add('hide');
    }
}

// ═══ WEBSOCKET ════════════════════════════════════════
function connect() {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${p}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => splashUp('Loading AI models...', 35);
    ws.onmessage = e => handle(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connect, 2000);
}

function handle(d) {
    if (d.type === 'loading') splashUp('Loading AI models...', 50);
    if (d.type === 'ready') {
        splashUp('Ready!', 100);
        setTimeout(() => {
            _('splash').classList.remove('show');
            _('app').classList.remove('hide');
            initMic();
        }, 500);
    }
    if (d.type === 'processing') showProcessing();
    if (d.type === 'stage') updateStage(d);
    if (d.type === 'stt_partial') showLiveText('proc-src', 'You said', d.text + ' …');
    if (d.type === 'stt_done') showLiveText('proc-src', 'You said', d.text);
    if (d.type === 'trans_done') showLiveText('proc-tgt', 'Translation', d.text);
    if (d.type === 'tts_chunk') onTtsChunk(d);
    if (d.type === 'result') showResult(d);
    if (d.type === 'silence') { clearProcessing(); setStatus('', 'No speech detected'); }
    if (d.type === 'error') { clearProcessing(); setStatus('', 'Error — try again'); }
}

// Progressive reveal inside the processing card
function showLiveText(id, label, text) {
    const el = _(id);
    if (!el) return;
    el.innerHTML = `<span class="proc-live-label">${label}</span>${esc(text)}`;
    el.classList.add('show');
    _('chat').scrollTop = _('chat').scrollHeight;
}

// ═══ STREAMED TTS CHUNKS ═════════════════════════════
function onTtsChunk(d) {
    if (!pendingTts) pendingTts = { urls: [], playIdx: 0, playing: false };
    const raw = atob(d.tts);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    pendingTts.urls.push(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    if (!isMuted) playNextPendingChunk(pendingTts);
}

function playNextPendingChunk(p) {
    if (p.playing || p.playIdx >= p.urls.length) return;
    p.playing = true;
    const a = new Audio(p.urls[p.playIdx++]);
    a.onended = () => { p.playing = false; playNextPendingChunk(p); };
    a.onerror = () => { p.playing = false; };
    a.play().catch(() => { p.playing = false; });
}

function splashUp(t, p) {
    const f = _('splash-fill'), s = _('splash-status');
    if (f) f.style.width = p + '%';
    if (s) s.textContent = t;
}

// ═══ MIC ══════════════════════════════════════════════
async function initMic() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        setStatus('', 'Ready');
    } catch (e) { 
        console.error("Mic Error:", e);
        setStatus('', 'Mic Error: ' + e.name); 
    }
}

function startRec() {
    if (isRecording || !mediaStream) return;
    if (event) event.preventDefault();
    isRecording = true;
    audioChunks = [];
    recordStart = Date.now();
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: bestMime() });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(50);
    _('mic').classList.add('rec');
    setStatus('rec', 'Recording — release to translate');

    // Show countdown timer
    showRecTimer();
    countdownInterval = setInterval(updateRecTimer, 100);

    // Auto-stop after MAX_RECORD_MS to prevent freezing
    recordTimer = setTimeout(() => {
        if (isRecording) stopRec();
    }, MAX_RECORD_MS);
}

function stopRec() {
    if (!isRecording) return;
    if (event) event.preventDefault();
    isRecording = false;
    _('mic').classList.remove('rec');
    setStatus('proc', 'Processing...');

    // Clear recording timer
    if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    hideRecTimer();

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            audioChunks = [];

            // Store original voice for playback
            const origKey = 'orig_' + (++audioCounter);
            audioStore[origKey] = URL.createObjectURL(blob);

            // Send as WAV
            const wavBlob = await toWav(blob);
            const wavBuf = await wavBlob.arrayBuffer();
            const src = _('sel-src').value, tgt = _('sel-tgt').value;
            const hdr = new Uint8Array([L[src] || 0, L[tgt] || 0]);
            const combined = new Uint8Array(hdr.length + wavBuf.byteLength);
            combined.set(hdr);
            combined.set(new Uint8Array(wavBuf), 2);

            // Attach origKey to pending result
            window._pendingOrigKey = origKey;

            if (ws && ws.readyState === 1) {
                // Send metadata first
                let g = config.gender ? currentGender : null;
                let a = config.age ? currentAge : null;
                ws.send(JSON.stringify({type: 'meta', gender: g, age: a}));
                // Then send audio buffer
                ws.send(combined.buffer);
                showProcessing();
            }
        };
        mediaRecorder.stop();
    }
}

// ═══ RECORDING TIMER ═════════════════════════════════
function showRecTimer() {
    let el = _('rec-timer');
    if (!el) {
        el = document.createElement('div');
        el.id = 'rec-timer';
        el.className = 'rec-timer';
        el.innerHTML = `<span class="rec-dot"></span><span id="rec-time">0.0s</span><span class="rec-max"> / ${MAX_RECORD_MS / 1000}s</span>`;
        document.body.appendChild(el);
    }
    el.classList.add('show');
}

function updateRecTimer() {
    const el = _('rec-time');
    if (!el) return;
    const elapsed = ((Date.now() - recordStart) / 1000).toFixed(1);
    el.textContent = elapsed + 's';
    // Warn when nearing limit
    const timer = _('rec-timer');
    if (timer && (Date.now() - recordStart) > MAX_RECORD_MS * 0.8) {
        timer.classList.add('warn');
    }
}

function hideRecTimer() {
    const el = _('rec-timer');
    if (el) { el.classList.remove('show', 'warn'); }
}

// ═══ DISPLAY: Processing ═════════════════════════════
let procStartTime = 0;
let procTimerInterval = null;

function showProcessing() {
    clearProcessing();
    hideWelcome();
    pendingTts = null;
    procStartTime = Date.now();
    const s = _('sel-src').value, t = _('sel-tgt').value;
    const el = document.createElement('div');
    el.className = 'proc-card';
    el.id = 'proc-card';
    el.innerHTML = `
        <div class="proc-inner">
            <div class="proc-stages">
                <div class="proc-stage active" id="ps-stt">
                    <div class="ps-dot"></div><span>Recognizing</span>
                </div>
                <div class="proc-stage" id="ps-translate">
                    <div class="ps-dot"></div><span>Translating</span>
                </div>
                <div class="proc-stage" id="ps-tts">
                    <div class="ps-dot"></div><span>Generating</span>
                </div>
            </div>
            <p class="proc-text">${LN[s]} → ${LN[t]}</p>
            <p class="proc-live" id="proc-src"></p>
            <p class="proc-live tgt" id="proc-tgt"></p>
            <p class="proc-sub" id="proc-msg">Processing...</p>
            <p class="proc-timer" id="proc-elapsed">0.0s</p>
        </div>`;
    _('chat').appendChild(el);
    _('chat').scrollTop = _('chat').scrollHeight;
    procTimerInterval = setInterval(() => {
        const el = _('proc-elapsed');
        if (el) el.textContent = ((Date.now() - procStartTime) / 1000).toFixed(1) + 's';
    }, 100);
}

function updateStage(d) {
    // Update which pipeline stage is active
    const stages = ['stt', 'translate', 'tts'];
    stages.forEach(s => {
        const el = _('ps-' + s);
        if (!el) return;
        if (s === d.stage) {
            el.classList.add('active');
            el.classList.remove('done');
        } else if (stages.indexOf(s) < stages.indexOf(d.stage)) {
            el.classList.remove('active');
            el.classList.add('done');
        }
    });
    const msg = _('proc-msg');
    if (msg && d.msg) msg.textContent = d.msg;
    setStatus('proc', d.msg || 'Processing...');
}

function clearProcessing() {
    const p = _('proc-card');
    if (p) p.remove();
    if (procTimerInterval) { clearInterval(procTimerInterval); procTimerInterval = null; }
}

function hideWelcome() {
    const w = _('welcome');
    if (w) w.style.display = 'none';
}

// ═══ DISPLAY: Result (Unified Card) ══════════════════
function showResult(d) {
    clearProcessing();
    hideWelcome();
    ensureConv();

    const chat = _('chat');
    const isLat = d.tgt_lang === 'en';
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const secs = (d.total_ms / 1000).toFixed(1);

    // TTS audio arrived as streamed chunks — keep them for replay
    let ttsKey = null;
    if (pendingTts && pendingTts.urls.length) {
        ttsKey = 'tts_' + (++audioCounter);
        audioStore[ttsKey] = pendingTts.urls;
    } else if (d.tts) {
        // Backward compat: single inline TTS payload
        ttsKey = 'tts_' + (++audioCounter);
        const raw = atob(d.tts);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        audioStore[ttsKey] = [URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))];
    }
    pendingTts = null;

    // Get original voice key
    const origKey = window._pendingOrigKey || null;
    window._pendingOrigKey = null;

    const el = document.createElement('div');
    el.className = 'tcard';

    el.innerHTML = `
        <div class="tc-top">
            <span class="tc-lang-pair">
                <span class="tc-lang src">${LN[d.src_lang]}</span>
                <svg class="tc-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <span class="tc-lang tgt">${LN[d.tgt_lang]}</span>
            </span>
            <span class="tc-time">${timeStr}</span>
        </div>

        <div class="tc-body">
            <div class="tc-section tc-original">
                <div class="tc-sec-head">
                    <span class="tc-sec-label">Original</span>
                    ${origKey ? `<button class="tc-play" onclick="playAudio('${origKey}',this,'Original')">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        <span>Play</span>
                    </button>` : ''}
                </div>
                <p class="tc-text-src">${esc(d.src_text)}</p>
            </div>

            <div class="tc-divider"></div>

            <div class="tc-section tc-translated">
                <div class="tc-sec-head">
                    <span class="tc-sec-label">Translation</span>
                    ${ttsKey ? `<button class="tc-play accent" onclick="playAudio('${ttsKey}',this,'Translation')">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        <span>Play</span>
                    </button>` : ''}
                </div>
                <p class="tc-text-tgt ${isLat ? 'latin' : ''}">${esc(d.tgt_text)}</p>
            </div>
        </div>

        <div class="tc-footer">
            <span class="tc-metric">${secs}s</span>
            <button class="tc-copy" onclick="copyText(this,'${esc(d.tgt_text).replace(/'/g, "\\'")}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy
            </button>
        </div>`;

    chat.appendChild(el);
    requestAnimationFrame(() => chat.scrollTop = chat.scrollHeight);
    setStatus('', 'Done — ' + secs + 's');

    saveMsg(d);
    // Streamed chunks auto-play as they arrive; only play here for the
    // legacy single-payload path
    if (!isMuted && ttsKey && d.tts) playAudio(ttsKey, null, 'Translation');
}

// ═══ AUDIO PLAYBACK ══════════════════════════════════
function playAudio(key, btn, label) {
    let urls = audioStore[key];
    if (!urls) return;
    if (!Array.isArray(urls)) urls = [urls];

    const reset = () => {
        if (btn) {
            btn.classList.remove('playing');
            btn.querySelector('span').textContent = 'Play';
        }
    };
    if (btn) {
        btn.classList.add('playing');
        btn.querySelector('span').textContent = 'Playing...';
    }

    let i = 0;
    const playNext = () => {
        if (i >= urls.length) { reset(); return; }
        const a = new Audio(urls[i++]);
        a.onended = playNext;
        a.onerror = reset;
        a.play().catch(reset);
    };
    playNext();
}

function copyText(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        setTimeout(() => btn.innerHTML = orig, 1500);
    });
}

// ═══ CONVERSATIONS ════════════════════════════════════
function loadConvs() {
    try {
        conversations = JSON.parse(localStorage.getItem('bs_c') || '[]');
        currentConvId = localStorage.getItem('bs_cur') || null;
    } catch { conversations = []; }
}

function saveConvs() {
    localStorage.setItem('bs_c', JSON.stringify(conversations));
    localStorage.setItem('bs_cur', currentConvId || '');
}

function ensureConv() {
    if (!currentConvId) {
        const id = 'c' + Date.now();
        conversations.unshift({ id, title: 'New conversation', time: new Date().toISOString(), msgs: [] });
        currentConvId = id;
        saveConvs();
        renderSB();
    }
}

function saveMsg(d) {
    const c = conversations.find(x => x.id === currentConvId);
    if (!c) return;
    c.msgs.push({ st: d.src_text, sl: d.src_lang, tt: d.tgt_text, tl: d.tgt_lang, tm: d.total_ms, t: new Date().toISOString() });
    if (c.msgs.length === 1) c.title = d.src_text.substring(0, 35) + (d.src_text.length > 35 ? '…' : '');
    saveConvs();
    renderSB();
}

function newConversation() {
    currentConvId = null;
    _('chat').innerHTML = welcomeHTML();
    renderSB();
    toggleSidebar();
}

function openConv(id) {
    currentConvId = id;
    saveConvs();
    const c = conversations.find(x => x.id === id);
    if (!c) return;
    const chat = _('chat');
    chat.innerHTML = '';
    c.msgs.forEach((m, i) => {
        const isLat = m.tl === 'en';
        const t = new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const secs = (m.tm / 1000).toFixed(1);
        const el = document.createElement('div');
        el.className = 'tcard';
        el.style.cssText = 'animation:none;opacity:1;transform:none';
        el.innerHTML = `
            <div class="tc-top">
                <span class="tc-lang-pair">
                    <span class="tc-lang src">${LN[m.sl]}</span>
                    <svg class="tc-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    <span class="tc-lang tgt">${LN[m.tl]}</span>
                </span>
                <span class="tc-time">${t}</span>
            </div>
            <div class="tc-body">
                <div class="tc-section tc-original">
                    <div class="tc-sec-head"><span class="tc-sec-label">Original</span></div>
                    <p class="tc-text-src">${esc(m.st)}</p>
                </div>
                <div class="tc-divider"></div>
                <div class="tc-section tc-translated">
                    <div class="tc-sec-head"><span class="tc-sec-label">Translation</span></div>
                    <p class="tc-text-tgt ${isLat ? 'latin' : ''}">${esc(m.tt)}</p>
                </div>
            </div>
            <div class="tc-footer"><span class="tc-metric">${secs}s</span></div>`;
        chat.appendChild(el);
    });
    chat.scrollTop = chat.scrollHeight;
    renderSB();
    toggleSidebar();
}

function deleteConv(id, e) {
    e.stopPropagation();
    conversations = conversations.filter(c => c.id !== id);
    if (currentConvId === id) { currentConvId = null; _('chat').innerHTML = welcomeHTML(); }
    saveConvs();
    renderSB();
}

function renderSB() {
    const ls = _('sb-list');
    if (!conversations.length) { ls.innerHTML = '<p class="sb-empty">No conversations yet</p>'; return; }
    ls.innerHTML = conversations.slice(0, 30).map(c => {
        const a = c.id === currentConvId ? ' active' : '';
        const d = new Date(c.time).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const cnt = c.msgs ? c.msgs.length : 0;
        return `<div class="sb-item${a}" onclick="openConv('${c.id}')">
            <div class="sb-item-info">
                <span class="sb-item-t">${esc(c.title)}</span>
                <span class="sb-item-meta">${cnt} msg · ${d}</span>
            </div>
            <button class="sb-item-del" onclick="deleteConv('${c.id}',event)" title="Delete">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        </div>`;
    }).join('');
}

function welcomeHTML() {
    return `<div class="welcome" id="welcome">
        <div class="w-glyph"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg></div>
        <h2>Hold the mic &amp; speak</h2>
        <p>Choose languages above, then hold the microphone to record your voice — or type text below</p>
        <p class="w-deva">ऊपर भाषा चुनें, माइक दबाकर बोलें या नीचे टाइप करें</p>
    </div>`;
}

// ═══ SIDEBAR / SETTINGS ══════════════════════════════
function toggleSidebar() {
    _('sidebar').classList.toggle('open');
    _('sb-shade').classList.toggle('open');
}

function toggleSettings() {
    const dialog = _('settings');
    if (dialog.open) {
        dialog.close();
    } else {
        dialog.showModal();
        fetchSys();
    }
}

async function fetchSys() {
    try {
        const r = await fetch('/api/system');
        const d = await r.json();
        _('s-cpu').textContent = d.cpu_pct + '%';
        _('s-ram').textContent = d.ram_total_mb + 'MB';
        _('s-used').textContent = d.ram_used_mb + 'MB';
        _('ram-bar').style.width = d.ram_pct + '%';
        _('model-list').innerHTML = Object.entries(d.models).map(([k, v]) =>
            `<div class="sm-model"><span class="mn">${k.replace(/_/g, ' ')}</span><span class="mv">${v}</span></div>`
        ).join('');
    } catch {}
}

function loadConfig() {
    try {
        const c = JSON.parse(localStorage.getItem('bs_cfg'));
        if (c) Object.assign(config, c);
    } catch {}
    _('cfg-camera').checked = config.camera;
    _('cfg-gender').checked = config.gender;
    _('cfg-age').checked = config.age;
    _('cfg-mood').checked = config.mood;
    if (config.camera) setTimeout(startFaceApi, 1000);
}

function onConfigChange() {
    config.camera = _('cfg-camera').checked;
    config.gender = _('cfg-gender').checked;
    config.age = _('cfg-age').checked;
    config.mood = _('cfg-mood').checked;
    localStorage.setItem('bs_cfg', JSON.stringify(config));
    
    if (config.camera) startFaceApi();
    else stopFaceApi();
    
    if (!config.mood) _('mood-tracker').classList.add('hide');
}

async function startFaceApi() {
    if (cameraActive) return;
    try {
        if (!faceApiLoaded) {
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri('/static/models'),
                faceapi.nets.faceExpressionNet.loadFromUri('/static/models'),
                faceapi.nets.ageGenderNet.loadFromUri('/static/models')
            ]);
            faceApiLoaded = true;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }});
        _('video-feed').srcObject = stream;
        cameraActive = true;
        requestAnimationFrame(processFaceApi);
    } catch (e) { 
        console.error('FaceAPI Init Error:', e); 
        alert('Camera Error: ' + e.message + '\n\nPlease ensure your camera is plugged in, and your browser has permission to access it.');
        _('cfg-camera').checked = false;
        config.camera = false;
        localStorage.setItem('bs_cfg', JSON.stringify(config));
    }
}

function stopFaceApi() {
    const v = _('video-feed');
    if (v && v.srcObject) {
        v.srcObject.getTracks().forEach(t => t.stop());
        v.srcObject = null;
    }
    cameraActive = false;
    _('mood-tracker').classList.add('hide');
}

async function processFaceApi() {
    if (!cameraActive || !config.camera) return;
    const v = _('video-feed');
    if (v.readyState === 4) {
        const det = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions().withAgeAndGender();
        if (det) {
            currentGender = det.gender;
            currentAge = det.age;
            if (config.mood) {
                const ex = det.expressions;
                let maxE = 'neutral', maxV = 0;
                for (let e in ex) { if (ex[e] > maxV) { maxV = ex[e]; maxE = e; } }
                const emojis = { happy: '😊', sad: '😢', angry: '😠', fearful: '😨', disgusted: '🤢', surprised: '😲', neutral: '😐' };
                _('mood-emoji').textContent = emojis[maxE] || '😐';
                _('mood-text').textContent = 'Customer looks ' + maxE;
                _('mood-tracker').classList.remove('hide');
            } else {
                _('mood-tracker').classList.add('hide');
            }
        }
    }
    setTimeout(() => requestAnimationFrame(processFaceApi), 300); // 3-4 FPS
}

// ═══ TYPED TEXT INPUT ════════════════════════════════
function sendText() {
    const inp = _('text-in');
    if (!inp) return;
    const text = (inp.value || '').trim();
    if (!text || !ws || ws.readyState !== 1) return;
    inp.value = '';
    window._pendingOrigKey = null;
    showProcessing();
    // No STT stage for typed input — mark it done immediately
    updateStage({ stage: 'translate', msg: 'Translating...' });
    ws.send(JSON.stringify({
        type: 'text', text,
        src: _('sel-src').value, tgt: _('sel-tgt').value,
    }));
}

function onTextKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); sendText(); }
}

// ═══ LANGUAGE ═════════════════════════════════════════
function onLangChange() {
    if (_('sel-src').value === _('sel-tgt').value) {
        const o = ['en', 'hi', 'mr'].filter(l => l !== _('sel-src').value);
        _('sel-tgt').value = o[0];
    }
}

function swapLangs() {
    const s = _('sel-src'), t = _('sel-tgt');
    const sv = s.value;
    s.value = t.value;
    t.value = sv;
}

// ═══ WAV ENCODING ════════════════════════════════════
async function toWav(blob) {
    try {
        const buf = await blob.arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 16000);
        const dec = await ctx.decodeAudioData(buf);
        return encWav(dec);
    } catch { return blob; }
}

function encWav(ab) {
    const ch = ab.getChannelData(0), sr = ab.sampleRate;
    const s = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
        const v = Math.max(-1, Math.min(1, ch[i]));
        s[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
    }
    const ds = s.length * 2, wav = new ArrayBuffer(44 + ds), d = new DataView(wav);
    const w = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); d.setUint32(4, wav.byteLength - 8, true); w(8, 'WAVE');
    w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
    d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true);
    d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, ds, true);
    new Int16Array(wav, 44).set(s);
    return new Blob([wav], { type: 'audio/wav' });
}

function bestMime() {
    for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'])
        if (MediaRecorder.isTypeSupported(t)) return t;
    return 'audio/webm';
}

// ═══ UI HELPERS ══════════════════════════════════════
function setStatus(state, text) {
    _('ib-dot').className = 'ib-dot' + (state ? ' ' + state : '');
    _('ib-text').textContent = text;
}

function toggleMute() {
    isMuted = !isMuted;
    const btn = _('mute-btn');
    btn.classList.toggle('muted', isMuted);
    _('icon-vol-on').classList.toggle('hide', isMuted);
    _('icon-vol-off').classList.toggle('hide', !isMuted);
}

function esc(t) { const e = document.createElement('span'); e.textContent = t; return e.innerHTML; }
function _(id) { return document.getElementById(id); }
