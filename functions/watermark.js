const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Load both watermark images
let watermarkCenterBuffer;
let watermarkBottomRightBuffer;

try {
    const watermarkCenterPath = path.resolve(__dirname, '../public/images/watermark.png');
    watermarkCenterBuffer = fs.readFileSync(watermarkCenterPath);

    const watermarkBottomRightPath = path.resolve(__dirname, '../public/images/watermark_bottom_right.png');
    watermarkBottomRightBuffer = fs.readFileSync(watermarkBottomRightPath);
} catch (error) {
    console.error('[watermark.js] CRITICAL: Failed to read one or more watermark images.', error);
    throw error;
}

async function addWatermark(imageBuffer) {
    try {
        const mainImage = sharp(imageBuffer);
        const mainMetadata = await mainImage.metadata();

        // --- Center Watermark Logic ---
        const centerWatermark = sharp(watermarkCenterBuffer);
        const centerWatermarkMetadata = await centerWatermark.metadata();
        // Resize center watermark to 50% of main image width, but not larger than its original size
        const centerWatermarkWidth = Math.min(Math.floor(mainMetadata.width * 0.5), centerWatermarkMetadata.width);
        const resizedCenterWatermarkBuffer = await centerWatermark
            .resize({ width: centerWatermarkWidth })
            .toBuffer();

        // --- Bottom-Right Watermark Logic ---
        const bottomRightWatermark = sharp(watermarkBottomRightBuffer);
        const bottomRightWatermarkMetadata = await bottomRightWatermark.metadata();
        // Resize bottom-right watermark to 30% of main image width, but not larger than its original size
        const bottomRightWatermarkWidth = Math.min(Math.floor(mainMetadata.width * 0.3), bottomRightWatermarkMetadata.width);
        const resizedBottomRightWatermarkBuffer = await bottomRightWatermark
            .resize({ width: bottomRightWatermarkWidth })
            .toBuffer();

        // Composite both watermarks in a single call
        const watermarkedBuffer = await mainImage
            .composite([
                { input: resizedCenterWatermarkBuffer, gravity: 'center' },
                { input: resizedBottomRightWatermarkBuffer, gravity: 'southeast' }
            ])
            .toBuffer();

        return watermarkedBuffer;
    } catch (error) {
        console.error('[watermark.js] Error during watermark composition:', error);
        // On error, return the original image to avoid breaking the upload
        return imageBuffer;
    }
}

module.exports = { addWatermark };
