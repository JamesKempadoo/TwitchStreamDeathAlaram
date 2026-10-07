/**
 * Twitch Stream Death Alarm - Pure Client-Side Browser App
 * Features Twitch EventSub WebSockets (wss://eventsub.wss.twitch.tv/ws)
 * Real-Time Stream Death Detection with 0 Latency.
 * Injects Client ID via .env locally or GitHub Repository Secrets on GitHub Pages.
 */

// Retrieve Client ID dynamically from window.CONFIG or LocalStorage
const getEnvironmentClientId = () => {
  if (window.CONFIG && typeof window.CONFIG.TWITCH_CLIENT_ID === 'string' && window.CONFIG.TWITCH_CLIENT_ID.trim() !== '') {
    return window.CONFIG.TWITCH_CLIENT_ID.trim();
  }
  return localStorage.getItem('twitch_client_id') || '';
};

// Global Application State
const state = {
  clientId: getEnvironmentClientId(),
  oauthToken: localStorage.getItem('twitch_oauth_token') || '',
  targetChannel: localStorage.getItem('twitch_target_channel') || '',
  targetBroadcasterId: '',
  checkIntervalSec: parseInt(localStorage.getItem('twitch_check_interval') || '15', 10),
  soundPreset: localStorage.getItem('twitch_sound_preset') || 'siren',
  volume: parseInt(localStorage.getItem('twitch_volume') || '80', 10),
  connectionMode: localStorage.getItem('twitch_connection_mode') || 'eventsub', // 'eventsub' | 'polling' | 'hybrid'
  isArmed: false,
  
  // Runtime Monitoring State
  isMonitoringActive: false,
  streamState: 'OFFLINE', // 'OFFLINE' | 'LIVE' | 'UNKNOWN'
  hasBeenLive: false,
  checksDone: 0,
  eventsubCount: 0,
  alarmsTriggered: 0,
  timerId: null,

  // EventSub WebSocket Manager
  ws: null,
  sessionId: null,
  wsReconnectTimer: null,
  
  // Authenticated User Info
  userProfile: null
};

// Web Audio API Sound Synthesizer Class (4 Distinct Audio Patterns)
class SoundSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.gainNode = null;
    this.osc1 = null;
    this.osc2 = null;
    this.lfo = null;
    this.pulseInterval = null;
    this.isPlaying = false;
  }

  initContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  isUnlocked() {
    return this.audioCtx && this.audioCtx.state === 'running';
  }

  playAlarm(preset = 'siren', volumePercent = 80) {
    this.initContext();
    if (!this.audioCtx) return;

    this.stopAlarm();

    const masterVolume = (volumePercent / 100) * 0.75;
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(masterVolume, this.audioCtx.currentTime);
    this.gainNode.connect(this.audioCtx.destination);

    this.isPlaying = true;

    if (preset === 'siren') {
      this._playSiren();
    } else if (preset === 'redalert') {
      this._playRedAlert();
    } else if (preset === 'beeps') {
      this._playBeeps();
    } else if (preset === 'strobe') {
      this._playStrobe();
    } else {
      this._playSiren();
    }
  }

  _playSiren() {
    this.osc1 = this.audioCtx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.connect(this.gainNode);

    let high = false;
    this.osc1.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    this.osc1.start();

    this.pulseInterval = setInterval(() => {
      if (!this.isPlaying || !this.audioCtx) return;
      const freq = high ? 600 : 950;
      high = !high;
      this.osc1.frequency.setTargetAtTime(freq, this.audioCtx.currentTime, 0.05);
    }, 400);
  }

  _playRedAlert() {
    this.osc1 = this.audioCtx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.connect(this.gainNode);
    this.osc1.start();

    const triggerKlaxonPulse = () => {
      if (!this.isPlaying || !this.audioCtx || !this.gainNode) return;
      const now = this.audioCtx.currentTime;
      
      const vol = (state.volume / 100) * 0.75;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(vol, now);

      this.osc1.frequency.cancelScheduledValues(now);
      this.osc1.frequency.setValueAtTime(180, now);
      this.osc1.frequency.exponentialRampToValueAtTime(750, now + 0.45);

      this.gainNode.gain.setValueAtTime(0.001, now + 0.46);
    };

    triggerKlaxonPulse();
    this.pulseInterval = setInterval(triggerKlaxonPulse, 700);
  }

  _playBeeps() {
    this.osc1 = this.audioCtx.createOscillator();
    this.osc1.type = 'square';
    this.osc1.frequency.setValueAtTime(2600, this.audioCtx.currentTime);
    this.osc1.connect(this.gainNode);
    this.osc1.start();

    let step = 0;
    this.pulseInterval = setInterval(() => {
      if (!this.isPlaying || !this.gainNode || !this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const vol = (state.volume / 100) * 0.75;

      if (step === 0 || step === 2 || step === 4) {
        this.gainNode.gain.setValueAtTime(vol, now);
      } else {
        this.gainNode.gain.setValueAtTime(0, now);
      }
      step = (step + 1) % 8;
    }, 70);
  }

  _playStrobe() {
    this.osc1 = this.audioCtx.createOscillator();
    this.osc2 = this.audioCtx.createOscillator();
    
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'triangle';

    this.osc1.frequency.setValueAtTime(400, this.audioCtx.currentTime);
    this.osc2.frequency.setValueAtTime(405, this.audioCtx.currentTime);

    this.osc1.connect(this.gainNode);
    this.osc2.connect(this.gainNode);

    this.osc1.start();
    this.osc2.start();

    let toggle = false;
    this.pulseInterval = setInterval(() => {
      if (!this.isPlaying || !this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const freq1 = toggle ? 400 : 1800;
      const freq2 = toggle ? 405 : 1808;
      toggle = !toggle;
      this.osc1.frequency.setTargetAtTime(freq1, now, 0.02);
      this.osc2.frequency.setTargetAtTime(freq2, now, 0.02);
    }, 80);
  }

  stopAlarm() {
    this.isPlaying = false;
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    if (this.osc1) {
      try { this.osc1.stop(); this.osc1.disconnect(); } catch (e) {}
      this.osc1 = null;
    }
    if (this.osc2) {
      try { this.osc2.stop(); this.osc2.disconnect(); } catch (e) {}
      this.osc2 = null;
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch (e) {}
      this.gainNode = null;
    }
  }
}

const synthesizer = new SoundSynthesizer();

// DOM Elements Reference
const elements = {
  // Master Switch & Banner
  alarmArmToggle: document.getElementById('alarm-arm-toggle'),
  toggleSubtext: document.getElementById('toggle-subtext'),
  switchContainer: document.querySelector('.alarm-master-switch-container'),
  headerStatusDot: document.getElementById('status-indicator-dot'),
  headerStatusText: document.getElementById('header-status-text'),
  audioUnlockBanner: document.getElementById('audio-unlock-banner'),
  btnUnlockAudio: document.getElementById('btn-unlock-audio'),

  // Config Inputs
  connectionModeSelect: document.getElementById('connection-mode-select'),
  channelInput: document.getElementById('channel-input'),
  checkIntervalSelect: document.getElementById('check-interval'),
  alarmSoundSelect: document.getElementById('alarm-sound-preset'),
  volumeSlider: document.getElementById('volume-slider'),
  volumeValueText: document.getElementById('volume-value-text'),
  btnSaveConfig: document.getElementById('btn-save-config'),
  btnTestAlarm: document.getElementById('btn-test-alarm'),

  // Auth Controls
  authStatusCard: document.getElementById('auth-status-card'),
  authUserAvatar: document.getElementById('auth-user-avatar'),
  authUserName: document.getElementById('auth-user-name'),
  authStatusBadge: document.getElementById('auth-status-badge'),
  btnTwitchLogin: document.getElementById('btn-twitch-login'),
  btnTwitchLogout: document.getElementById('btn-twitch-logout'),

  // Stream Hero Monitor
  streamHero: document.getElementById('stream-hero'),
  heroChannelName: document.getElementById('hero-channel-name'),
  heroStatusBadge: document.getElementById('hero-status-badge'),
  heroPreviewBox: document.getElementById('hero-preview-box'),
  streamThumbnail: document.getElementById('stream-thumbnail'),
  streamLiveOverlay: document.getElementById('stream-live-overlay'),
  heroViewerCount: document.getElementById('hero-viewer-count'),
  heroStreamTitle: document.getElementById('hero-stream-title'),
  metaCategory: document.getElementById('meta-category'),
  metaUptime: document.getElementById('meta-uptime'),

  // EventSub & Stats
  eventsubStatusPill: document.getElementById('eventsub-status-pill'),
  wsStatusText: document.getElementById('ws-status-text'),
  statEventsubCount: document.getElementById('stat-eventsub-count'),
  statWsSession: document.getElementById('stat-ws-session'),
  statTriggersCount: document.getElementById('stat-triggers-count'),
  logConsole: document.getElementById('log-console'),
  btnClearLog: document.getElementById('btn-clear-log'),

  // Alarm Overlay
  alarmOverlay: document.getElementById('alarm-overlay'),
  alarmChannelName: document.getElementById('alarm-channel-name'),
  alarmTriggerTime: document.getElementById('alarm-trigger-time'),
  btnSilenceAlarm: document.getElementById('btn-silence-alarm'),

  // Modal
  btnOpenGuide: document.getElementById('btn-open-guide'),
  guideModal: document.getElementById('guide-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnModalGotIt: document.getElementById('btn-modal-got-it')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initOAuthFromUrlHash();
  loadSavedSettingsIntoUI();
  setupEventListeners();
  checkAudioContextStatus();
  
  // Validate token whenever an OAuth token exists
  if (state.oauthToken) {
    validateTwitchToken();
  } else {
    logActivity('Click Connect Twitch to authenticate your token.', 'info');
  }
});

/**
 * Parses Twitch OAuth Implicit Grant URL Hash Parameters
 */
function initOAuthFromUrlHash() {
  const hash = window.location.hash.substring(1);
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  
  if (token) {
    state.oauthToken = token;
    localStorage.setItem('twitch_oauth_token', token);
    
    const cleanUrl = window.location.protocol + '//' + window.location.host + window.location.pathname + window.location.search;
    window.history.replaceState(null, null, cleanUrl);

    logActivity('Twitch OAuth Token received from URL hash.', 'success');
    updateAuthUI(true, 'Connecting...');
    validateTwitchToken();
  }
}

/**
 * Load saved configuration into UI elements
 */
function loadSavedSettingsIntoUI() {
  state.clientId = getEnvironmentClientId();

  elements.channelInput.value = state.targetChannel;
  elements.connectionModeSelect.value = state.connectionMode;
  elements.checkIntervalSelect.value = state.checkIntervalSec.toString();
  elements.alarmSoundSelect.value = state.soundPreset;
  elements.volumeSlider.value = state.volume.toString();
  elements.volumeValueText.textContent = `${state.volume}%`;
  
  if (state.targetChannel) {
    elements.heroChannelName.textContent = state.targetChannel;
  }
}

/**
 * Set up event handlers
 */
function setupEventListeners() {
  // Master Alarm Toggle
  elements.alarmArmToggle.addEventListener('change', (e) => {
    state.isArmed = e.target.checked;
    updateArmToggleUI();

    if (state.isArmed) {
      logActivity('ALARM SYSTEM ARMED. Initializing monitor...', 'success');
      startMonitoring();
    } else {
      logActivity('Alarm system disarmed.', 'warning');
      stopMonitoring();
    }
  });

  // Alarm Sound Dropdown Selection Change Event
  elements.alarmSoundSelect.addEventListener('change', (e) => {
    state.soundPreset = e.target.value;
    localStorage.setItem('twitch_sound_preset', state.soundPreset);
    logActivity(`Alarm sound set to: ${e.target.options[e.target.selectedIndex].text}`, 'info');

    if (synthesizer.isPlaying) {
      synthesizer.playAlarm(state.soundPreset, state.volume);
    }
  });

  // Volume Slider
  elements.volumeSlider.addEventListener('input', (e) => {
    state.volume = parseInt(e.target.value, 10);
    elements.volumeValueText.textContent = `${state.volume}%`;
    localStorage.setItem('twitch_volume', state.volume.toString());

    if (synthesizer.isPlaying && synthesizer.gainNode && synthesizer.audioCtx) {
      const vol = (state.volume / 100) * 0.75;
      synthesizer.gainNode.gain.setValueAtTime(vol, synthesizer.audioCtx.currentTime);
    }
  });

  // Save Config Button
  elements.btnSaveConfig.addEventListener('click', () => {
    saveConfigFromUI();
  });

  // Connection Mode Change
  elements.connectionModeSelect.addEventListener('change', (e) => {
    state.connectionMode = e.target.value;
    localStorage.setItem('twitch_connection_mode', state.connectionMode);
    logActivity(`Detection engine set to: ${e.target.options[e.target.selectedIndex].text}`, 'info');
  });

  // Test Alarm Sound Button
  elements.btnTestAlarm.addEventListener('click', () => {
    synthesizer.initContext();
    checkAudioContextStatus();
    state.soundPreset = elements.alarmSoundSelect.value;
    logActivity(`Playing test alarm sound (${elements.alarmSoundSelect.options[elements.alarmSoundSelect.selectedIndex].text})...`, 'warning');
    triggerAlarmOverlay(true);
  });

  // Silence Alarm Button
  elements.btnSilenceAlarm.addEventListener('click', () => {
    silenceAlarm();
  });

  // Connect Twitch OAuth Button
  elements.btnTwitchLogin.addEventListener('click', () => {
    initiateTwitchOAuth();
  });

  // Disconnect Twitch Button
  elements.btnTwitchLogout.addEventListener('click', () => {
    logoutTwitch();
  });

  // Enable Audio Unlock Banner Button
  elements.btnUnlockAudio.addEventListener('click', () => {
    synthesizer.initContext();
    checkAudioContextStatus();
  });

  // Clear Log
  elements.btnClearLog.addEventListener('click', () => {
    elements.logConsole.innerHTML = '';
    logActivity('Log console cleared.', 'info');
  });

  // Setup Guide Modal
  elements.btnOpenGuide.addEventListener('click', (e) => {
    e.preventDefault();
    elements.guideModal.classList.remove('hidden');
  });

  elements.btnCloseModal.addEventListener('click', () => {
    elements.guideModal.classList.add('hidden');
  });

  elements.btnModalGotIt.addEventListener('click', () => {
    elements.guideModal.classList.add('hidden');
  });
}

function updateArmToggleUI() {
  if (state.isArmed) {
    elements.switchContainer.classList.add('armed');
    elements.toggleSubtext.textContent = 'ALARM ARMED - Real-Time Stream Protection Active';
    elements.headerStatusDot.className = 'status-dot monitoring';
    elements.headerStatusText.textContent = 'ARMED & MONITORING';
  } else {
    elements.switchContainer.classList.remove('armed');
    elements.toggleSubtext.textContent = 'Toggle ON to connect EventSub & arm death alert';
    elements.headerStatusDot.className = 'status-dot disarmed';
    elements.headerStatusText.textContent = 'DISARMED';
  }
}

function saveConfigFromUI() {
  state.targetChannel = elements.channelInput.value.trim().toLowerCase();
  state.connectionMode = elements.connectionModeSelect.value;
  state.checkIntervalSec = parseInt(elements.checkIntervalSelect.value, 10);
  state.soundPreset = elements.alarmSoundSelect.value;
  state.volume = parseInt(elements.volumeSlider.value, 10);

  localStorage.setItem('twitch_target_channel', state.targetChannel);
  localStorage.setItem('twitch_connection_mode', state.connectionMode);
  localStorage.setItem('twitch_check_interval', state.checkIntervalSec.toString());
  localStorage.setItem('twitch_sound_preset', state.soundPreset);
  localStorage.setItem('twitch_volume', state.volume.toString());

  if (state.targetChannel) {
    elements.heroChannelName.textContent = state.targetChannel;
  }

  logActivity('Settings saved to local storage.', 'success');

  if (state.isArmed) {
    stopMonitoring();
    startMonitoring();
  }
}

function initiateTwitchOAuth() {
  const clientId = state.clientId;
  if (!clientId) {
    alert('Missing TWITCH_CLIENT_ID environment secret. Set TWITCH_CLIENT_ID in your .env file or GitHub Repository Secrets.');
    return;
  }

  const redirectUri = window.location.protocol + '//' + window.location.host + window.location.pathname;
  const scopes = 'user:read:email';

  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scopes)}`;

  logActivity('Redirecting to Twitch OAuth login...', 'info');
  window.location.href = authUrl;
}

/**
 * Validate OAuth Token via Twitch API and auto-populate user & client_id details
 */
async function validateTwitchToken() {
  if (!state.oauthToken) return;

  try {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        'Authorization': `OAuth ${state.oauthToken}`
      }
    });

    if (!res.ok) {
      throw new Error(`Token validation failed (HTTP ${res.status})`);
    }

    const data = await res.json();
    logActivity(`Twitch OAuth Token valid. Authenticated as: ${data.login}`, 'success');

    // Auto-capture Client ID directly from Twitch validation response if missing
    if (!state.clientId && data.client_id) {
      state.clientId = data.client_id;
      localStorage.setItem('twitch_client_id', data.client_id);
    }

    // Auto-fill target channel name if empty
    if (!state.targetChannel) {
      state.targetChannel = data.login;
      elements.channelInput.value = data.login;
      elements.heroChannelName.textContent = data.login;
      localStorage.setItem('twitch_target_channel', data.login);
    } else {
      elements.channelInput.value = state.targetChannel;
      elements.heroChannelName.textContent = state.targetChannel;
    }

    // UPDATE UI TO SHOW CONNECTED STATUS & USERNAME!
    updateAuthUI(true, data.login);

    if (data.user_id) {
      fetchTwitchUserProfile(data.user_id);
    }
  } catch (err) {
    console.error('Validate token error:', err);
    logActivity(`OAuth validation error: ${err.message}. Please connect Twitch again.`, 'danger');
    logoutTwitch();
  }
}

async function fetchTwitchUserProfile(userId) {
  if (!state.oauthToken) return;

  const clientId = state.clientId || getEnvironmentClientId();
  if (!clientId) return;

  try {
    const res = await fetch(`https://api.twitch.tv/helix/users?id=${userId}`, {
      headers: {
        'Client-Id': clientId,
        'Authorization': `Bearer ${state.oauthToken}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.data && data.data.length > 0) {
        const user = data.data[0];
        state.userProfile = user;
        elements.authUserAvatar.src = user.profile_image_url;
        elements.authUserAvatar.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('Fetch user profile error:', err);
  }
}

function logoutTwitch() {
  state.oauthToken = '';
  state.userProfile = null;
  localStorage.removeItem('twitch_oauth_token');
  updateAuthUI(false);
}

function updateAuthUI(isAuthenticated, loginName = '') {
  if (isAuthenticated) {
    elements.authStatusCard.className = 'auth-status-card authenticated';
    elements.authUserName.textContent = loginName || 'Connected';
    elements.authStatusBadge.textContent = 'Token Active ✓';
    elements.btnTwitchLogin.classList.add('hidden');
    elements.btnTwitchLogout.classList.remove('hidden');
  } else {
    elements.authStatusCard.className = 'auth-status-card unauthenticated';
    elements.authUserName.textContent = 'Not Connected';
    elements.authStatusBadge.textContent = 'OAuth Token Required';
    elements.authUserAvatar.classList.add('hidden');
    elements.btnTwitchLogin.classList.remove('hidden');
    elements.btnTwitchLogout.classList.add('hidden');
  }
}

function checkAudioContextStatus() {
  if (synthesizer.isUnlocked()) {
    elements.audioUnlockBanner.classList.add('hidden');
  } else {
    elements.audioUnlockBanner.classList.remove('hidden');
  }
}

// ==========================================================================
// MONITORING CONTROLLER (EVENTSUB WEBSOCKET + REST FALLBACK)
// ==========================================================================

function startMonitoring() {
  if (state.isMonitoringActive) return;
  state.isMonitoringActive = true;

  checkStreamStatusREST();

  if (state.connectionMode === 'eventsub' || state.connectionMode === 'hybrid') {
    connectEventSubWebSocket();
  }

  if (state.connectionMode === 'polling' || state.connectionMode === 'hybrid') {
    scheduleRESTPolling();
  }
}

function stopMonitoring() {
  state.isMonitoringActive = false;

  if (state.timerId) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }

  disconnectEventSubWebSocket();
}

function connectEventSubWebSocket() {
  if (!state.clientId || !state.oauthToken) {
    logActivity('EventSub WebSocket requires Client ID & Twitch OAuth token.', 'danger');
    updateWebSocketStatus('Auth Required', 'connecting');
    return;
  }

  updateWebSocketStatus('Connecting...', 'connecting');
  logActivity('Connecting to Twitch EventSub WebSocket (wss://eventsub.wss.twitch.tv/ws)...', 'info');

  try {
    state.ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

    state.ws.onopen = () => {
      logActivity('EventSub WebSocket connection established.', 'success');
    };

    state.ws.onmessage = (event) => {
      handleEventSubMessage(event.data);
    };

    state.ws.onerror = (err) => {
      console.error('EventSub WebSocket error:', err);
      logActivity('WebSocket error encountered.', 'warning');
      updateWebSocketStatus('Error', 'connecting');
    };

    state.ws.onclose = (evt) => {
      logActivity(`EventSub WebSocket closed (Code ${evt.code}).`, 'warning');
      updateWebSocketStatus('Disconnected', '');
      elements.statWsSession.textContent = 'Disconnected';

      if (state.isArmed && state.isMonitoringActive) {
        logActivity('Reconnecting EventSub WebSocket in 5 seconds...', 'info');
        state.wsReconnectTimer = setTimeout(() => {
          connectEventSubWebSocket();
        }, 5000);
      }
    };
  } catch (err) {
    console.error('EventSub WebSocket initialization error:', err);
    logActivity(`WebSocket failure: ${err.message}`, 'danger');
  }
}

function disconnectEventSubWebSocket() {
  if (state.wsReconnectTimer) {
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  state.sessionId = null;
  updateWebSocketStatus('Disconnected', '');
  elements.statWsSession.textContent = 'Disconnected';
}

function updateWebSocketStatus(text, statusClass) {
  elements.wsStatusText.textContent = text;
  elements.eventsubStatusPill.className = `eventsub-status-pill ${statusClass}`;
}

function handleEventSubMessage(rawData) {
  try {
    const msg = JSON.parse(rawData);
    const messageType = msg.metadata ? msg.metadata.message_type : null;

    if (messageType === 'session_welcome') {
      state.sessionId = msg.payload.session.id;
      elements.statWsSession.textContent = 'Connected';
      updateWebSocketStatus('Connected', 'connected');
      logActivity('EventSub Session Welcome received. WebSocket connected.', 'success');

      subscribeToEventSubEvents(state.sessionId);
    } 
    else if (messageType === 'session_keepalive') {
      elements.statWsSession.textContent = 'Connected';
    } 
    else if (messageType === 'session_reconnect') {
      logActivity('EventSub requested connection reconnect.', 'info');
    } 
    else if (messageType === 'notification') {
      state.eventsubCount++;
      elements.statEventsubCount.textContent = state.eventsubCount.toString();

      const subType = msg.metadata.subscription_type;
      const eventData = msg.payload.event;

      if (subType === 'stream.offline') {
        logActivity(`REAL-TIME EVENTSUB ALERT: Stream '${eventData.broadcaster_user_name}' went OFFLINE!`, 'danger');
        
        state.streamState = 'OFFLINE';
        elements.heroStatusBadge.className = 'hero-badge badge-offline';
        elements.heroStatusBadge.textContent = 'OFFLINE';
        elements.streamThumbnail.classList.add('hidden');
        elements.streamLiveOverlay.classList.add('hidden');

        triggerAlarmOverlay(false);
      } 
      else if (subType === 'stream.online') {
        logActivity(`REAL-TIME EVENTSUB: Stream '${eventData.broadcaster_user_name}' is now ONLINE.`, 'success');
        
        state.streamState = 'LIVE';
        state.hasBeenLive = true;
        elements.heroStatusBadge.className = 'hero-badge badge-live';
        elements.heroStatusBadge.textContent = 'LIVE';

        checkStreamStatusREST();
      }
    }
  } catch (err) {
    console.error('Error parsing EventSub message:', err);
  }
}

async function subscribeToEventSubEvents(sessionId) {
  const channel = state.targetChannel || elements.channelInput.value.trim();
  if (!channel) return;

  try {
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channel)}`, {
      headers: {
        'Client-Id': state.clientId,
        'Authorization': `Bearer ${state.oauthToken}`
      }
    });

    if (!userRes.ok) {
      throw new Error(`Failed to resolve channel ID (HTTP ${userRes.status})`);
    }

    const userData = await userRes.json();
    if (!userData.data || userData.data.length === 0) {
      throw new Error(`Channel '${channel}' not found on Twitch.`);
    }

    const broadcasterId = userData.data[0].id;
    state.targetBroadcasterId = broadcasterId;

    logActivity(`Resolved channel '${channel}' to Broadcaster ID.`, 'info');

    await createHelixEventSubSubscription('stream.offline', broadcasterId, sessionId);
    await createHelixEventSubSubscription('stream.online', broadcasterId, sessionId);

    logActivity(`Real-Time EventSub subscriptions active for '${channel}'.`, 'success');
  } catch (err) {
    console.error('EventSub subscription error:', err);
    logActivity(`EventSub Subscription failed: ${err.message}`, 'danger');
  }
}

async function createHelixEventSubSubscription(eventType, broadcasterId, sessionId) {
  const bodyData = {
    type: eventType,
    version: '1',
    condition: {
      broadcaster_user_id: broadcasterId
    },
    transport: {
      method: 'websocket',
      session_id: sessionId
    }
  };

  const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Client-Id': state.clientId,
      'Authorization': `Bearer ${state.oauthToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyData)
  });

  if (!res.ok && res.status !== 409) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(`EventSub HTTP ${res.status}: ${errorJson.message || 'Subscription failed'}`);
  }
}

async function checkStreamStatusREST() {
  const clientId = state.clientId;
  const channel = state.targetChannel || elements.channelInput.value.trim();
  const token = state.oauthToken;

  if (!clientId || !channel) return;

  const headers = { 'Client-Id': clientId };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: headers
    });

    if (!res.ok) return;

    const data = await res.json();
    const streams = data.data || [];

    if (streams.length > 0) {
      handleStreamLive(streams[0]);
    } else {
      handleStreamOfflineREST(channel);
    }
  } catch (err) {
    console.error('REST stream check error:', err);
  }
}

function scheduleRESTPolling() {
  if (!state.isArmed) return;
  if (state.timerId) clearTimeout(state.timerId);

  state.timerId = setTimeout(() => {
    if (state.isArmed) {
      checkStreamStatusREST();
      scheduleRESTPolling();
    }
  }, state.checkIntervalSec * 1000);
}

function handleStreamLive(stream) {
  state.streamState = 'LIVE';
  state.hasBeenLive = true;

  elements.heroChannelName.textContent = stream.user_name || state.targetChannel;
  elements.heroStatusBadge.className = 'hero-badge badge-live';
  elements.heroStatusBadge.textContent = 'LIVE';

  let thumbUrl = stream.thumbnail_url
    .replace('{width}', '440')
    .replace('{height}', '248');
  thumbUrl += `?t=${Date.now()}`;

  elements.streamThumbnail.src = thumbUrl;
  elements.streamThumbnail.classList.remove('hidden');
  elements.streamLiveOverlay.classList.remove('hidden');
  elements.heroViewerCount.innerHTML = `<i class="fa-solid fa-user"></i> ${stream.viewer_count.toLocaleString()}`;

  elements.heroStreamTitle.textContent = stream.title || 'Untitled Stream';
  elements.metaCategory.innerHTML = `<i class="fa-solid fa-gamepad"></i> Game: ${stream.game_name || 'Unspecified'}`;
  
  const startTime = new Date(stream.started_at);
  const diffMs = Date.now() - startTime.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  elements.metaUptime.innerHTML = `<i class="fa-solid fa-stopwatch"></i> Uptime: ${hours}h ${mins}m`;
}

function handleStreamOfflineREST(channel) {
  const previousState = state.streamState;
  state.streamState = 'OFFLINE';

  elements.heroChannelName.textContent = channel;
  elements.heroStatusBadge.className = 'hero-badge badge-offline';
  elements.heroStatusBadge.textContent = 'OFFLINE';
  elements.streamThumbnail.classList.add('hidden');
  elements.streamLiveOverlay.classList.add('hidden');
  elements.heroStreamTitle.textContent = `Channel '${channel}' is currently offline.`;

  if ((state.connectionMode === 'polling' || state.connectionMode === 'hybrid') && state.hasBeenLive && previousState === 'LIVE') {
    logActivity(`REST ALERT: Stream '${channel}' went OFFLINE. Triggering Death Alarm!`, 'danger');
    triggerAlarmOverlay(false);
  }
}

function triggerAlarmOverlay(isTest = false) {
  state.alarmsTriggered++;
  elements.statTriggersCount.textContent = state.alarmsTriggered.toString();

  elements.alarmChannelName.textContent = `Channel: ${state.targetChannel || 'Unknown'}`;
  const now = new Date();
  elements.alarmTriggerTime.textContent = `Time: ${now.toLocaleTimeString()}`;
  
  if (isTest) {
    elements.alarmChannelName.textContent = `TEST MODE (Volume ${state.volume}%)`;
  }

  elements.alarmOverlay.classList.remove('hidden');

  const activePreset = elements.alarmSoundSelect ? elements.alarmSoundSelect.value : state.soundPreset;
  synthesizer.playAlarm(activePreset, state.volume);
  
  elements.headerStatusDot.className = 'status-dot alarm';
  elements.headerStatusText.textContent = 'ALARM TRIGGERED!';
}

function silenceAlarm() {
  synthesizer.stopAlarm();
  elements.alarmOverlay.classList.add('hidden');
  
  if (state.isArmed) {
    elements.headerStatusDot.className = 'status-dot monitoring';
    elements.headerStatusText.textContent = 'ARMED & MONITORING';
  } else {
    elements.headerStatusDot.className = 'status-dot disarmed';
    elements.headerStatusText.textContent = 'DISARMED';
  }

  logActivity('Alarm silenced by user.', 'info');
}

function logActivity(message, type = 'info') {
  const timeStr = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">[${timeStr}]</span> ${message}`;

  elements.logConsole.appendChild(entry);
  elements.logConsole.scrollTop = elements.logConsole.scrollHeight;
}
