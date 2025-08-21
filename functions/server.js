const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(projectRoot, '.env') });
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const serverless = require('serverless-http');
const querystring = require('querystring');
const bcrypt = require('bcrypt');
const fs = require('fs');
const util = require('util');
const readdir = util.promisify(fs.readdir);
const { getYouTubeVideoId, getYouTubeThumbnailUrl } = require('./utils.js');
const { generateSitemap } = require('./sitemapGenerator.js');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const { addWatermark } = require('./watermark.js');

const app = express();
const { Pool } = require('pg');
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    const errorMessage = 'Supabase URL and Anon Key are required.';
    throw new Error(errorMessage);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const pgSession = require('connect-pg-simple')(session);

app.use(express.urlencoded({ extended: true }));

const store = new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
});

app.use(session({
    store: store,
    secret: process.env.SESSION_SECRET || 'a-more-secure-secret-key-for-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        secure: true,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

const viewsPath = path.resolve(projectRoot, 'views');
app.set('views', viewsPath);
app.set('view options', { root: viewsPath });
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.locals.basedir = viewsPath;

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
        res.locals.menus = [
            { name: '대시보드', url: '/dashboard' },
            { name: '홈페이지 관리', url: '/admin' },
            { name: '매물 관리', url: '/listings' },
            { name: '게시판 설정', url: '/admin/board_settings' },
            { name: '메뉴 관리', url: '/admin/menu' },
            { name: '페이지 관리', url: '/admin/pages' },
            { name: '문의보기', url: '/admin/inquiries' },
            { name: '계정 설정', url: '/admin/settings' }
        ];
        res.locals.user = { loggedin: req.session.loggedin };
        next();
    } catch (err) {
        console.error('설정 로드 오류:', err);
        res.status(500).send('사이트 설정을 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
}

const router = express.Router();
router.use(loadSettings);

function requireLogin(req, res, next) {
    if (!req.session.loggedin) {
        return res.redirect('/login');
    }
    next();
}

// --- Public Routes ---
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
                properties.push({ id: 0, title: `${categories[i]} 매물 없음`, category: categories[i], price: '-', short_address: '등록된 매물이 없습니다.', image_path: '/images/default_property.jpg', is_placeholder: true });
            }
        }
        const youtubePostResult = await client.query(`SELECT p.id, p.title, p.thumbnail_url, b.slug as board_slug FROM posts p JOIN boards b ON p.board_id = b.id WHERE b.slug = 'utube' ORDER BY p.created_at DESC LIMIT 1;`);
        const youtubePost = youtubePostResult.rows[0];
        const recentPostsResult = await client.query(`SELECT p.id, p.title, p.created_at, b.slug as board_slug, b.name as board_name FROM posts p JOIN boards b ON p.board_id = b.id WHERE b.slug IN ('notice', 'rearinfo') ORDER BY p.created_at DESC LIMIT 5;`);
        const recentPosts = recentPostsResult.rows;
        res.render('index', { content: res.locals.settings, properties, youtubePost, recentPosts });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.render('index', { content: res.locals.settings, properties: [], youtubePost: null, recentPosts: [] });
    } finally {
        if (client) client.release();
    }
});

router.get('/login', (req, res) => { res.render('login'); });

router.post('/login', async (req, res) => {
    let body = req.body instanceof Buffer ? querystring.parse(req.body.toString()) : req.body;
    const { username, password } = body;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password_hash);
            if (match) {
                req.session.loggedin = true;
                req.session.username = username;
                res.redirect('/admin');
            } else {
                res.send('Incorrect Username and/or Password!');
            }
        } else {
            res.send('Incorrect Username and/or Password!');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('An error occurred during login.');
    } finally {
        if (client) client.release();
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) { return res.redirect('/admin'); }
        res.redirect('/');
    });
});

// ... (All other routes from original file) ...

router.post('/listings/add', requireLogin, upload.array('images', 10), async (req, res) => {
    let body = req.body instanceof Buffer ? querystring.parse(req.body.toString()) : req.body;
    const imageUrls = [];
    if (req.files) {
        for (const file of req.files) {
            const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const newFileName = `${Date.now()}_${encodeURIComponent(originalname_utf8)}`;
            const watermarkedBuffer = await addWatermark(file.buffer);
            const { error } = await supabase.storage.from('property-images').upload(newFileName, watermarkedBuffer, { contentType: file.mimetype });
            if (error) { console.error('Supabase..._error:', error); return res.status(500).send('...'); }
            const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(newFileName);
            imageUrls.push(publicUrl);
        }
    }
    const image_paths = imageUrls.join(',');
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = body;
    const query = `INSERT INTO properties (category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_path, youtube_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25) RETURNING id;`;
    const params = [category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url];
    let client;
    try {
        client = await pool.connect();
        await client.query(query, params);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삽입 오류:', err.stack);
        res.status(500).send(`...`);
    } finally {
        if (client) client.release();
    }
});

// ... (and all other routes, restored) ...

app.use('/', router);
module.exports.handler = serverless(app);

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}
