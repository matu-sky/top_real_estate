require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});
pool.query("SELECT value FROM site_settings WHERE key = 'header_nav_links'", (err, res) => {
    if (err) {
        console.error('DB 조회 오류:', err.stack);
    } else {
        console.log('--- 현재 메뉴 설정 ---');
        console.log(res.rows[0] ? res.rows[0].value : '메뉴 데이터 없음');
        console.log('-------------------');
    }
    pool.end();
});