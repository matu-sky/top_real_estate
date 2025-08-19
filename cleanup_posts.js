
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

function unescapeHtml(str) {
    if (str === null || str === undefined) {
        return '';
    }
    let unescaped = str;
    // 반복적으로 unescape를 수행하여 다중으로 이스케이프된 경우를 처리
    for (let i = 0; i < 5; i++) { // 최대 5번 반복
        unescaped = unescaped
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        if (!unescaped.includes('&lt;') && !unescaped.includes('&gt;')) {
            break;
        }
    }
    return unescaped;
}

async function cleanupPosts() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('데이터베이스 정화 작업을 시작합니다...');

        const res = await client.query('SELECT id, content FROM posts');
        let updatedCount = 0;

        for (const post of res.rows) {
            const originalContent = post.content;
            const cleanedContent = unescapeHtml(originalContent);

            if (originalContent !== cleanedContent) {
                await client.query('UPDATE posts SET content = $1 WHERE id = $2', [cleanedContent, post.id]);
                console.log(`Post ID ${post.id}의 내용이 수정되었습니다.`);
                updatedCount++;
            }
        }

        await client.query('COMMIT');
        console.log(`총 ${updatedCount}개의 게시글이 업데이트되었습니다.`);
        console.log('데이터베이스 정화 작업이 완료되었습니다.');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('오류가 발생하여 롤백되었습니다:', err);
    } finally {
        client.release();
        pool.end();
    }
}

cleanupPosts();
