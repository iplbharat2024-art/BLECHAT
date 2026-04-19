/**
 * Realtime Chat — Frontend Application
 * Manages WebSocket connection, room lifecycle, and chat UI.
 */
// ===== DOM Elements =====
const $ = (id) => document.getElementById(id);
const DOM = {
    statusDot:      $('status-dot'),
    statusText:     $('status-text'),
    headerTitle:    $('header-title'),
    btnLeave:       $('btn-leave'),
    lobby:          $('lobby'),
    inputName:      $('input-name'),
    btnCreate:      $('btn-create'),
    inputCode:      $('input-code'),
    btnJoin:        $('btn-join'),
    waitingScreen:  $('waiting-screen'),
    codeDigits:     $('room-code-digits'),
    btnCopy:        $('btn-copy'),
    copyLabel:      $('copy-label'),
    btnCancelWait:  $('btn-cancel-wait'),
    chatScreen:     $('chat-screen'),
    peerBar:        $('peer-bar'),
    peerName:       $('peer-name'),
    typingIndicator:$('typing-indicator'),
    chatMessages:   $('chat-messages'),
    inputBar:       $('input-bar'),
    msgInput:       $('msg-input'),
    btnSend:        $('btn-send'),
    toast:          $('toast'),
    errorOverlay:   $('error-overlay'),
    errorTitle:     $('error-title'),
    errorMessage:   $('error-message'),
    btnReconnect:   $('btn-error-reconnect'),
    btnHome:        $('btn-error-home'),
};
// ===== State =====
const State = {
    ws: null,
    roomCode: null,
    role: null,       // 'host' | 'client'
    myName: '',
    peerName: '',
    connected: false,
    typingTimeout: null,
    reconnectAttempts: 0,
    maxReconnect: 5,
};
// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    // Restore name from localStorage
    const savedName = localStorage.getItem('chat-username');
    if (savedName) DOM.inputName.value = savedName;
    attachListeners();
    connectWebSocket();
});
// ===== Event Listeners =====
function attachListeners() {
    DOM.btnCreate.addEventListener('click', createRoom);
    DOM.btnJoin.addEventListener('click', joinRoom);
    DOM.btnCancelWait.addEventListener('click', leaveRoom);
    DOM.btnLeave.addEventListener('click', leaveRoom);
    DOM.btnCopy.addEventListener('click', copyRoomCode);
    DOM.btnSend.addEventListener('click', sendMessage);
    DOM.btnReconnect.addEventListener('click', () => {
        DOM.errorOverlay.classList.add('hidden');
        connectWebSocket();
    });
    DOM.btnHome.addEventListener('click', () => {
        DOM.errorOverlay.classList.add('hidden');
        resetToLobby();
    });
    DOM.msgInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    DOM.msgInput.addEventListener('input', () => {
        DOM.btnSend.disabled = DOM.msgInput.value.trim().length === 0;
        sendTypingSignal(true);
    });
    // Only allow digits in room code input
    DOM.inputCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
    });
    // Enter key in code input joins room
    DOM.inputCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
}
// ===== WebSocket Connection =====
function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${location.host}`;
    console.log(`[WS] Connecting to ${wsUrl}...`);
    setStatus('waiting', 'Connecting…');
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        console.log('[WS] Connected');
        State.ws = ws;
        State.reconnectAttempts = 0;
        setStatus('', 'Ready');
        // If we were in a room, try to rejoin
        if (State.roomCode && State.role === 'client') {
            ws.send(JSON.stringify({
                type: 'join-room',
                roomCode: State.roomCode,
                name: State.myName
            }));
        }
    };
    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch {
            console.error('[WS] Invalid message:', event.data);
            return;
        }
        handleServerMessage(msg);
    };
    ws.onclose = () => {
        console.log('[WS] Disconnected');
        State.ws = null;
        if (State.connected) {
            State.connected = false;
            setStatus('disconnected', 'Disconnected');
            showError('Connection Lost', 'The WebSocket connection was closed. Try reconnecting.');
        } else {
            // Try auto-reconnect
            if (State.reconnectAttempts < State.maxReconnect) {
                State.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, State.reconnectAttempts), 10000);
                console.log(`[WS] Reconnecting in ${delay}ms (attempt ${State.reconnectAttempts})...`);
                setStatus('waiting', 'Reconnecting…');
                setTimeout(connectWebSocket, delay);
            } else {
                setStatus('disconnected', 'Disconnected');
                showError('Cannot Connect', 'Unable to reach the server. Make sure the server is running.');
            }
        }
    };
    ws.onerror = (err) => {
        console.error('[WS] Error:', err);
    };
}
// ===== Handle Server Messages =====
function handleServerMessage(msg) {
    console.log('[MSG]', msg.type, msg);
    switch (msg.type) {
        case 'room-created':
            State.roomCode = msg.roomCode;
            State.role = 'host';
            State.myName = msg.name;
            showWaitingScreen(msg.roomCode);
            setStatus('waiting', 'Waiting for peer…');
            console.log(`[ROOM] Created: ${msg.roomCode}`);
            break;
        case 'room-joined':
            State.roomCode = msg.roomCode;
            State.role = 'client';
            State.myName = msg.name;
            State.peerName = msg.peerName;
            State.connected = true;
            showChatScreen(msg.peerName);
            setStatus('connected', `Connected to ${msg.peerName}`);
            addSystemMsg(`You joined the room`);
            console.log(`[ROOM] Joined: ${msg.roomCode}, peer: ${msg.peerName}`);
            break;
        case 'peer-joined':
            State.peerName = msg.peerName;
            State.connected = true;
            showChatScreen(msg.peerName);
            setStatus('connected', `Connected to ${msg.peerName}`);
            addSystemMsg(`${msg.peerName} joined the chat`);
            console.log(`[ROOM] Peer joined: ${msg.peerName}`);
            break;
        case 'chat-message':
            addChatMessage(msg.text, 'received', msg.timestamp);
            console.log(`[CHAT] ${msg.senderName}: ${msg.text}`);
            break;
        case 'message-sent':
            addChatMessage(msg.text, 'sent', msg.timestamp);
            break;
        case 'typing':
            showTyping(msg.isTyping);
            break;
        case 'peer-left':
            State.connected = false;
            addSystemMsg(`${msg.peerName} left the chat`);
            setStatus('waiting', 'Peer disconnected');
            showTyping(false);
            console.log(`[ROOM] Peer left: ${msg.peerName}`);
            break;
        case 'room-closed':
            State.connected = false;
            State.roomCode = null;
            setStatus('disconnected', 'Room closed');
            addSystemMsg(msg.message || 'The room was closed');
            showToast('Room was closed by host');
            setTimeout(resetToLobby, 2500);
            break;
        case 'error':
            console.error('[SERVER ERROR]', msg.message);
            showToast(msg.message);
            break;
        default:
            console.warn('[WS] Unknown message type:', msg.type);
    }
}
// ===== Room Actions =====
function createRoom() {
    const name = DOM.inputName.value.trim() || 'Host';
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server');
        return;
    }
    State.myName = name;
    localStorage.setItem('chat-username', name);
    State.ws.send(JSON.stringify({ type: 'create-room', name }));
}
function joinRoom() {
    const name = DOM.inputName.value.trim() || 'Guest';
    const code = DOM.inputCode.value.trim();
    if (code.length !== 6) {
        showToast('Enter a valid 6-digit room code');
        return;
    }
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected to server');
        return;
    }
    State.myName = name;
    localStorage.setItem('chat-username', name);
    State.ws.send(JSON.stringify({ type: 'join-room', roomCode: code, name }));
}
function leaveRoom() {
    if (State.ws && State.ws.readyState === WebSocket.OPEN) {
        State.ws.send(JSON.stringify({ type: 'leave-room' }));
    }
    State.roomCode = null;
    State.connected = false;
    State.peerName = '';
    resetToLobby();
}
function sendMessage() {
    const text = DOM.msgInput.value.trim();
    if (!text) return;
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) {
        showToast('Not connected');
        return;
    }
    State.ws.send(JSON.stringify({ type: 'chat-message', text }));
    DOM.msgInput.value = '';
    DOM.btnSend.disabled = true;
    sendTypingSignal(false);
}
function sendTypingSignal(isTyping) {
    if (!State.ws || !State.connected) return;
    clearTimeout(State.typingTimeout);
    if (isTyping) {
        State.ws.send(JSON.stringify({ type: 'typing', isTyping: true }));
        State.typingTimeout = setTimeout(() => {
            if (State.ws && State.connected) {
                State.ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
            }
        }, 2000);
    } else {
        State.ws.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }
}
function copyRoomCode() {
    if (!State.roomCode) return;
    navigator.clipboard.writeText(State.roomCode).then(() => {
        DOM.copyLabel.textContent = 'Copied!';
        DOM.btnCopy.classList.add('copied');
        setTimeout(() => {
            DOM.copyLabel.textContent = 'Copy';
            DOM.btnCopy.classList.remove('copied');
        }, 2000);
    }).catch(() => {
        showToast('Failed to copy');
    });
}
// ===== UI Screen Management =====
function showWaitingScreen(code) {
    DOM.lobby.classList.add('hidden');
    DOM.chatScreen.classList.add('hidden');
    DOM.inputBar.classList.add('hidden');
    DOM.waitingScreen.classList.remove('hidden');
    DOM.btnLeave.classList.remove('hidden');
    DOM.codeDigits.textContent = code;
}
function showChatScreen(peerName) {
    DOM.lobby.classList.add('hidden');
    DOM.waitingScreen.classList.add('hidden');
    DOM.chatScreen.classList.remove('hidden');
    DOM.inputBar.classList.remove('hidden');
    DOM.btnLeave.classList.remove('hidden');
    DOM.peerName.textContent = peerName;
    DOM.msgInput.focus();
}
function resetToLobby() {
    DOM.lobby.classList.remove('hidden');
    DOM.waitingScreen.classList.add('hidden');
    DOM.chatScreen.classList.add('hidden');
    DOM.inputBar.classList.add('hidden');
    DOM.btnLeave.classList.add('hidden');
    DOM.errorOverlay.classList.add('hidden');
    // Clear chat messages
    DOM.chatMessages.innerHTML = `
        <div class="chat-welcome" id="chat-welcome">
            <div class="welcome-icon">💬</div>
            <p>You're connected! Say hello.</p>
        </div>
    `;
    setStatus('', 'Ready');
    State.roomCode = null;
    State.role = null;
    State.peerName = '';
    State.connected = false;
}
// ===== Status =====
function setStatus(state, text) {
    DOM.statusDot.className = 'status-dot' + (state ? ' ' + state : '');
    DOM.statusText.textContent = text;
}
// ===== Chat Message Rendering =====
function addChatMessage(text, type, timestamp) {
    const row = document.createElement('div');
    row.className = `msg-row ${type}`;
    const time = timestamp ? new Date(timestamp) : new Date();
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    row.innerHTML = `
        <div class="msg-bubble">
            <div class="msg-text">${escapeHTML(text)}</div>
            <div class="msg-meta">
                <span class="msg-time">${timeStr}</span>
            </div>
        </div>
    `;
    DOM.chatMessages.appendChild(row);
    scrollToBottom();
}
function addSystemMsg(text) {
    const el = document.createElement('div');
    el.className = 'sys-msg';
    el.innerHTML = `<span>${escapeHTML(text)}</span>`;
    DOM.chatMessages.appendChild(el);
    scrollToBottom();
}
function scrollToBottom() {
    requestAnimationFrame(() => {
        DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
    });
}
function showTyping(isTyping) {
    DOM.typingIndicator.classList.toggle('hidden', !isTyping);
}
// ===== Toast =====
function showToast(message) {
    DOM.toast.textContent = message;
    DOM.toast.classList.remove('hidden');
    DOM.toast.classList.add('show');
    setTimeout(() => {
        DOM.toast.classList.remove('show');
        setTimeout(() => DOM.toast.classList.add('hidden'), 300);
    }, 3000);
}
// ===== Error Overlay =====
function showError(title, message) {
    DOM.errorTitle.textContent = title;
    DOM.errorMessage.textContent = message;
    DOM.errorOverlay.classList.remove('hidden');
}
// ===== Utilities =====
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
