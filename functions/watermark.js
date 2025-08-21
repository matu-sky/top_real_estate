const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

console.log('[watermark.js] Module loaded (Image-based)');

let watermarkBuffer;
try {
    const watermarkPath = path.resolve(__dirname, '../public/images/watermark.png');
    console.log(`[watermark.js] Reading watermark image from: ${watermarkPath}`);
    watermarkBuffer = fs.readFileSync(watermarkPath);
    console.log('[watermark.js] Watermark image read successfully.');
} catch (error) {
    console.error('[watermark.js] CRITICAL: Failed to read watermark image.', error);
    throw error;
}

async function addWatermark(imageBuffer) {
    console.log('[watermark.js] addWatermark function called (Image-based).');
    try {
        const watermarkedBuffer = await sharp(imageBuffer)
            .composite([
                { input: watermarkBuffer, gravity: 'center' }
            ])
            .toBuffer();
        console.log('[watermark.js] Watermark image composited successfully.');
        return watermarkedBuffer;
    } catch (error) {
        console.error('[watermark.js] Error during watermark composition:', error);
        return imageBuffer; // Return original buffer on error
    }
}

module.exports = { addWatermark };