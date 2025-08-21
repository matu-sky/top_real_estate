const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

console.log('[watermark.js] Module loaded (Image-based)');

let watermarkBuffer;
try {
    const watermarkPath = path.resolve(__dirname, '../public/images/watermark.png');
    console.log(`[watermark.js] Reading watermark image from: ${watermarkPath}`);
    watermarkBuffer = fs.readFileSync(watermarkPath);
    console.log(`[watermark.js] Watermark image read successfully. Buffer size: ${watermarkBuffer.length}`);
} catch (error) {
    console.error('[watermark.js] CRITICAL: Failed to read watermark image.', error);
    throw error;
}

async function addWatermark(imageBuffer) {
    console.log('[watermark.js] addWatermark function called (Image-based).');
    try {
        const mainImage = sharp(imageBuffer);
        const mainMetadata = await mainImage.metadata();
        console.log(`[watermark.js] Main image dimensions: ${mainMetadata.width}x${mainMetadata.height}`);

        const watermark = sharp(watermarkBuffer);
        const watermarkMetadata = await watermark.metadata();
        console.log(`[watermark.js] Watermark source image dimensions: ${watermarkMetadata.width}x${watermarkMetadata.height}`);

        const newWatermarkWidth = Math.floor(mainMetadata.width * 0.5);
        console.log(`[watermark.js] Calculated new watermark width: ${newWatermarkWidth}`);

        const finalWatermarkWidth = Math.min(newWatermarkWidth, watermarkMetadata.width);
        console.log(`[watermark.js] Final watermark width (after comparing with original): ${finalWatermarkWidth}`);

        const resizedWatermarkBuffer = await watermark
            .resize({ width: finalWatermarkWidth })
            .toBuffer();
        console.log(`[watermark.js] Watermark resized successfully. New buffer size: ${resizedWatermarkBuffer.length}`);

        const watermarkedBuffer = await mainImage
            .composite([
                { input: resizedWatermarkBuffer, gravity: 'center' }
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