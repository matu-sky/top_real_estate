
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const serverless = require('serverless-http');
const querystring = require('querystring');
const fs = require('fs');
const util = require('util');
const readdir = util.promisify(fs.readdir);
const nodemailer = require('nodemailer');

const app = express();
const projectRoot = path.resolve(__dirname, '..');

// --- Nodemailer 설정 ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'bongsang1962@gmail.com',
        pass: 'gpngapanvvagwips'
    }
});

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
    console.error(errorMessage);
    throw new Error(errorMessage);
}
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // JSON 요청 본문을 파싱하기 위해 추가
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
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
            { name: '상담 신청 관리', url: '/admin/consultations' },
            { name: '홈페이지 관리', url: '/admin' },
            { name: '매물 관리', url: '/listings' },
            { name: '게시판 설정', url: '/admin/board_settings' },
            { name: '주거용 매물등록', url: '/add_property' },
            { name: '메뉴 관리', url: '/admin/menu' },
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

const router = express.Router();
router.use(loadSettings);

// ... (기존 라우트들은 여기에 유지)

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

// --- 상세 상담 폼 관련 ---
router.get('/consultation/form/:requestId', async (req, res) => {
    const { requestId } = req.params;
    res.render('detailed_form', { content: res.locals.settings, requestId: requestId });
});

router.post('/consultation/form/submit', async (req, res) => {
    const {
        requestId,
        property_type,
        desired_area,
        budget,
        rooms,
        business_type,
        required_area,
        other_requests
    } = req.body;

    const query = `
        INSERT INTO consultation_details 
        (request_id, property_type, desired_area, budget, rooms, business_type, required_area, other_requests)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    const params = [
        requestId,
        property_type,
        desired_area,
        budget,
        rooms || null,
        business_type || null,
        required_area || null,
        other_requests || null
    ];

    let client;
    try {
        client = await pool.connect();
        await client.query(query, params);
        res.send('상세 정보가 성공적으로 제출되었습니다. 감사합니다.');
    } catch (err) {
        console.error('DB 삽입 오류 (상세 상담 정보):', err.stack);
        res.status(500).send('정보 제출 중 오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});

// --- 상담 신청 관리 ---
router.get('/admin/consultations', requireLogin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM consultation_requests ORDER BY created_at DESC');
        res.render('admin_consultations', { menus: res.locals.menus, requests: result.rows });
    } catch (err) {
        console.error('DB 조회 오류 (상담 신청 목록):', err.stack);
        res.status(500).send('상담 신청 목록을 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// --- 컨설팅 접수 포털 ---
router.get('/consulting_portal', (req, res) => {
    res.render('consulting_portal', { content: res.locals.settings });
});

router.get('/request_contact', (req, res) => {
    const type = req.query.type || '기타문의';
    res.render('request_contact', { type, content: res.locals.settings });
});

router.post('/request_contact/submit', async (req, res) => {
    const { type, name, contact_method, email, phone } = req.body;
    const contact_info = contact_method === 'email' ? email : phone;

    const query = `
        INSERT INTO consultation_requests (consultation_type, customer_name, contact_method, contact_info)
        VALUES ($1, $2, $3, $4)
        RETURNING id
    `;
    const params = [type, name, contact_method, contact_info];

    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, params);
        const newRequestId = result.rows[0].id;

        console.log('--- 새로운 상담 접수 (DB 저장 완료) ---');
        console.log('Request ID:', newRequestId);

        if (contact_method === 'email' && email) {
            const siteUrl = process.env.URL || 'http://localhost:8888';
            const formLink = `${siteUrl}/consultation/form/${newRequestId}`;

            const mailOptions = {
                from: '"탑부동산" <bongsang1962@gmail.com>',
                to: email,
                subject: '[탑부동산] 상담 접수 완료 및 상세 정보 입력 요청',
                html: `
                    <p>안녕하세요, ${name}님. 탑부동산에 상담을 신청해주셔서 감사합니다.</p>
                    <p>정확한 상담을 위해 아래 링크를 클릭하여 상세 정보를 입력해주시면, 더 빠르고 정확한 안내를 도와드릴 수 있습니다.</p>
                    <a href="${formLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">상세 정보 입력하기</a>
                    <p>감사합니다.</p>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('이메일 발송 오류:', JSON.stringify(error, null, 2));
                } else {
                    console.log('상세 정보 입력 요청 이메일 발송 완료:', JSON.stringify(info, null, 2));
                }
            });
        }

        res.json({ success: true, message: '상담 신청이 정상적으로 접수되었습니다.' });

    } catch (err) {
        console.error('DB 삽입 오류 (상담 신청):', err.stack);
        res.status(500).json({ success: false, message: '상담 신청 접수 중 오류가 발생했습니다.' });
    } finally {
        if (client) client.release();
    }
});

// ... (rest of the routes)
app.use('/', router);
module.exports.handler = serverless(app);

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}
