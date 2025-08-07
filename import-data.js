// File: import-data.js (v2 - with merge logic)
const { DynamoDBClient, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");
const fs = require('fs');

// --- Configuration ---
const REGION = "eu-north-1"; // Your AWS region
const TABLE_NAME = "Trading_Signals";
const DATA_FILE = "historical-data.json";
// ---

const dynamoDBClient = new DynamoDBClient({ region: REGION });

async function importData() {
    console.log(`Reading data from ${DATA_FILE}...`);
    const dataString = fs.readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(dataString);
    console.log(`Found ${data.length} raw items to process.`);

    // --- NEW: Merge Logic to handle duplicates ---
    const mergedData = {};

    data.forEach(item => {
        // Find the most recent signal to determine the date
        const mostRecentSignal = Object.values(item.stateData).reduce((latest, signal) => {
            if (!signal || !signal.time) return latest;
            if (!latest || new Date(signal.time) > new Date(latest.time)) {
                return signal;
            }
            return latest;
        }, null);

        if (!mostRecentSignal) {
            console.warn(`⚠️ Skipping item for symbol ${item.symbol} as it has no valid signal time.`);
            return;
        }

        const date = new Date(mostRecentSignal.time).toISOString().split('T')[0];
        const symbolDateKey = `${item.symbol}-${date}`;

        if (!mergedData[symbolDateKey]) {
            // If this is the first time we see this key, create a new entry
            mergedData[symbolDateKey] = {
                symbolDate: symbolDateKey,
                stateData: {},
                lastUpdated: item.lastUpdated
            };
        }

        // Merge the signal data
        Object.assign(mergedData[symbolDateKey].stateData, item.stateData);

        // Keep the latest timestamp
        if (new Date(item.lastUpdated) > new Date(mergedData[symbolDateKey].lastUpdated)) {
            mergedData[symbolDateKey].lastUpdated = item.lastUpdated;
        }
    });

    const finalData = Object.values(mergedData);
    console.log(`Data has been merged into ${finalData.length} unique daily records.`);
    // --- End of Merge Logic ---


    // DynamoDB BatchWriteItem can only handle 25 items at a time.
    const chunks = [];
    for (let i = 0; i < finalData.length; i += 25) {
        chunks.push(finalData.slice(i, i + 25));
    }

    for (const [index, chunk] of chunks.entries()) {
        console.log(`Processing chunk ${index + 1} of ${chunks.length}...`);

        const putRequests = chunk.map(item => {
            const ttl_timestamp = Math.floor(new Date(item.lastUpdated).getTime() / 1000) + (15 * 24 * 60 * 60);

            return {
                PutRequest: {
                    Item: {
                        'symbolDate': { S: item.symbolDate },
                        'stateData': { S: JSON.stringify(item.stateData) },
                        'lastUpdated': { S: item.lastUpdated },
                        'ttl': { N: ttl_timestamp.toString() }
                    }
                }
            };
        });

        const params = {
            RequestItems: {
                [TABLE_NAME]: putRequests
            }
        };

        try {
            await dynamoDBClient.send(new BatchWriteItemCommand(params));
            console.log(`✅ Successfully imported chunk ${index + 1}.`);
        } catch (err) {
            console.error(`🔥 Error importing chunk ${index + 1}:`, err);
        }
    }

    console.log("Data import complete.");
}

importData();
