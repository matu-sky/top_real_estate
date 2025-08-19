const { SitemapStream, streamToPromise } = require('sitemap');
const { Readable } = require('stream');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

const generateSitemap = async () => {
    const client = await pool.connect();
    try {
        const links = [];
        const baseUrl = 'https://top-real-estate-netlify.netlify.app'; // 실제 도메인으로 변경 필요

        // 1. 고정 페이지
        links.push({ url: '/', changefreq: 'daily', priority: 1.0 });
        links.push({ url: '/properties', changefreq: 'daily', priority: 0.8 });
        links.push({ url: '/consulting_portal', changefreq: 'monthly', priority: 0.7 });

        // 2. 'pages' 테이블의 동적 페이지
        const pages = await client.query("SELECT slug FROM pages");
        pages.rows.forEach(page => {
            links.push({ url: `/page/${page.slug}`, changefreq: 'weekly', priority: 0.6 });
        });

        // 3. 매물 상세 페이지
        const properties = await client.query("SELECT id FROM properties");
        properties.rows.forEach(prop => {
            links.push({ url: `/property/${prop.id}`, changefreq: 'weekly', priority: 0.9 });
        });

        // 4. 게시판 목록 페이지
        const boards = await client.query("SELECT slug FROM boards");
        boards.rows.forEach(board => {
            links.push({ url: `/board/${board.slug}`, changefreq: 'daily', priority: 0.8 });
        });

        // 5. 게시글 상세 페이지
        const posts = await client.query("SELECT p.id, b.slug FROM posts p JOIN boards b ON p.board_id = b.id");
        posts.rows.forEach(post => {
            links.push({ url: `/board/${post.slug}/${post.id}`, changefreq: 'weekly', priority: 0.7 });
        });

        const stream = new SitemapStream({ hostname: baseUrl });
        const xml = await streamToPromise(Readable.from(links).pipe(stream)).then((data) =>
            data.toString()
        );

        const sitemapPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
        await fs.writeFile(sitemapPath, xml);

        console.log('Sitemap generated successfully!');
        return { success: true, path: sitemapPath };

    } catch (error) {
        console.error('Error generating sitemap:', error);
        return { success: false, error };
    } finally {
        client.release();
    }
};

// 로컬에서 직접 실행하여 사이트맵을 생성할 수 있도록 함
if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    generateSitemap().then(() => pool.end());
}

module.exports = { generateSitemap };
