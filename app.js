/**
 * Bluetooth Chat — P2P Messaging Application
 * Uses Web Bluetooth API for device communication
 * 
 * Architecture:
 *   - Host: Waits for BLE connections (requires experimental GATT server API)
 *   - Client: Scans and connects to a Host via GATT
 *   - Demo: Simulates chat without actual Bluetooth hardware
 * 
 * Custom BLE Service UUID:  12345678-1234-5678-1234-56789abcdef0
 * TX Characteristic UUID:   12345678-1234-5678-1234-56789abcdef1
 * RX Characteristic UUID:   12345678-1234-5678-1234-56789abcdef2
 */
// ===== Constants =====
const BLE_SERVICE_UUID         = '12345678-1234-5678-1234-56789abcdef0';
const BLE_TX_CHARACTERISTIC    = '12345678-1234-5678-1234-56789abcdef1';
const BLE_RX_CHARACTERISTIC    = '12345678-1234-5678-1234-56789abcdef2';
const LOCAL_STORAGE_KEY        = 'bluetooth-chat-messages';
const MAX_STORED_MESSAGES      = 50;
const DEMO_RESPONSES = [
    "Hey! How's it going? 😊",
    "That's awesome! Tell me more.",
    "I'm just testing Bluetooth chat too!",
    "The connection seems really stable 🔗",
    "Web Bluetooth is pretty cool, right?",
    "Can you believe this works over BLE?",
    "Let me know if the messages arrive instantly.",
    "This is so much fun! 🚀",
    "Have you tried sending a longer message to test the bubble layout?",
    "Roger that! 👍"
];
// ===== DOM Elements =====
const DOM = {
    // Warning
    unsupportedWarning: document.getElementById('unsupported-warning'),
    dismissWarning:     document.getElementById('dismiss-warning'),
    // Header
    statusDot:      document.getElementById('status-dot'),
    statusText:     document.getElementById('status-text'),
    btnDebug:       document.getElementById('btn-debug'),
    btnReconnect:   document.getElementById('btn-reconnect'),
    btnDisconnect:  document.getElementById('btn-disconnect'),
    // Debug
    debugPanel:     document.getElementById('debug-panel'),
    debugLog:       document.getElementById('debug-log'),
    btnClearDebug:  document.getElementById('btn-clear-debug'),
    // Role selection
    roleSelection:  document.getElementById('role-selection'),
    btnHost:        document.getElementById('btn-host'),
    btnClient:      document.getElementById('btn-client'),
    btnDemo:        document.getElementById('btn-demo'),
    // Chat
    chatArea:       document.getElementById('chat-area'),
    messages:       document.getElementById('messages'),
    startTime:      document.getElementById('start-time'),
    // Input
    inputArea:      document.getElementById('message-input-area'),
    messageInput:   document.getElementById('message-input'),
    btnSend:        document.getElementById('btn-send'),
};
// ===== Application State =====
const State = {
    role: null,           // 'host' | 'client' | 'demo'
    connected: false,
    device: null,         // BluetoothDevice
    server: null,         // BluetoothRemoteGATTServer
    txCharacteristic: null,
    rxCharacteristic: null,
    debugVisible: false,
    messages: [],         // { text, type: 'sent'|'received'|'system', timestamp }
};
// ===== Initialization =====
document.addEventListener('DOMContentLoaded', init);
function init() {
    checkBrowserSupport();
    attachEventListeners();
    loadMessages();
    debugLog('App initialized', 'info');
}
// ===== Browser Support Check =====
function checkBrowserSupport() {
    if (!navigator.bluetooth) {
        DOM.unsupportedWarning.classList.remove('hidden');
        debugLog('Web Bluetooth API not supported in this browser', 'error');
    }
}
// ===== Event Listeners =====
function attachEventListeners() {
    // Warning dismiss
    DOM.dismissWarning.addEventListener('click', () => {
        DOM.unsupportedWarning.classList.add('hidden');
    });
    // Role selection
    DOM.btnHost.addEventListener('click', () => selectRole('host'));
    DOM.btnClient.addEventListener('click', () => selectRole('client'));
    DOM.btnDemo.addEventListener('click', () => selectRole('demo'));
    // Debug panel
    DOM.btnDebug.addEventListener('click', toggleDebugPanel);
    DOM.btnClearDebug.addEventListener('click', clearDebugLog);
    // Chat actions
    DOM.btnSend.addEventListener('click', sendMessage);
    DOM.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    DOM.messageInput.addEventListener('input', () => {
        DOM.btnSend.disabled = DOM.messageInput.value.trim().length === 0;
    });
    // Header buttons
    DOM.btnReconnect.addEventListener('click', reconnect);
    DOM.btnDisconnect.addEventListener('click', disconnect);
}
// ===== Role Selection =====
async function selectRole(role) {
    State.role = role;
    debugLog(`Role selected: ${role}`, 'info');
    if (role === 'demo') {
        startDemoMode();
    } else if (role === 'client') {
        await startClient();
    } else if (role === 'host') {
        await startHost();
    }
}
// ===== Connection Status =====
function setStatus(status) {
    // status: 'disconnected' | 'connecting' | 'connected'
    const dot = DOM.statusDot;
    const text = DOM.statusText;
    dot.className = 'status-dot ' + status;
    const labels = {
        disconnected: 'Disconnected',
        connecting: 'Connecting...',
        connected: 'Connected'
    };
    text.textContent = labels[status] || status;
    // Toggle action buttons
    DOM.btnDisconnect.classList.toggle('hidden', status !== 'connected');
    DOM.btnReconnect.classList.toggle('hidden', status !== 'disconnected' || !State.device);
    State.connected = (status === 'connected');
}
// ===== Show Chat UI =====
function showChatUI() {
    DOM.roleSelection.classList.add('hidden');
    DOM.chatArea.classList.remove('hidden');
    DOM.inputArea.classList.remove('hidden');
    DOM.startTime.textContent = formatTime(new Date());
    DOM.messageInput.focus();
}
// ===== BLE Client Logic =====
async function startClient() {
    if (!navigator.bluetooth) {
        addSystemMessage('Bluetooth not supported. Try Demo Mode instead.');
        debugLog('Cannot start client: Bluetooth not supported', 'error');
        return;
    }
    try {
        setStatus('connecting');
        debugLog('Requesting Bluetooth device...', 'info');
        // Request device with our custom service
        State.device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [BLE_SERVICE_UUID] }],
            // If the above doesn't show devices, use acceptAllDevices:
            // acceptAllDevices: true,
            // optionalServices: [BLE_SERVICE_UUID]
        });
        debugLog(`Device selected: ${State.device.name || 'Unknown'}`, 'success');
        // Listen for disconnection
        State.device.addEventListener('gattserverdisconnected', onDisconnected);
        // Connect to GATT Server
        debugLog('Connecting to GATT server...', 'info');
        State.server = await State.device.gatt.connect();
        debugLog('GATT server connected', 'success');
        // Get service
        const service = await State.server.getPrimaryService(BLE_SERVICE_UUID);
        debugLog('Service discovered', 'success');
        // Get TX characteristic (for sending messages TO the host)
        State.txCharacteristic = await service.getCharacteristic(BLE_TX_CHARACTERISTIC);
        debugLog('TX characteristic ready', 'success');
        // Get RX characteristic (for receiving messages FROM the host)
        State.rxCharacteristic = await service.getCharacteristic(BLE_RX_CHARACTERISTIC);
        await State.rxCharacteristic.startNotifications();
        State.rxCharacteristic.addEventListener('characteristicvaluechanged', onMessageReceived);
        debugLog('RX notifications started', 'success');
        // We are connected
        setStatus('connected');
        showChatUI();
        addSystemMessage('Connected to host device');
    } catch (error) {
        handleConnectionError(error);
    }
}
// ===== BLE Host Logic =====
async function startHost() {
    /**
     * IMPORTANT: The Web Bluetooth API (as of 2026) primarily supports the
     * Central role — i.e., scanning for and connecting to peripheral devices.
     * 
     * Acting as a GATT Server (peripheral / host) from a web page requires 
     * the experimental "Web Bluetooth Peripheral" API, which is behind a flag 
     * in Chrome:
     *   chrome://flags/#enable-experimental-web-platform-features
     * 
     * Since this API is not widely available, the Host role will:
     * 1. Attempt to use the experimental API if available
     * 2. Fall back to an informational message with instructions
     */
    debugLog('Starting host mode...', 'info');
    // Check for experimental peripheral API
    if (navigator.bluetooth && typeof navigator.bluetooth.requestLEScan === 'function') {
        debugLog('Experimental BLE scan API detected', 'info');
    }
    // Currently, no standard web API exists to create a GATT server from a browser.
    // We inform the user and suggest alternatives.
    setStatus('connecting');
    showChatUI();
    addSystemMessage(
        '⚠️ Host mode requires experimental browser support. ' +
        'The Web Bluetooth API currently only supports the Client (Central) role in most browsers. ' +
        'To test peer-to-peer chat, use one of these approaches:\n\n' +
        '1. Use "Demo Mode" to test the chat UI\n' +
        '2. Run a BLE peripheral on one device (native app or Python script) and connect from this browser as Client\n' +
        '3. Enable chrome://flags/#enable-experimental-web-platform-features and use a Chromium build with peripheral support'
    );
    // Attempt experimental peripheral API
    try {
        if (navigator.bluetooth && navigator.bluetooth.getAvailability) {
            const available = await navigator.bluetooth.getAvailability();
            debugLog(`Bluetooth available: ${available}`, available ? 'success' : 'error');
            if (!available) {
                addSystemMessage('Bluetooth hardware is not available on this device.');
                setStatus('disconnected');
                return;
            }
        }
        // Currently falls through to waiting state
        addSystemMessage('Waiting for a client to connect... (Use a BLE peripheral app to advertise the custom service)');
        setStatus('connecting');
        debugLog('Host is waiting for connections (experimental mode)', 'info');
    } catch (error) {
        debugLog(`Host error: ${error.message}`, 'error');
        addSystemMessage(`Error: ${error.message}`);
        setStatus('disconnected');
    }
}
// ===== Message Handling =====
function onMessageReceived(event) {
    const decoder = new TextDecoder('utf-8');
    const value = event.target.value;
    const text = decoder.decode(value);
    debugLog(`Message received: "${text}"`, 'success');
    addMessage(text, 'received');
}
async function sendMessage() {
    const text = DOM.messageInput.value.trim();
    if (!text) return;
    // Add to UI immediately
    addMessage(text, 'sent');
    DOM.messageInput.value = '';
    DOM.btnSend.disabled = true;
    if (State.role === 'demo') {
        // Simulate response in demo mode
        scheduleDemoResponse();
        return;
    }
    // Send via Bluetooth
    if (State.txCharacteristic) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(text);
            // BLE has a max attribute size of ~512 bytes. 
            // Chunk if needed (simplified: single write for now)
            await State.txCharacteristic.writeValue(data);
            debugLog(`Message sent: "${text}"`, 'info');
        } catch (error) {
            debugLog(`Send error: ${error.message}`, 'error');
            addSystemMessage(`Failed to send: ${error.message}`);
        }
    } else {
        debugLog('No TX characteristic — message only shown locally', 'error');
    }
}
// ===== UI Message Rendering =====
function addMessage(text, type) {
    const timestamp = new Date();
    const messageData = { text, type, timestamp: timestamp.toISOString() };
    // Store
    State.messages.push(messageData);
    saveMessages();
    // Render
    const row = document.createElement('div');
    row.className = `message-row ${type}`;
    row.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${escapeHTML(text)}</div>
            <div class="message-meta">
                <span class="message-time">${formatTime(timestamp)}</span>
            </div>
        </div>
    `;
    DOM.messages.appendChild(row);
    scrollToBottom();
}
function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.innerHTML = `<span>${escapeHTML(text)}</span>`;
    DOM.messages.appendChild(el);
    scrollToBottom();
    State.messages.push({ text, type: 'system', timestamp: new Date().toISOString() });
    saveMessages();
}
function scrollToBottom() {
    requestAnimationFrame(() => {
        DOM.chatArea.scrollTop = DOM.chatArea.scrollHeight;
    });
}
// ===== Disconnection Handling =====
function onDisconnected() {
    debugLog('Device disconnected', 'error');
    setStatus('disconnected');
    addSystemMessage('Device disconnected');
    State.connected = false;
    State.txCharacteristic = null;
    State.rxCharacteristic = null;
}
async function disconnect() {
    debugLog('User initiated disconnect', 'info');
    if (State.role === 'demo') {
        setStatus('disconnected');
        addSystemMessage('Demo session ended');
        // Reset to role selection
        DOM.chatArea.classList.add('hidden');
        DOM.inputArea.classList.add('hidden');
        DOM.roleSelection.classList.remove('hidden');
        DOM.btnDisconnect.classList.add('hidden');
        State.role = null;
        return;
    }
    try {
        if (State.rxCharacteristic) {
            await State.rxCharacteristic.stopNotifications();
        }
    } catch (e) {
        debugLog(`Stop notifications error: ${e.message}`, 'error');
    }
    try {
        if (State.server && State.server.connected) {
            State.server.disconnect();
        }
    } catch (e) {
        debugLog(`Disconnect error: ${e.message}`, 'error');
    }
    setStatus('disconnected');
    addSystemMessage('Disconnected');
}
async function reconnect() {
    if (State.role === 'demo') {
        startDemoMode();
        return;
    }
    if (!State.device) {
        debugLog('No previous device to reconnect to', 'error');
        return;
    }
    try {
        setStatus('connecting');
        debugLog(`Reconnecting to ${State.device.name || 'device'}...`, 'info');
        State.server = await State.device.gatt.connect();
        const service = await State.server.getPrimaryService(BLE_SERVICE_UUID);
        State.txCharacteristic = await service.getCharacteristic(BLE_TX_CHARACTERISTIC);
        State.rxCharacteristic = await service.getCharacteristic(BLE_RX_CHARACTERISTIC);
        await State.rxCharacteristic.startNotifications();
        State.rxCharacteristic.addEventListener('characteristicvaluechanged', onMessageReceived);
        setStatus('connected');
        addSystemMessage('Reconnected successfully');
        debugLog('Reconnection successful', 'success');
    } catch (error) {
        handleConnectionError(error);
    }
}
// ===== Demo Mode =====
function startDemoMode() {
    debugLog('Starting demo mode', 'info');
    setStatus('connected');
    showChatUI();
    addSystemMessage('Demo mode — messages are simulated locally');
}
function scheduleDemoResponse() {
    const delay = 800 + Math.random() * 1500;
    setTimeout(() => {
        const response = DEMO_RESPONSES[Math.floor(Math.random() * DEMO_RESPONSES.length)];
        addMessage(response, 'received');
        debugLog(`Demo response: "${response}"`, 'info');
    }, delay);
}
// ===== Error Handling =====
function handleConnectionError(error) {
    debugLog(`Connection error: ${error.message}`, 'error');
    if (error.name === 'NotFoundError') {
        addSystemMessage('No device selected. Please try again.');
    } else if (error.message?.includes('User cancelled')) {
        addSystemMessage('Connection cancelled by user.');
    } else if (error.message?.includes('GATT')) {
        addSystemMessage('Could not connect to the device GATT server. Make sure the device is nearby and powered on.');
    } else {
        addSystemMessage(`Connection error: ${error.message}`);
    }
    setStatus('disconnected');
    // Show role selection again if chat isn't open
    if (DOM.chatArea.classList.contains('hidden')) {
        DOM.roleSelection.classList.remove('hidden');
    }
}
// ===== Debug Panel =====
function toggleDebugPanel() {
    State.debugVisible = !State.debugVisible;
    DOM.debugPanel.classList.toggle('hidden', !State.debugVisible);
    DOM.btnDebug.classList.toggle('active', State.debugVisible);
}
function debugLog(message, level = 'info') {
    // Console log
    const prefix = '[BT Chat]';
    switch (level) {
        case 'error':   console.error(prefix, message); break;
        case 'success': console.log(prefix, '✅', message); break;
        default:        console.log(prefix, message);
    }
    // UI log
    const entry = document.createElement('div');
    entry.className = `debug-entry ${level}`;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="debug-time">${timeStr}</span>${escapeHTML(message)}`;
    DOM.debugLog.appendChild(entry);
    DOM.debugLog.scrollTop = DOM.debugLog.scrollHeight;
}
function clearDebugLog() {
    DOM.debugLog.innerHTML = '';
    debugLog('Debug log cleared', 'info');
}
// ===== Local Storage =====
function saveMessages() {
    try {
        const toSave = State.messages.slice(-MAX_STORED_MESSAGES);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
        debugLog(`Storage save error: ${e.message}`, 'error');
    }
}
function loadMessages() {
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            State.messages = JSON.parse(stored);
            debugLog(`Loaded ${State.messages.length} messages from storage`, 'info');
        }
    } catch (e) {
        debugLog(`Storage load error: ${e.message}`, 'error');
    }
}
function restoreMessagesToUI() {
    State.messages.forEach(msg => {
        if (msg.type === 'system') {
            const el = document.createElement('div');
            el.className = 'system-message';
            el.innerHTML = `<span>${escapeHTML(msg.text)}</span>`;
            DOM.messages.appendChild(el);
        } else {
            const row = document.createElement('div');
            row.className = `message-row ${msg.type}`;
            const time = new Date(msg.timestamp);
            row.innerHTML = `
                <div class="message-bubble">
                    <div class="message-text">${escapeHTML(msg.text)}</div>
                    <div class="message-meta">
                        <span class="message-time">${formatTime(time)}</span>
                    </div>
                </div>
            `;
            DOM.messages.appendChild(row);
        }
    });
    scrollToBottom();
}
// ===== Utilities =====
function formatTime(date) {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
