require('dotenv').config();
console.log('--- Netlify Function Environment ---');
console.log('Attempting to read SUPABASE_URL:', process.env.SUPABASE_URL ? 'Found' : 'Not Found');
console.log('Attempting to read SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'Found' : 'Not Found');
console.log('Type of SUPABASE_URL:', typeof process.env.SUPABASE_URL);
console.log('Type of SUPABASE_ANON_KEY:', typeof process.env.SUPABASE_ANON_KEY);
console.log('------------------------------------');
const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const serverless = require('serverless-http');
const querystring = require('querystring');
const fs = require('fs');
const util = require('util');
const readdir = util.promisify(fs.readdir);

// 디버깅: 재귀적으로 디렉토리 목록을 가져오는 함수
async function getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files);
}

const app = express();
const projectRoot = path.resolve(__dirname, '..');

const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

// --- 데이터베이스 기반 설정 로더 ---
async function getSettings(client) {
    const result = await client.query('SELECT key, value FROM site_settings');
    const settings = {};
    for (const row of result.rows) {
        try {
            settings[row.key] = JSON.parse(row.value);
        } catch (e) {
            settings[row.key] = row.value;
        }
    }
    return settings;
}

const { createClient } = require('@supabase/supabase-js');

// --- Supabase 클라이언트 초기화 ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// 환경 변수 누락 시 명확한 에러 메시지 출력
if (!supabaseUrl || !supabaseAnonKey) {
    const errorMessage = 'Supabase URL and Anon Key are required. Check your Netlify environment variables.';
    console.error(errorMessage);
    throw new Error(errorMessage);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- 파일 업로드 설정 (메모리 스토리지 사용) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- 미들웨어 설정 ---
app.use(express.urlencoded({ extended: true }));


// 세션 미들웨어 설정
app.use(session({
    secret: 'your-secret-key', // 실제 프로덕션 환경에서는 강력한 키 사용
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // HTTPS를 사용한다면 true로 변경
}));

// --- 뷰 엔진 설정 ---
const viewsPath = path.resolve(projectRoot, 'views');
app.set('views', viewsPath);
app.set('view options', { root: viewsPath });
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.locals.basedir = viewsPath;


// 모든 페이지에 설정을 로드하는 미들웨어
async function loadSettings(req, res, next) {
    let client;
    try {
        client = await pool.connect();
        res.locals.settings = await getSettings(client);

        let dbMenus = res.locals.settings.header_nav_links;

        if (!Array.isArray(dbMenus) || dbMenus.length === 0) {
            dbMenus = [
                { text: '라이프스타일 제안', url: '/#lifestyle' },
                { text: '최신 매물', url: '/#recent-listings' },
                { text: '전체 매물', url: '/properties' },
                { text: '커뮤니티센터', url: '/board/notice' },
                { text: '컨설팅 상담신청', url: '/#about' },
                { text: '오시는 길', url: '/#location' }
            ];
        }

        res.locals.settings.header_nav_links = dbMenus;

        // 관리자 페이지 사이드바 메뉴
        res.locals.menus = [
            { name: '대시보드', url: '/dashboard' },
            { name: '홈페이지 관리', url: '/admin' },
            { name: '매물 관리', url: '/listings' },
            { name: '게시판 설정', url: '/admin/board_settings' },
            { name: '메뉴 관리', url: '/admin/menu' },
            { name: '퀵메뉴 관리', url: '/admin/quick-menu' },
            { name: '페이지 관리', url: '/admin/pages' }
        ];
        next();
    } catch (err) {
        console.error('설정 로드 오류:', err);
        res.status(500).send('사이트 설정을 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
}

// --- 라우팅(Routing) ---
const router = express.Router();

router.use(loadSettings);

router.get('/', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const residentialResult = await client.query("SELECT * FROM properties WHERE category = '주거용' ORDER BY created_at DESC LIMIT 1");
        const commercialResult = await client.query("SELECT * FROM properties WHERE category = '상업용' ORDER BY created_at DESC LIMIT 1");
        const industrialResult = await client.query("SELECT * FROM properties WHERE category = '공장/지산' ORDER BY created_at DESC LIMIT 1");

        const properties = [];
        const categories = ['주거용', '상업용', '공장/지산'];
        const results = [residentialResult, commercialResult, industrialResult];

        for (let i = 0; i < categories.length; i++) {
            if (results[i].rows.length > 0) {
                const property = results[i].rows[0];
                if (property.address) {
                    property.short_address = property.address.split(' ').slice(0, 3).join(' ');
                }
                properties.push(property);
            } else {
                properties.push({
                    id: 0,
                    title: `${categories[i]} 매물 없음`,
                    category: categories[i],
                    price: '-',
                    short_address: '등록된 매물이 없습니다.',
                    image_path: '/images/default_property.jpg',
                    is_placeholder: true
                });
            }
        }

        const youtubePostResult = await client.query(`
            SELECT p.id, p.title, p.thumbnail_url, b.slug as board_slug
            FROM posts p
            JOIN boards b ON p.board_id = b.id
            WHERE b.slug = 'utube'
            ORDER BY p.created_at DESC
            LIMIT 1;
        `);
        const youtubePost = youtubePostResult.rows[0];

        const recentPostsResult = await client.query(`
            SELECT p.id, p.title, p.created_at, b.slug as board_slug, b.name as board_name
            FROM posts p
            JOIN boards b ON p.board_id = b.id
            WHERE b.slug IN ('notice', 'rearinfo')
            ORDER BY p.created_at DESC
            LIMIT 5;
        `);
        const recentPosts = recentPostsResult.rows;

        res.render('index', { 
            content: res.locals.settings, 
            properties, 
            youtubePost, 
            recentPosts 
        });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.render('index', { 
            content: res.locals.settings, 
            properties: [], 
            youtubePost: null, 
            recentPosts: [] 
        });
    } finally {
        if (client) client.release();
    }
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.post('/login', (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    const { username, password } = body;

    if (username === 'as123' && password === 'asd123') {
        req.session.loggedin = true;
        res.redirect('/admin');
    } else {
        res.send('Incorrect Username and/or Password!');
    }
});

function requireLogin(req, res, next) {
    if (!req.session.loggedin) {
        return res.redirect('/login');
    }
    next();
}

router.use('/admin', requireLogin);
router.use('/dashboard', requireLogin);
router.use('/listings', requireLogin);
router.use('/add_property', requireLogin);

router.get('/admin', (req, res) => {
    res.render('admin', { content: res.locals.settings, menus: res.locals.menus });
});

router.post('/admin/update', requireLogin, async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        for (const key in body) {
            if (Object.prototype.hasOwnProperty.call(res.locals.settings, key)) {
                const valueToStore = body[key];
                await client.query(
                    'UPDATE site_settings SET value = $1 WHERE key = $2',
                    [valueToStore, key]
                );
            }
        }

        await client.query('COMMIT');
        res.redirect('/admin');

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('DB 업데이트 오류:', err.stack);
        res.status(500).send('콘텐츠 업데이트에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/admin');
        }
        res.redirect('/');
    });
});

router.get('/dashboard', async (req, res) => {
    const client = await pool.connect();
    try {
        const totalQuery = "SELECT COUNT(*) AS count FROM properties";
        const categoryQuery = "SELECT category, COUNT(*) AS count FROM properties GROUP BY category";

        const totalResult = await client.query(totalQuery);
        const categoryResult = await client.query(categoryQuery);

        res.render('dashboard', { 
            menus: res.locals.menus, 
            stats: {
                total: totalResult.rows[0].count,
                byCategory: categoryResult.rows
            }
        });
    } catch (err) {
        console.error('대시보드 데이터 조회 오류:', err.stack);
        res.status(500).send("데이터베이스 오류");
    } finally {
        client.release();
    }
});

router.get('/admin/board_settings', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM boards ORDER BY created_at DESC');
        res.render('board_settings', { menus: res.locals.menus, boards: result.rows });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('게시판 목록을 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/admin/pages', requireLogin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM pages ORDER BY created_at DESC');
        res.render('page_management', { menus: res.locals.menus, pages: result.rows });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('페이지 목록을 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/page/:slug', async (req, res) => {
    const { slug } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM pages WHERE slug = $1', [slug]);
        if (result.rows.length === 0) {
            return res.status(404).send('페이지를 찾을 수 없습니다.');
        }
        const page = result.rows[0];
        if (page.content) {
            page.content = page.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        }
        res.render('page', { content: res.locals.settings, page });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('페이지를 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/admin/menu', requireLogin, (req, res) => {
    res.render('menu_settings', { menus: res.locals.menus, content: res.locals.settings });
});

router.post('/admin/menu/update', requireLogin, async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    
    const { link_texts, link_urls } = body;
    const newLinks = [];

    if (link_texts && link_urls) {
        const texts = Array.isArray(link_texts) ? link_texts : [link_texts];
        const urls = Array.isArray(link_urls) ? link_urls : [link_urls];

        for (let i = 0; i < texts.length; i++) {
            if (texts[i] && urls[i]) {
                newLinks.push({ text: texts[i], url: urls[i] });
            }
        }
    }

    const valueToStore = JSON.stringify(newLinks);
    let client;
    try {
        client = await pool.connect();
        await client.query(
            "INSERT INTO site_settings (key, value) VALUES ('header_nav_links', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [valueToStore]
        );
        res.redirect('/admin/menu');
    } catch (err) {
        console.error('DB 업데이트 오류 (메뉴):', err.stack);
        res.status(500).send('메뉴 저장에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/admin/quick-menu', requireLogin, (req, res) => {
    res.render('quick_menu_settings', { 
        menus: res.locals.menus, 
        content: res.locals.settings 
    });
});

router.post('/admin/quick-menu/update', requireLogin, async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    
    const { link_texts, link_urls } = body;
    const newLinks = [];

    if (link_texts && link_urls) {
        const texts = Array.isArray(link_texts) ? link_texts : [link_texts];
        const urls = Array.isArray(link_urls) ? link_urls : [link_urls];

        for (let i = 0; i < texts.length; i++) {
            if (texts[i] && urls[i]) {
                newLinks.push({ text: texts[i], url: urls[i] });
            }
        }
    }

    const valueToStore = JSON.stringify(newLinks);
    let client;
    try {
        client = await pool.connect();
        await client.query(
            "INSERT INTO site_settings (key, value) VALUES ('quick_menu_links', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [valueToStore]
        );
        res.redirect('/admin/quick-menu');
    } catch (err) {
        console.error('DB 업데이트 오류 (퀵메뉴):', err.stack);
        res.status(500).send('퀵메뉴 저장에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

app.use('/', router);

module.exports.handler = serverless(app);

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}