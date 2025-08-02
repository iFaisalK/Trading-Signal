const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

// Use the port provided by AWS, or default to 3000 for local development
const port = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- State Management for the Grid ---
let signalState = {};
let symbolOrder = [];

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Functions ---


function broadcastState() {
    const payload = JSON.stringify({
        state: signalState,
        symbolOrder: symbolOrder
    });
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
            client.send(payload);
        }
    }
}

// --- WebSocket Connection Handling ---
wss.on('connection', (ws) => {
    console.log('🔗 Client connected');
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Send the current state and order when a new client connects
    ws.send(JSON.stringify({
        state: signalState,
        symbolOrder: symbolOrder
    }));
    ws.on('close', () => console.log('👋 Client disconnected'));
});

// --- Heartbeat Interval (for AWS deployment) ---
const interval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// --- API Endpoints ---
app.post('/webhook', (req, res) => {
    const { symbol, term, signal, indicator, price, time } = req.body;

    if (!symbol || !term || !signal || !indicator || !price || !time) {
        return res.status(400).send('Invalid webhook data. Missing fields.');
    }

    if (!signalState[symbol]) {
        // --- CHANGE: Updated state to handle indicator 3 ---
        signalState[symbol] = {
            long_buy_1: null, long_sell_1: null,
            short_buy_2: null, short_buy_3: null,
            short_sell_2: null, short_sell_3: null,
        };
        console.log(`✨ New symbol added to state: ${symbol}`);
    }

    // Move the updated symbol to the top of the order
    const existingIndex = symbolOrder.indexOf(symbol);
    if (existingIndex > -1) {
        symbolOrder.splice(existingIndex, 1);
    }
    symbolOrder.unshift(symbol);

    const stateKey = `${term}_${signal}_${indicator}`;
    
    if (signalState[symbol].hasOwnProperty(stateKey)) {
        // Add a 'newSince' timestamp for persistent animations
        signalState[symbol][stateKey] = { price, time, newSince: Date.now() };
        console.log(`✅ State updated for ${symbol}: ${stateKey} -> ${price}`);
    } else {
        console.warn(`⚠️ Received signal for an invalid or obsolete key: ${stateKey}. Signal ignored.`);
    }
    
    broadcastState();
    
    res.status(200).send('Webhook received!');
});

// --- Start Server ---
server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
