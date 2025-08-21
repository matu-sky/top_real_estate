const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

console.log('[watermark.js] Module loaded');

let fontBuffer;
try {
    const fontPath = path.resolve(__dirname, '../public/fonts/noto-sans-kr-korean-400-normal.woff2');
    console.log(`[watermark.js] Reading font from: ${fontPath}`);
    fontBuffer = fs.readFileSync(fontPath);
    console.log('[watermark.js] Font file read successfully.');
} catch (error) {
    console.error('[watermark.js] CRITICAL: Failed to read font file.', error);
    throw error; // Re-throw to stop the process if font is essential
}

const fontBase64 = fontBuffer.toString('base64');
console.log('[watermark.js] Font file converted to base64.');

async function addWatermark(imageBuffer) {
    console.log('[watermark.js] addWatermark function called.');
    try {
        const metadata = await sharp(imageBuffer).metadata();
        const imageWidth = metadata.width;
        const imageHeight = metadata.height;
        console.log(`[watermark.js] Image dimensions: ${imageWidth}x${imageHeight}`);

        const watermarkTextKR = '군포첨단 탑공인중개사';
        const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';

        const mainFontSize = Math.max(24, Math.floor(imageWidth / 20));
        const subFontSize = Math.max(12, Math.floor(imageWidth / 50));
        console.log(`[watermark.js] Calculated font sizes: main=${mainFontSize}, sub=${subFontSize}`);

        const svg = `
        <svg width="${imageWidth}" height="${imageHeight}">
          <style>
            @font-face {
              font-family: 'Noto Sans KR';
              src: url(data:font/woff2;base64,${fontBase64}) format('woff2');
              font-weight: normal;
              font-style: normal;
            }
            .title-kr {
              fill: rgba(255, 255, 255, 0.7);
              font-size: ${mainFontSize}px;
              font-weight: bold;
              font-family: 'Noto Sans KR', sans-serif;
            }
            .title-en {
              fill: rgba(255, 255, 255, 0.6);
              font-size: ${subFontSize}px;
              font-family: 'Noto Sans KR', sans-serif;
            }
          </style>
          <text x="50%" y="50%" dy=".3em" text-anchor="middle" class="title-kr">${watermarkTextKR}</text>
          <text x="98%" y="98%" dy=".3em" text-anchor="end" class="title-en">${watermarkTextEN}</text>
        </svg>`;
        console.log('[watermark.js] SVG created.');

        const svgBuffer = Buffer.from(svg);

        const watermarkedBuffer = await sharp(imageBuffer)
            .composite([
                { input: svgBuffer, gravity: 'center' }
            ])
            .toBuffer();
        console.log('[watermark.js] Watermark composited successfully.');

        return watermarkedBuffer;
    } catch (error) {
        console.error('[watermark.js] Error during watermark processing:', error);
        // Return original buffer to prevent breaking the upload flow
        return imageBuffer; 
    }
}

module.exports = { addWatermark };
