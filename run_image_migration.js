// run_image_migration.js

// 1. 환경 설정
require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const { addWatermark } = require('./functions/watermark.js');

// 2. 클라이언트 초기화
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 3. 메인 함수
async function migrateImages() {
    const client = await pool.connect();
    try {
        console.log('기존 이미지에 대한 최적화 작업을 시작합니다...');

        // 이미지가 있는 모든 매물 정보를 가져옵니다.
        const { rows: properties } = await client.query(`SELECT id, image_path FROM properties WHERE image_path IS NOT NULL AND image_path != ''`);
        console.log(`${properties.length}개의 매물에서 이미지를 발견했습니다.`);

        for (const property of properties) {
            const oldImageUrls = property.image_path.split(',').filter(url => url);
            if (oldImageUrls.length === 0) {
                continue;
            }

            console.log(`\n[매물 ID: ${property.id}] ${oldImageUrls.length}개의 이미지를 처리합니다.`);
            const newImageUrls = [];
            const oldFileNamesToDelete = [];

            for (const oldUrl of oldImageUrls) {
                // 이미 WebP 형식으로 최적화된 이미지는 건너뜁니다.
                if (oldUrl.includes('.webp')) {
                    console.log(`- [SKIP] 이미 최적화된 이미지입니다: ${oldUrl}`);
                    newImageUrls.push(oldUrl);
                    continue;
                }
                
                try {
                    // 기존 이미지 다운로드
                    console.log(`- [DOWNLOAD] ${oldUrl}`);
                    const response = await axios.get(oldUrl, { responseType: 'arraybuffer' });
                    const imageBuffer = Buffer.from(response.data, 'binary');

                    // 새 파일 이름 생성 (확장자 .webp로 변경)
                    const oldFileNameWithQuery = oldUrl.split('/').pop();
                    const oldFileName = oldFileNameWithQuery.split('?')[0]; // 쿼리 스트링 제거
                    const baseName = path.basename(oldFileName, path.extname(oldFileName));
                    const newFileName = `${baseName}_${Date.now()}.webp`;

                    // 이미지 최적화 및 워터마크 적용
                    console.log(`- [PROCESS] 이미지 최적화 및 워터마크 적용 중...`);
                    const optimizedBuffer = await sharp(imageBuffer)
                        .resize({ width: 1200, withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toBuffer();
                    const finalBuffer = await addWatermark(optimizedBuffer);

                    // 최적화된 새 이미지 업로드
                    console.log(`- [UPLOAD] 새 파일 업로드: ${newFileName}`);
                    const { error: uploadError } = await supabase.storage
                        .from('property-images')
                        .upload(newFileName, finalBuffer, { contentType: 'image/webp' });

                    if (uploadError) {
                        throw new Error(`Supabase 업로드 실패: ${uploadError.message}`);
                    }

                    // 새 이미지의 Public URL 가져오기
                    const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(newFileName);
                    newImageUrls.push(publicUrl);
                    oldFileNamesToDelete.push(oldFileName);
                    console.log(`- [SUCCESS] 새 URL: ${publicUrl}`);

                } catch (err) {
                    console.error(`- [ERROR] 이미지 처리 실패 ${oldUrl}. 원본 URL을 유지합니다. 오류: ${err.message}`);
                    newImageUrls.push(oldUrl); // 에러 발생 시, 기존 URL 유지
                }
            }

            // 데이터베이스의 이미지 경로를 새로운 URL 목록으로 업데이트
            const newImagePaths = newImageUrls.join(',');
            await client.query('UPDATE properties SET image_path = $1 WHERE id = $2', [newImagePaths, property.id]);
            console.log(`\n[DB UPDATE] 매물 ID: ${property.id} 의 이미지 경로를 업데이트했습니다.`);

            // 기존의 대용량 원본 파일 삭제
            if (oldFileNamesToDelete.length > 0) {
                console.log(`- [DELETE] ${oldFileNamesToDelete.length}개의 기존 이미지 파일을 삭제합니다...`);
                const { data, error } = await supabase.storage.from('property-images').remove(oldFileNamesToDelete);
                if (error) {
                    console.error('- [ERROR] 기존 파일 삭제 실패:', error.message);
                } else {
                    console.log('- [SUCCESS] 기존 파일들을 성공적으로 삭제했습니다.');
                }
            }
        }

        console.log('\n모든 이미지의 최적화 작업이 성공적으로 완료되었습니다!');

    } catch (error) {
        console.error('\n이미지 마이그레이션 도중 심각한 오류가 발생했습니다:', error);
    } finally {
        await client.release();
        await pool.end();
        console.log('데이터베이스 연결을 종료합니다.');
    }
}

// 마이그레이션 스크립트 실행
migrateImages();