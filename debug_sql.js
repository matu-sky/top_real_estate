require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const testQuery = 'CREATE POLICY "Allow admin management of inquiries" ON public.inquiries FOR SELECT, UPDATE, DELETE USING ((select auth.role()) = $$authenticated$$);';

async function runTest() {
    let client;
    try {
        console.log('마지막 디버깅 쿼리를 실행합니다...');
        client = await pool.connect();
        await client.query('DROP POLICY IF EXISTS "Allow admin management of inquiries" ON public.inquiries;');
        await client.query(testQuery);
        console.log('✅ 디버깅 쿼리 성공!');
    } catch (err) {
        console.error('❌ 디버깅 쿼리 실패:', err);
    } finally {
        if (client) {
            await client.release();
        }
        await pool.end();
        console.log('데이터베이스 연결이 종료되었습니다.');
    }
}

runTest();
