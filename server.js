/**
 * Realtime Chat — WebSocket Signaling Server
 * 
 * Manages rooms via 6-digit codes and relays messages between paired users.
 * Serves the static frontend and handles all WS events.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
// ===== Static File Server =====
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const httpServer = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(FRONTEND_DIR, filePath);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});
// ===== WebSocket Server =====
const wss = new WebSocketServer({ server: httpServer });
/**
 * Room structure:
 * rooms = Map<roomCode, {
 *     host: WebSocket,
 *     client: WebSocket | null,
 *     hostName: string,
 *     clientName: string,
 *     createdAt: Date
 * }>
 */
const rooms = new Map();
// Generate unique 6-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms.has(code));
    return code;
}
// Send JSON helper
function sendJSON(ws, data) {
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(data));
    }
}
// Get peer socket
function getPeer(ws, room) {
    if (room.host === ws) return room.client;
    if (room.client === ws) return room.host;
    return null;
}
// Find room by socket
function findRoomBySocket(ws) {
    for (const [code, room] of rooms.entries()) {
        if (room.host === ws || room.client === ws) {
            return { code, room };
        }
    }
    return null;
}
// Clean up stale rooms older than 2 hours
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
        if (now - room.createdAt > 2 * 60 * 60 * 1000) {
            console.log(`[CLEANUP] Room ${code} expired`);
            rooms.delete(code);
        }
    }
}, 60000);
wss.on('connection', (ws) => {
    console.log(`[CONNECT] New client connected (total: ${wss.clients.size})`);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (rawData) => {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch {
            sendJSON(ws, { type: 'error', message: 'Invalid message format' });
            return;
        }
        switch (msg.type) {
            case 'create-room': {
                // Remove from any existing room first
                cleanupSocket(ws);
                const code = generateRoomCode();
                const name = sanitize(msg.name) || 'Host';
                rooms.set(code, {
                    host: ws,
                    client: null,
                    hostName: name,
                    clientName: '',
                    createdAt: Date.now()
                });
                ws._roomCode = code;
                ws._role = 'host';
                sendJSON(ws, {
                    type: 'room-created',
                    roomCode: code,
                    name
                });
                console.log(`[ROOM] Created room ${code} by "${name}"`);
                break;
            }
            case 'join-room': {
                const code = (msg.roomCode || '').trim();
                const name = sanitize(msg.name) || 'Guest';
                if (!rooms.has(code)) {
                    sendJSON(ws, { type: 'error', message: 'Room not found. Check the code and try again.' });
                    return;
                }
                const room = rooms.get(code);
                if (room.client) {
                    sendJSON(ws, { type: 'error', message: 'Room is full. Only 2 users allowed per room.' });
                    return;
                }
                // Remove from any existing room first
                cleanupSocket(ws);
                room.client = ws;
                room.clientName = name;
                ws._roomCode = code;
                ws._role = 'client';
                // Notify the joiner
                sendJSON(ws, {
                    type: 'room-joined',
                    roomCode: code,
                    peerName: room.hostName,
                    name
                });
                // Notify the host
                sendJSON(room.host, {
                    type: 'peer-joined',
                    peerName: name
                });
                console.log(`[ROOM] "${name}" joined room ${code}`);
                break;
            }
            case 'chat-message': {
                const result = findRoomBySocket(ws);
                if (!result) {
                    sendJSON(ws, { type: 'error', message: 'You are not in a room.' });
                    return;
                }
                const { room } = result;
                const peer = getPeer(ws, room);
                const text = (msg.text || '').trim();
                if (!text) return;
                if (text.length > 2000) {
                    sendJSON(ws, { type: 'error', message: 'Message too long (max 2000 chars).' });
                    return;
                }
                const senderName = room.host === ws ? room.hostName : room.clientName;
                const timestamp = new Date().toISOString();
                // Send to peer
                if (peer) {
                    sendJSON(peer, {
                        type: 'chat-message',
                        text,
                        senderName,
                        timestamp
                    });
                }
                // Confirm to sender
                sendJSON(ws, {
                    type: 'message-sent',
                    text,
                    timestamp
                });
                console.log(`[MSG] ${senderName}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
                break;
            }
            case 'typing': {
                const result = findRoomBySocket(ws);
                if (!result) return;
                const peer = getPeer(ws, result.room);
                if (peer) {
                    sendJSON(peer, { type: 'typing', isTyping: msg.isTyping });
                }
                break;
            }
            case 'leave-room': {
                handleLeave(ws);
                break;
            }
            default:
                sendJSON(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
    });
    ws.on('close', () => {
        console.log(`[DISCONNECT] Client disconnected (total: ${wss.clients.size})`);
        handleLeave(ws);
    });
    ws.on('error', (err) => {
        console.error(`[ERROR] WebSocket error:`, err.message);
    });
});
function handleLeave(ws) {
    const result = findRoomBySocket(ws);
    if (!result) return;
    const { code, room } = result;
    const peer = getPeer(ws, room);
    const leaverName = room.host === ws ? room.hostName : room.clientName;
    if (peer) {
        sendJSON(peer, {
            type: 'peer-left',
            peerName: leaverName
        });
    }
    // If host leaves, destroy room
    if (room.host === ws) {
        if (peer) {
            sendJSON(peer, { type: 'room-closed', message: 'The host closed the room.' });
        }
        rooms.delete(code);
        console.log(`[ROOM] Room ${code} destroyed (host left)`);
    } else {
        // Client left, keep room open for new client
        room.client = null;
        room.clientName = '';
        console.log(`[ROOM] "${leaverName}" left room ${code}`);
    }
}
function cleanupSocket(ws) {
    const result = findRoomBySocket(ws);
    if (result) handleLeave(ws);
}
function sanitize(str) {
    if (!str) return '';
    return str.replace(/[<>&"']/g, '').trim().substring(0, 30);
}
// Heartbeat — detect dead connections
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('[HEARTBEAT] Terminating dead connection');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on('close', () => clearInterval(heartbeatInterval));
// ===== Start Server =====
httpServer.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║       🚀 Realtime Chat Server        ║');
    console.log('  ╠══════════════════════════════════════╣');
    console.log(`  ║  Local:   http://localhost:${PORT}       ║`);
    console.log('  ║  Press Ctrl+C to stop               ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
});
