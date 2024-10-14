const TIMEOUT_DURATION = 30000; // 30 seconds timeout
const puppeteer = require('puppeteer');
const express = require('express');
const WebSocket = require('ws');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const PORT = 3000;
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
// Function to chunk an array into smaller arrays
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
// Function to create a delay
function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}
// Function to get new image links
async function getNewImageLinks(page, divSelector) {
    await autoScroll(page, 100); // Ensure scrolling works
    const newLinks = await page.evaluate((divSelector) => {
        const elements = document.querySelectorAll(`${divSelector} a img`);
        return Array.from(elements).map(element => element.src).filter(src => src);
    }, divSelector);
    return newLinks;
}
// Auto-scroll function
async function autoScroll(page, scrollDelay) {
    await page.evaluate(async (scrollDelay) => {
        await new Promise(resolve => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, scrollDelay);
        });
    }, scrollDelay);
}
// Function to add data to MongoDB
async function addData(links) {
    try {
        await client.connect();
        const database = client.db('askeladd'); // Replace with your actual database name
        const collection = database.collection('waitforplot'); // Replace with your actual collection name

        for (const link of links) {
            // const url = link.map() 
            const linkData = { link }; // Store the link in an object
            try {
                const result = await collection.insertOne(linkData); // Insert each link
                console.log(`New document inserted with _id: ${result.insertedId}`);
            } catch (error) {
                if (error.code === 11000) {
                    console.error(`Duplicate link found: ${link}. Skipping insertion.`);
                } else {
                    console.error("Error inserting data:", error);
                }
            }
        }
    } catch (error) {
        console.error("Error during addData operation:", error);
    } finally {
        await client.close();
    }
}

// Main scraping function
async function continuousScrapeImageLinks(query, order, divSelector, ws) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        const searchUrl = `https://www.redgifs.com/niches/${query}?order=${order}`;
        console.log(`Searching for results from ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });

        const selectorExists = await page.waitForSelector(divSelector).catch(() => false);
        if (!selectorExists) {
            throw new Error(`Selector ${divSelector} not found on the page.`);
        }

        while (true) {
            const newLinks = await getNewImageLinks(page, divSelector);
            console.log('Extracted new links:', newLinks);
            if (newLinks.length > 0) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const chunks = chunkArray(newLinks, 400);
                    for (const chunk of chunks) {
                        ws.send(JSON.stringify({ links: chunk }));
                    }
                } else {
                    console.error("WebSocket is undefined or not ready.");
                }

                // Add the links to MongoDB
                await addData(newLinks);
            }

            await delay(5000); // Scrape new links every 5 seconds
        }
    } catch (error) {
        console.error('Error occurred during scraping:', error);
    } finally {
        if (browser) await browser.close();
    }
}

// WebSocket server for live link updates
const wss = new WebSocket.Server({ port: 8080 });
let currentScraping = null; // Track the current scraping instance
wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        const { query, order, divSelector } = JSON.parse(message);
        console.log('Received query:', query);

        // Cancel the previous scraping if it's still running
        if (currentScraping) {
            clearTimeout(currentScraping.timeoutId);
            currentScraping.browser.close();
        }
        // Create a timeout for the scraping operation
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => {
                reject(new Error('Operation timed out'));
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ error: 'Operation timed out' }));
                }
            }, TIMEOUT_DURATION)
        );
        try {
            currentScraping = {
                browser: await puppeteer.launch({ headless: true }),
                timeoutId: setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ error: 'Operation timed out' }));
                    }
                }, TIMEOUT_DURATION),
            };

            const page = await currentScraping.browser.newPage();
            await continuousScrapeImageLinks(query, order, divSelector, ws);
            await Promise.race([
                continuousScrapeImageLinks(query, order, divSelector, ws),
                timeoutPromise
            ]);
        } catch (error) {
            console.error('Error during WebSocket scraping:', error.message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (currentScraping) {
            currentScraping.browser.close();
            currentScraping = null; // Clear the current scraping instance
        }
    });
});

// Define a route to notify the user that WebSocket is available
app.get('/', (req, res) => {
    res.send('WebSocket server running on ws://localhost:8080. Connect for live scraping updates.');
});

// Start the express server
app.listen(PORT, () => {
    console.log(`Express server is running on http://localhost:${PORT}`);
});

// Create a unique index for MongoDB collection on startup
(async () => {
    try {
        await client.connect();
        const database = client.db('askeladd');
        const collection = database.collection('waitforplot');
        await collection.createIndex({ link: 1 }, { unique: true });
        console.log("Unique index created on the 'link' field.");
    } catch (error) {
        console.error("Error creating unique index:", error);
    } finally {
        await client.close();
    }
})();

continuousScrapeImageLinks('watch-it-for-the-plot', 'top', '.previewFeed');