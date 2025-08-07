
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// .env 파일에 PG_HOST, PG_USER 등이 설정되어 있어야 합니다.
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    const client = await pool.connect();
    console.log('데이터베이스에 연결되었습니다.');

    try {
        // 1. setup_db.sql 파일 읽기
        const sql = fs.readFileSync(path.join(__dirname, 'setup_db.sql'), 'utf8');
        // 2. SQL 쿼리 실행
        await client.query(sql);
        console.log('성공: "setup_db.sql" 파일의 모든 쿼리를 실행했습니다.');

        // 3. homepage_content.json 파일 읽기
        const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
        const data = fs.readFileSync(contentPath, 'utf8');
        const content = JSON.parse(data);
        console.log('성공: "homepage_content.json" 파일을 읽었습니다.');

        // 4. JSON 데이터를 데이터베이스에 삽입/업데이트
        for (const [key, value] of Object.entries(content)) {
            // 값이 객체나 배열이면 JSON 문자열로 변환, 아니면 그대로 사용
            const valueToStore = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : value;
            
            await client.query(
                'INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                [key, valueToStore]
            );
        }
        console.log('성공: 모든 콘텐츠를 "site_settings" 테이블로 이전했습니다.');

        // 5. 기본 페이지 데이터 삽입
        const pages = [
            { slug: 'privacy-policy', title: '개인정보처리방침', content: '<h1>개인정보처리방침</h1><p>내용을 입력해주세요.</p>' },
            { slug: 'reject-email-collection', title: '이메일무단수집거부', content: '<h1>이메일무단수집거부</h1><p>내용을 입력해주세요.</p>' },
            { slug: 'terms-of-service', title: '이용약관', content: '<h1>이용약관</h1><p>내용을 입력해주세요.</p>' },
            { slug: 'lifestyle-1', title: '라이프스타일 제안 1', content: '<h1>라이프스타일 제안 1</h1><p>내용을 입력해주세요.</p>' },
            { slug: 'lifestyle-2', title: '라이프스타일 제안 2', content: '<h1>라이프스타일 제안 2</h1><p>내용을 입력해주세요.</p>' },
            { slug: 'lifestyle-3', title: '라이프스타일 제안 3', content: '<h1>라이프스타일 제안 3</h1><p>내용을 입력해주세요.</p>' }
        ];

        for (const page of pages) {
            await client.query(
                'INSERT INTO pages (slug, title, content) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING',
                [page.slug, page.title, page.content]
            );
        }
        console.log('성공: 기본 페이지 데이터를 "pages" 테이블에 삽입했습니다.');

        console.log('--------------------------------------------------');
        console.log('데이터베이스 설정 및 데이터 이전이 완료되었습니다.');
        console.log('--------------------------------------------------');

    } catch (err) {
        console.error('오류: 데이터베이스 설정 중 문제가 발생했습니다.', err.stack);
    } finally {
        console.log('데이터베이스 연결을 종료합니다.');
        await client.release();
        await pool.end();
    }
}

setupDatabase();
