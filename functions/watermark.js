const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Path to the font file
const fontPath = path.resolve(__dirname, '../node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2');

// Read the font file into a buffer
const fontBuffer = fs.readFileSync(fontPath);

// Convert the font buffer to a base64 string
const fontBase64 = fontBuffer.toString('base64');

async function addWatermark(imageBuffer) {
    const metadata = await sharp(imageBuffer).metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

    const watermarkTextKR = '군포첨단 탑공인중개사';
    const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';

    // Dynamically adjust font size based on image width
    const mainFontSize = Math.max(24, Math.floor(imageWidth / 20));
    const subFontSize = Math.max(12, Math.floor(imageWidth / 50));

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

    const svgBuffer = Buffer.from(svg);

    const watermarkedBuffer = await sharp(imageBuffer)
        .composite([
            { input: svgBuffer, gravity: 'center' }
        ])
        .toBuffer();

    return watermarkedBuffer;
}

module.exports = { addWatermark };
