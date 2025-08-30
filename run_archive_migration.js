require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');

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
        console.log('데이터베이스 제약조건 마이그레이션을 시작합니다...');
        client = await pool.connect();
        
        const sql = await fs.readFile(path.join(__dirname, 'migrations', '003_update_board_type_constraint.sql'), 'utf-8');
        console.log('실행할 SQL:\n', sql);
        
        await client.query(sql);
        console.log('✅ CHECK 제약조건이 성공적으로 업데이트되었습니다.');

    } catch (err) {
        console.error('❌ 마이그레이션 중 오류가 발생했습니다:', err);
        throw err;
    } finally {
        if (client) {
            await client.release();
            console.log('데이터베이스 연결이 종료되었습니다.');
        }
        await pool.end();
    }
}

migrate().catch(err => {
    console.error("마이그레이션 스크립트 실행 중 예외 발생:", err);
    process.exit(1);
});
