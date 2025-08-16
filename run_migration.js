require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');

// 데이터베이스 연결 설정 (server.js와 동일하게)
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    let client;
    try {
        console.log('데이터베이스 마이그레이션을 시작합니다...');
        client = await pool.connect();
        
        const sqlFilePath = path.join(__dirname, 'setup_inquiries.sql');
        const sql = await fs.readFile(sqlFilePath, 'utf-8');
        
        console.log("'inquiries' 테이블 생성 SQL을 실행합니다...");
        await client.query(sql);
        console.log("✅ 'inquiries' 테이블이 성공적으로 생성되었거나 이미 존재합니다.");

    } catch (err) {
        console.error('❌ 마이그레이션 중 오류가 발생했습니다:', err);
    } finally {
        if (client) {
            await client.release();
            console.log('데이터베이스 연결이 종료되었습니다.');
        }
        await pool.end();
    }
}

migrate();
