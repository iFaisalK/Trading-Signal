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
    ws.isAlive = true; // Add a property to track the connection status

    // When a pong is received, we know the connection is still alive
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

// --- FIX: Add the Heartbeat Interval ---
// This will run every 30 seconds to keep connections alive
const interval = setInterval(() => {
    wss.clients.forEach(ws => {
        // If a client hasn't responded to the last ping, terminate the connection
        if (ws.isAlive === false) return ws.terminate();

        // Otherwise, assume it's disconnected and send a new ping
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

    // Clear any previous 'isNew' flags from the entire state
    for (const sym in signalState) {
        for (const key in signalState[sym]) {
            if (signalState[sym][key]) {
                signalState[sym][key].isNew = false;
            }
        }
    }

    if (!signalState[symbol]) {
        signalState[symbol] = {
            long_buy_1: null, long_buy_2: null, long_sell_1: null, long_sell_2: null,
            mid_buy_1: null, mid_buy_2: null, mid_sell_1: null, mid_sell_2: null,
            short_buy_1: null, short_buy_2: null, short_sell_1: null, short_sell_2: null,
        };
        console.log(`✨ New symbol added to state: ${symbol}`);
    }

    const existingIndex = symbolOrder.indexOf(symbol);
    if (existingIndex > -1) {
        symbolOrder.splice(existingIndex, 1);
    }
    symbolOrder.unshift(symbol);

    const stateKey = `${term}_${signal}_${indicator}`;
    signalState[symbol][stateKey] = { price, time, isNew: true };

    console.log(`✅ State updated for ${symbol}: ${stateKey} -> ${price}`);
    
    broadcastState();
    
    res.status(200).send('Webhook received!');
});

// --- Start Server ---
server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});
