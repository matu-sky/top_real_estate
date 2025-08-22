const sharp = require('sharp');
const { Pool } = require('pg');

// Create a new pool for this module to interact with the database
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

// Cache for the watermarks to avoid hitting the DB on every single image upload.
let watermarkCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getWatermarksFromDB() {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT name, image_base64 FROM watermarks');
        const watermarks = {};
        for (const row of result.rows) {
            watermarks[row.name] = Buffer.from(row.image_base64, 'base64');
        }
        return watermarks;
    } finally {
        client.release();
    }
}

async function getWatermarks() {
    const now = Date.now();
    if (watermarkCache && (now - cacheTimestamp < CACHE_DURATION)) {
        // Return from cache
        return watermarkCache;
    }

    // Fetch from DB and update cache
    try {
        watermarkCache = await getWatermarksFromDB();
        cacheTimestamp = now;
        return watermarkCache;
    } catch (error) {
        console.error('Failed to fetch watermarks from DB:', error);
        // In case of DB error, return null or an empty object to prevent breaking uploads
        return {};
    }
}

async function addWatermark(imageBuffer) {
    try {
        const watermarks = await getWatermarks();
        const watermarkCenterBuffer = watermarks['center'];
        const watermarkBottomRightBuffer = watermarks['bottom_right'];

        // If no watermarks are found in DB, return original image
        if (!watermarkCenterBuffer || !watermarkBottomRightBuffer) {
            console.error('[watermark.js] Could not find watermark data in database.');
            return imageBuffer;
        }

        const mainImage = sharp(imageBuffer);
        const mainMetadata = await mainImage.metadata();

        // --- Center Watermark Logic ---
        const centerWatermark = sharp(watermarkCenterBuffer);
        const centerWatermarkMetadata = await centerWatermark.metadata();
        const centerWatermarkWidth = Math.min(Math.floor(mainMetadata.width * 0.5), centerWatermarkMetadata.width);
        const resizedCenterWatermarkBuffer = await centerWatermark
            .resize({ width: centerWatermarkWidth })
            .toBuffer();

        // --- Bottom-Right Watermark Logic ---
        const bottomRightWatermark = sharp(watermarkBottomRightBuffer);
        const bottomRightWatermarkMetadata = await bottomRightWatermark.metadata();
        const bottomRightWatermarkWidth = Math.min(Math.floor(mainMetadata.width * 0.3), bottomRightWatermarkMetadata.width);
        const resizedBottomRightWatermarkBuffer = await bottomRightWatermark
            .resize({ width: bottomRightWatermarkWidth })
            .toBuffer();

        // Composite both watermarks
        const watermarkedBuffer = await mainImage
            .composite([
                { input: resizedCenterWatermarkBuffer, gravity: 'center' },
                { input: resizedBottomRightWatermarkBuffer, gravity: 'southeast' }
            ])
            .toBuffer();

        return watermarkedBuffer;
    } catch (error) {
        console.error('[watermark.js] Error during watermark composition:', error);
        return imageBuffer;
    }
}

module.exports = { addWatermark };