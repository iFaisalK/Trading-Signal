// File: newsService.js

const axios = require('axios');

const API_KEY = process.env.MARKETAUX_API_KEY;
const NEWS_API_URL = `https://api.marketaux.com/v1/news/all?countries=in&filter_entities=true&language=en&limit=100&api_token=${API_KEY}`;

let latestNews = [];
let newsPollingInterval = null;

// --- Helper Function to check market hours in IST ---
const isMarketOpen = () => {
    const now = new Date();
    const timeInIST = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

    const day = timeInIST.getDay(); // Sunday = 0, Saturday = 6
    const hour = timeInIST.getHours();
    const minute = timeInIST.getMinutes();

    if (day === 0 || day === 6) { // Market is closed on weekends
        return false;
    }
    
    // Market is open from 9:00 AM to 3:30 PM
    const timeInMinutes = hour * 60 + minute;
    const marketOpenTime = 9 * 60;
    const marketCloseTime = 15 * 60 + 30;

    return timeInMinutes >= marketOpenTime && timeInMinutes < marketCloseTime;
    // return true; // For testing purposes, always return true
};

const broadcastNews = (wss) => {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({ type: 'news-update', payload: latestNews }));
        }
    });
};

const startPolling = (wss) => {
    if (newsPollingInterval) return; // Already running

    console.log('📰 Market is open. Starting news polling...');

    const fetchAndBroadcastNews = async () => {
        try {
            console.log('Fetching latest news from MarketAux...');
            const response = await axios.get(NEWS_API_URL);
            if (response.data && response.data.data) {
                latestNews = response.data.data;
                broadcastNews(wss);
            }
        } catch (error) {
            if (error.response) {
                 console.error('Error fetching news (MarketAux API):', error.response.data);
            } else {
                 console.error('Error fetching news:', error.message);
            }
        }
    };

    fetchAndBroadcastNews(); // Fetch once immediately
    newsPollingInterval = setInterval(() => fetchAndBroadcastNews(wss), 300000); // Poll every 5 mins
};

const stopPolling = () => {
    if (!newsPollingInterval) return; // Already stopped

    console.log('📰 Stopping news polling. Reason: Market is closed.');
    clearInterval(newsPollingInterval);
    newsPollingInterval = null;
};

const getLatestNews = () => {
    return latestNews;
};

// --- Master Clock to manage the polling schedule ---
const initializeNewsService = (wss) => {
    // Check every minute if the market state has changed
    setInterval(() => {
        if (isMarketOpen()) {
            startPolling(wss);
        } else {
            stopPolling();
        }
    }, 60000); 

    // Also run an initial check when the server starts
    if (isMarketOpen()) {
        startPolling(wss);
    }
};

module.exports = {
    getLatestNews,
    initializeNewsService
};