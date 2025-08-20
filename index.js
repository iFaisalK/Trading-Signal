// File: index.js

require('dotenv').config(); // Load environment variables for the entire app

const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
} = require("@aws-sdk/client-dynamodb");
const newsService = require("./newsService.js");

// --- AWS and App Setup ---
const port = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const dynamoDBClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "eu-north-1",
});
const tableName = "Trading_Signals";

// --- State Management for the Grid ---
let signalState = {};
let symbolOrder = [];

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Helper Functions ---
function broadcastState() {
  const payload = JSON.stringify({
    state: signalState,
    symbolOrder: symbolOrder,
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
}

// --- WebSocket Connection Handling (Simplified) ---
wss.on("connection", (ws) => {
  console.log("🔗 Client connected");
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Send the current signal state immediately
  ws.send(JSON.stringify({ state: signalState, symbolOrder: symbolOrder }));
  
  // Immediately send the most recent news to the newly connected client.
  const currentNews = newsService.getLatestNews();
  if (currentNews.length > 0) {
    ws.send(JSON.stringify({ type: "news-update", payload: currentNews }));
  }

  ws.on("close", () => {
    console.log("👋 Client disconnected");
  });
});

// --- Heartbeat Interval (Simplified) ---
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// --- API Endpoints ---
app.post("/webhook", async (req, res) => {
  const { symbol, term, signal, indicator, price, time } = req.body;
  if (!symbol || !term || !signal || !indicator || !price || !time) {
    return res.status(400).send("Invalid webhook data. Missing fields.");
  }

  const signalDate = new Date(time).toISOString().split("T")[0];
  const symbolDateKey = `${symbol}-${signalDate}`;

  if (!signalState[symbolDateKey]) {
    signalState[symbolDateKey] = {
      long_buy_1: null,
      long_sell_1: null,
      short_buy_2: null,
      short_buy_3: null,
      short_sell_2: null,
      short_sell_3: null,
    };
    console.log(`✨ New daily entry for ${symbolDateKey}`);
  }

  const existingIndex = symbolOrder.indexOf(symbolDateKey);
  if (existingIndex > -1) {
    symbolOrder.splice(existingIndex, 1);
  }
  symbolOrder.unshift(symbolDateKey);

  const stateKey = `${term}_${signal}_${indicator}`;
  if (signalState[symbolDateKey].hasOwnProperty(stateKey)) {
    signalState[symbolDateKey][stateKey] = {
      price,
      time,
      newSince: Date.now(),
    };
    console.log(
      `✅ State updated for ${symbolDateKey}: ${stateKey} -> ${price}`
    );
  } else {
    console.warn(
      `⚠️ Received signal for an invalid or obsolete key: ${stateKey}. Signal ignored.`
    );
  }

  try {
    const ttl_timestamp = Math.floor(Date.now() / 1000) + 15 * 24 * 60 * 60;
    const params = {
      TableName: tableName,
      Item: {
        symbolDate: { S: symbolDateKey },
        stateData: { S: JSON.stringify(signalState[symbolDateKey]) },
        lastUpdated: { S: new Date().toISOString() },
        ttl: { N: ttl_timestamp.toString() },
      },
    };
    await dynamoDBClient.send(new PutItemCommand(params));
    console.log(`💾 Persisted state for ${symbolDateKey} to DynamoDB.`);
  } catch (dbError) {
    console.error("🔥 DynamoDB Put Error:", dbError);
  }

  broadcastState();
  res.status(200).send("Webhook received!");
});

// --- Function to load data from DynamoDB on startup ---
async function loadDataFromDB() {
  console.log("...Loading initial data from DynamoDB...");
  try {
    const params = { TableName: tableName };
    const data = await dynamoDBClient.send(new ScanCommand(params));
    if (data.Items) {
      data.Items.sort((a, b) => {
        if (a.lastUpdated && b.lastUpdated) {
          return new Date(b.lastUpdated.S) - new Date(a.lastUpdated.S);
        }
        return 0;
      });

      data.Items.forEach((item) => {
        if (
          item.symbolDate &&
          item.symbolDate.S &&
          item.stateData &&
          item.stateData.S
        ) {
          const symbolDateKey = item.symbolDate.S;
          const stateData = JSON.parse(item.stateData.S);
          signalState[symbolDateKey] = stateData;
          symbolOrder.push(symbolDateKey);
        } else {
          console.warn(
            "⚠️ Found a malformed item in DynamoDB, skipping:",
            item
          );
        }
      });
      console.log(
        `✅ Successfully loaded ${symbolOrder.length} valid historical symbol entries from DynamoDB.`
      );
    }
  } catch (dbError) {
    console.error("🔥 DynamoDB Scan Error on startup:", dbError);
  }
}

// --- Start Server ---
server.listen(port, async () => {
  await loadDataFromDB();
  
  // Initialize the news service clock. This is the new robust way.
  newsService.initializeNewsService(wss);

  console.log(`🚀 Server running on port ${port}`);
});