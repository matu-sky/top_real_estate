const path = require('path');
const projectRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(projectRoot, '.env') });
console.log('--- Netlify Function Environment ---');
console.log('Attempting to read SUPABASE_URL:', process.env.SUPABASE_URL ? 'Found' : 'Not Found');
console.log('Attempting to read SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'Found' : 'Not Found');
console.log('Type of SUPABASE_URL:', typeof process.env.SUPABASE_URL);
console.log('Type of SUPABASE_ANON_KEY:', typeof process.env.SUPABASE_ANON_KEY);
console.log('------------------------------------');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const serverless = require('serverless-http');
const querystring = require('querystring');
const bcrypt = require('bcrypt');
const fs = require('fs');
const util = require('util');
const axios = require('axios');
const readdir = util.promisify(fs.readdir);
const { getYouTubeVideoId, getYouTubeThumbnailUrl } = require('./utils.js');
const { generateSitemap } = require('./sitemapGenerator.js');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const { addWatermark } = require('./watermark.js');

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
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // 클라이언트 사이드용으로 남겨둘 수 있음
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; // 서버 사이드용

// 환경 변수 누락 시 명확한 에러 메시지 출력
if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    const errorMessage = 'Supabase URL, Anon Key, and Service Key are required. Check your Netlify environment variables.';
    console.error(errorMessage);
    throw new Error(errorMessage);
}

// 서버-사이드 작업에는 서비스 키를 사용하여 어드민 권한으로 클라이언트 생성
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- 파일 업로드 설정 (메모리 스토리지 사용) ---
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 자료실 전용 업로더 (10MB 제한)
const uploadArchive = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const pgSession = require('connect-pg-simple')(session);

// --- 미들웨어 설정 ---
app.use(express.json({ limit: '11mb' }));
app.use(express.urlencoded({ extended: true, limit: '11mb' }));

// 세션 미들웨어 설정 (데이터베이스 기반)
const store = new pgSession({
    pool: pool,                // 데이터베이스 연결 풀
    tableName: 'session',      // 세션 테이블 이름
    createTableIfMissing: true // 테이블이 없으면 자동 생성
});

app.use(session({
    store: store,
    secret: process.env.SESSION_SECRET || 'a-more-secure-secret-key-for-production',
    resave: false,
    saveUninitialized: false, // 불필요한 세션 저장을 방지
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24시간
        secure: true, // Netlify는 HTTPS를 사용하므로 true로 설정
        httpOnly: true, // 클라이언트 측 스크립트가 쿠키에 접근하는 것을 방지
        sameSite: 'lax' // CSRF 공격 방지
    }
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

        // getSettings에서 이미 JSON.parse를 수행했으므로, 그대로 사용합니다.
        let dbMenus = res.locals.settings.header_nav_links;

        // 최종 안전장치: 메뉴가 유효한 배열이 아니거나 비어있으면 기본 메뉴로 대체
        if (!Array.isArray(dbMenus) || dbMenus.length === 0) {
            dbMenus = [
                { text: '라이프스타일 제안', url: '/#lifestyle' },
                { text: '최신 매물', url: '/#recent-listings' },
                { text: '커뮤니티센터', url: '/board/notice' },
                { text: '컨설팅 상담신청', url: '/#about' },
                { text: '오시는 길', url: '/#location' }
            ];
        }

        // res.locals.settings에 최종 메뉴를 다시 할당하여 템플릿에서 일관되게 사용
        res.locals.settings.header_nav_links = dbMenus;

        // 관리자 페이지 사이드바 메뉴
        res.locals.menus = [
            { name: '대시보드', url: '/dashboard' },
            { name: '홈페이지 관리', url: '/admin' },
            { name: '매물 관리', url: '/listings' },
            { name: '게시판 설정', url: '/admin/board_settings' },
            { name: '메뉴 관리', url: '/admin/menu' },
            { name: '페이지 관리', url: '/admin/pages' },
            { name: '워터마크 관리', url: '/admin/watermarks' },
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

// --- 라우팅(Routing) ---
const router = express.Router();

// 모든 요청에 대해 설정 로드 미들웨어 적용
router.use(loadSettings);

// sitemap.xml 라우트
router.get('/sitemap.xml', (req, res) => {
    const sitemapPath = path.join('/tmp', 'sitemap.xml');
    fs.readFile(sitemapPath, (err, data) => {
        if (err) {
            // 파일이 없는 경우, 새로 생성하도록 유도
            if (err.code === 'ENOENT') {
                return res.status(404).send('Sitemap not found. Please generate it first via the admin panel.');
            }
            return res.status(500).send(err);
        }
        res.header('Content-Type', 'application/xml');
        res.send(data);
    });
});

// 메인 페이지
router.get('/', async (req, res) => {
    let client;
    try {
        client = await pool.connect();

        // 5개의 쿼리를 동시에 실행
        const [
            residentialResult,
            commercialResult,
            industrialResult,
            youtubePostResult,
            recentPostsResult
        ] = await Promise.all([
            client.query("SELECT * FROM properties WHERE category = '주거용' ORDER BY created_at DESC LIMIT 1"),
            client.query("SELECT * FROM properties WHERE category = '상업용' ORDER BY created_at DESC LIMIT 1"),
            client.query("SELECT * FROM properties WHERE category = '공장/지산' ORDER BY created_at DESC LIMIT 1"),
            client.query(`
                SELECT p.id, p.title, p.thumbnail_url, b.slug as board_slug
                FROM posts p
                JOIN boards b ON p.board_id = b.id
                WHERE b.slug = 'utube'
                ORDER BY p.created_at DESC
                LIMIT 1;
            `),
            client.query(`
                SELECT p.id, p.title, p.created_at, b.slug as board_slug, b.name as board_name
                FROM posts p
                JOIN boards b ON p.board_id = b.id
                WHERE b.slug IN ('notice', 'rearinfo')
                ORDER BY p.created_at DESC
                LIMIT 5;
            `)
        ]);

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
                    id: 0, // Placeholder ID
                    title: `${categories[i]} 매물 없음`,
                    category: categories[i],
                    price: '-',
                    short_address: '등록된 매물이 없습니다.',
                    image_path: '/images/default_property.jpg',
                    is_placeholder: true
                });
            }
        }

        const youtubePost = youtubePostResult.rows[0];
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

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login');
});

// 로그인 처리
router.post('/login', async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
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
                req.session.username = username; // Store username in session
                res.redirect('/admin');
            } else {
                res.send('Incorrect Username and/or Password!');
            }
        }
        else {
            res.send('Incorrect Username and/or Password!');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('An error occurred during login.');
    } finally {
        if (client) client.release();
    }
});

// 인증 확인 미들웨어
function requireLogin(req, res, next) {
    if (!req.session.loggedin) {
        return res.redirect('/login');
    }
    next();
}

// 모든 관리자 페이지 라우트에 미들웨어 적용
router.use('/admin', requireLogin);
router.use('/dashboard', requireLogin);
router.use('/listings', requireLogin);
router.use('/add_property', requireLogin);

// 홈페이지 관리 페이지 (읽기 전용)
router.get('/admin', (req, res) => {
    res.render('admin', { content: res.locals.settings, menus: res.locals.menus });
});

// 홈페이지 관리 정보 업데이트 (DB 사용)
const siteImageUpload = upload.fields([
    { name: 'hero_bg_image', maxCount: 1 },
    { name: 'lifestyle_card1_img', maxCount: 1 },
    { name: 'lifestyle_card2_img', maxCount: 1 },
    { name: 'lifestyle_card3_img', maxCount: 1 },
    { name: 'consulting_bg1_image', maxCount: 1 },
    { name: 'consulting_bg2_image', maxCount: 1 },
]);

router.post('/admin/update', requireLogin, siteImageUpload, async (req, res) => {
    let body = req.body;

    // Helper function to upload and optimize a single site asset
    const uploadAsset = async (file, resizeOptions) => {
        console.log(`[Site Asset] Optimizing and uploading: ${file.originalname}`)
        const newFileName = `${path.parse(file.originalname).name}_${Date.now()}.webp`;

        const optimizedBuffer = await sharp(file.buffer)
            .resize(resizeOptions)
            .webp({ quality: 80 })
            .toBuffer();
        
        const { error } = await supabase.storage
            .from('property-images') // Use the existing bucket
            .upload(newFileName, optimizedBuffer, { 
                contentType: 'image/webp',
                upsert: true 
            });

        if (error) {
            throw new Error(`Failed to upload ${file.fieldname}: ${error.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
            .from('property-images')
            .getPublicUrl(newFileName);
        
        return publicUrl;
    };

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN'); // 트랜잭션 시작

        // Process file uploads if they exist
        if (req.files) {
            for (const field in req.files) {
                const file = req.files[field][0];
                if (file) {
                    let resizeOptions = { width: 1920, withoutEnlargement: true }; // Default for backgrounds
                    if (field.startsWith('lifestyle')) {
                        resizeOptions = { width: 800, withoutEnlargement: true }; // Smaller for cards
                    }
                    const newUrl = await uploadAsset(file, resizeOptions);
                    body[field] = newUrl; // Add the new image URL to the body to be saved
                }
            }
        }

        for (const key in body) {
            if (Object.prototype.hasOwnProperty.call(res.locals.settings, key) || key.endsWith('_img') || key.endsWith('_image')) {
                const valueToStore = body[key];
                // Upsert logic: Insert if not exists, update if it does.
                await client.query(
                    `INSERT INTO site_settings (key, value) VALUES ($1, $2) 
                     ON CONFLICT (key) DO UPDATE SET value = $2`,
                    [key, valueToStore]
                );
            }
        }

        await client.query('COMMIT'); // 트랜잭션 커밋
        res.redirect('/admin');

    } catch (err) {
        if (client) await client.query('ROLLBACK'); // 오류 발생 시 롤백
        console.error('DB 업데이트 오류:', err.stack);
        res.status(500).send('콘텐츠 업데이트에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 로그아웃 처리
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/admin');
        }
        res.redirect('/');
    });
});

// 계정 설정 페이지 보여주기
router.get('/admin/settings', requireLogin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT username FROM users WHERE username = $1', [req.session.username]);
        if (result.rows.length > 0) {
            res.render('admin_settings', { user: result.rows[0], menus: res.locals.menus });
        } else {
            res.status(404).send('User not found.');
        }
    } catch (err) {
        console.error('Error fetching user for settings page:', err);
        res.status(500).send('Error loading settings page.');
    }
    finally {
        if (client) client.release();
    }
});

// 계정 설정 업데이트
router.post('/admin/settings', requireLogin, async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    const { username, new_password, confirm_password } = body;
    const currentUsername = req.session.username;

    if (new_password && new_password !== confirm_password) {
        return res.status(400).send('Passwords do not match.');
    }

    let client;
    try {
        client = await pool.connect();
        if (new_password) {
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(new_password, saltRounds);
            await client.query('UPDATE users SET username = $1, password_hash = $2 WHERE username = $3', [username, password_hash, currentUsername]);
        } else {
            await client.query('UPDATE users SET username = $1 WHERE username = $2', [username, currentUsername]);
        }
        req.session.username = username; // Update session username
        res.redirect('/admin/settings');
    } catch (err) {
        console.error('Error updating user settings:', err);
        res.status(500).send('Error updating settings.');
    } finally {
        if (client) client.release();
    }
});

// 사이트맵 생성 라우트
router.get('/admin/generate-sitemap', requireLogin, async (req, res) => {
    try {
        const result = await generateSitemap();
        if (result.success) {
            res.send(`Sitemap generated successfully at ${result.path}. <a href="/sitemap.xml">View Sitemap</a>`);
        } else {
            res.status(500).send(`Error generating sitemap: ${result.error.message}`);
        }
    } catch (error) {
        res.status(500).send(`An unexpected error occurred: ${error.message}`);
    }
});

// 대시보드 페이지
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

// 게시판 설정 페이지
router.get('/admin/board_settings', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM boards ORDER BY created_at DESC');
        console.log('Fetched boards:', result.rows);
        res.render('board_settings', { menus: res.locals.menus, boards: result.rows });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('게시판 목록을 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 새 게시판 만들기 페이지
router.get('/admin/board/new', requireLogin, (req, res) => {
    const boardType = req.query.type || 'general'; // URL 쿼리에서 유형을 가져옴
    res.render('add_board', { menus: res.locals.menus, boardType: boardType });
});

// 게시판 수정 페이지 보여주기
router.get('/admin/board/edit/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM boards WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = result.rows[0];
        res.render('edit_board', { menus: res.locals.menus, board });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('게시판 정보를 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 게시판 정보 업데이트 (v3)
router.post('/admin/board/update/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    const { board_name, board_slug, board_description, board_type } = body;
    const query = 'UPDATE boards SET name = $1, slug = $2, description = $3, board_type = $4 WHERE id = $5';
    const params = [board_name, board_slug, board_description, board_type, id];

    let client;
    try {
        client = await pool.connect();
        await client.query(query, params);
        res.redirect('/admin/board_settings');
    } catch (err) {
        console.error('DB 업데이트 오류:', err.stack);
        res.status(500).send('게시판 업데이트에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 게시판 삭제
router.post('/admin/board/delete/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        // 트랜잭션 시작
        await client.query('BEGIN');
        // 해당 게시판의 모든 게시글 삭제
        await client.query('DELETE FROM posts WHERE board_id = $1', [id]);
        // 게시판 삭제
        await client.query('DELETE FROM boards WHERE id = $1', [id]);
        // 트랜잭션 커밋
        await client.query('COMMIT');
        res.redirect('/admin/board_settings');
    } catch (err) {
        // 오류 발생 시 롤백
        if (client) await client.query('ROLLBACK');
        console.error('DB 삭제 오류:', err.stack);
        res.status(500).send('게시판 삭제에 실패했습니다.');
    } finally {
        if (client) client.release();
    }n});

// 새 게시판 생성
router.post('/admin/board/create', requireLogin, async (req, res) => {
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    const { board_name, board_slug, board_description, board_type } = body;
    const query = 'INSERT INTO boards (name, slug, description, board_type) VALUES ($1, $2, $3, $4)';
    const params = [board_name, board_slug, board_description, board_type];

    let client;
    try {
        client = await pool.connect();
        await client.query(query, params);
        res.redirect('/admin/board_settings');
    } catch (err) {
        console.error('DB 삽입 오류:', err.stack);
        res.status(500).send('게시판 생성에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 매물 관리 페이지
router.get('/listings', async (req, res) => {
    const category = req.query.category;
    let query = "SELECT * FROM properties";
    const params = [];

    if (category) {
        query += " WHERE category = $1";
        params.push(category);
    }

    query += " ORDER BY created_at DESC";

    const client = await pool.connect();
    try {
        const result = await client.query(query, params);
        res.render('listings', { 
            properties: result.rows, 
            menus: res.locals.menus, 
            currentCategory: category
        });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
    } finally {
        client.release();
    }
});

// 새 매물 등록 페이지
router.get('/add_property', requireLogin, (req, res) => {
    res.render('add_property', { menus: res.locals.menus });
});

// 새 상업용 매물 등록 페이지
router.get('/add_commercial_property', requireLogin, (req, res) => {
    res.render('add_commercial_property', { menus: res.locals.menus });
});

// 새 공장/지산 매물 등록 페이지
router.get('/add_factory_property', requireLogin, (req, res) => {
    res.render('add_factory_property', { menus: res.locals.menus });
});



// --- 홈페이지 메뉴 관리 ---


// --- 페이지 관리 ---
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

router.get('/admin/pages/edit/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM pages WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('페이지를 찾을 수 없습니다.');
        }
        res.render('edit_page', { menus: res.locals.menus, page: result.rows[0] });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('페이지 정보를 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.post('/admin/pages/update/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    const { title, content } = body;
    const query = 'UPDATE pages SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3';
    const params = [title, content, id];

    let client;
    try {
        client = await pool.connect();
        await client.query(query, params);
        res.redirect('/admin/pages');
    } catch (err) {
        console.error('DB 업데이트 오류:', err.stack);
        res.status(500).send('페이지 업데이트에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.post('/admin/pages/delete/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('DELETE FROM pages WHERE id = $1', [id]);
        res.redirect('/admin/pages');
    } catch (err) {
        console.error('DB 삭제 오류:', err.stack);
        res.status(500).send('페이지 삭제에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// --- End of 페이지 관리 ---

// --- 워터마크 관리 ---
router.get('/admin/watermarks', requireLogin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT name, image_base64 FROM watermarks');
        const watermarks = {};
        result.rows.forEach(row => {
            watermarks[row.name] = row.image_base64;
        });
        res.render('watermark_management', { menus: res.locals.menus, watermarks });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('워터마크 정보를 가져오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.post('/admin/watermarks/update', requireLogin, upload.fields([
    { name: 'center_watermark', maxCount: 1 },
    { name: 'bottom_right_watermark', maxCount: 1 }
]), async (req, res) => {
    console.log('--- Watermark Update Request ---');
    console.log('Request Body:', req.body);
    console.log('Request Files:', req.files);

    let client;
    try {
        client = await pool.connect();
        let updated = false;

        const updateTasks = [];

        if (req.files.center_watermark) {
            const file = req.files.center_watermark[0];
            const base64Data = file.buffer.toString('base64');
            updateTasks.push(
                client.query('UPDATE watermarks SET image_base64 = $1 WHERE name = $2', [base64Data, 'center'])
            );
            updated = true;
        }

        if (req.files.bottom_right_watermark) {
            const file = req.files.bottom_right_watermark[0];
            const base64Data = file.buffer.toString('base64');
            updateTasks.push(
                client.query('UPDATE watermarks SET image_base64 = $1 WHERE name = $2', [base64Data, 'bottom_right'])
            );
            updated = true;
        }

        await Promise.all(updateTasks);

        // if (updated) {
        //     clearWatermarkCache();
        // }

        res.redirect('/admin/watermarks');

    } catch (err) {
        console.error('워터마크 업데이트 오류:', err.stack);
        res.status(500).send('워터마크 업데이트에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// --- 동적 페이지 라우트 ---
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
        // HTML 엔티티를 문자로 변환 (예: &lt;p&gt; -> <p>)
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

// --- 홈페이지 메뉴 관리 ---

router.get('/admin/menu', requireLogin, (req, res) => {
    res.render('menu_settings', { menus: res.locals.menus, content: res.locals.settings });
});

// 메뉴 관리 정보 업데이트 (DB 사용)
router.post('/admin/menu/update', requireLogin, async (req, res) => {
    // Netlify 환경에서 Buffer로 전달되는 req.body를 파싱합니다.
    const bodyString = req.body.toString('utf8');
    const parsedBody = querystring.parse(bodyString);

    let { link_texts, link_urls } = parsedBody;

    // 입력값이 하나일 경우 문자열로 들어오므로, 배열로 변환합니다.
    if (typeof link_texts === 'string') link_texts = [link_texts];
    if (typeof link_urls === 'string') link_urls = [link_urls];

    const links = [];
    if (link_texts && link_urls && link_texts.length === link_urls.length) {
        for (let i = 0; i < link_texts.length; i++) {
            const text = link_texts[i].trim();
            const url = link_urls[i].trim();
            if (text !== '' && url !== '') {
                links.push({ text, url });
            }
        }
    }

    const valueToStore = JSON.stringify(links);

    let client;
    try {
        client = await pool.connect();
        await client.query(
            'INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            ['header_nav_links', valueToStore]
        );
        res.redirect('/admin/menu');
    } catch (err) {
        console.error('DB 업데이트 오류:', err.stack);
        res.status(500).send('메뉴 저장에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});


// ✅ [신규] 새 매물 추가: 폼에서 전송된 데이터를 DB에 저장
// ✅ [신규] 새 매물 추가: 폼에서 전송된 데이터를 DB에 저장
// ✅ [신규] 새 매물 추가: 폼에서 전송된 데이터를 DB에 저장
router.post('/listings/add', upload.array('images', 10), async (req, res) => {
    console.log('--- 매물 등록 요청 시작 ---');
    console.log('요청 본문:', req.body);
    console.log('업로드된 파일:', req.files ? req.files.length + '개' : '없음');

    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    const imageUrls = [];
    if (req.files) {
        for (const file of req.files) {
            // 이미지가 아닌 파일(예: 동영상)은 최적화에서 제외
            if (!file.mimetype.startsWith('image')) continue;

            const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const baseName = path.basename(originalname_utf8, path.extname(originalname_utf8));
            const newFileName = `${baseName}_${Date.now()}.webp`;

            console.log(`[server.js] Optimizing and watermarking: ${originalname_utf8}`);

            // 1. 이미지 리사이즈 및 WebP 변환
            const optimizedBuffer = await sharp(file.buffer)
                .resize({ width: 1200, withoutEnlargement: true }) // 가로 1200px로 리사이즈 (작은 이미지는 확대 안함)
                .webp({ quality: 80 }) // 80% 품질의 WebP로 변환
                .toBuffer();

            // 2. 최적화된 이미지에 워터마크 적용
            const finalBuffer = await addWatermark(optimizedBuffer);

            // 3. 최종 결과물을 Supabase에 업로드
            const { data, error } = await supabase.storage
                .from('property-images')
                .upload(newFileName, finalBuffer, {
                    contentType: 'image/webp',
                });

            if (error) {
                console.error('Supabase 스토리지 업로드 오류:', error);
                return res.status(500).send('이미지 업로드에 실패했습니다.');
            }

            const { data: { publicUrl } } = supabase.storage
                .from('property-images')
                .getPublicUrl(newFileName);
            imageUrls.push(publicUrl);
        }
    }
    const image_paths = imageUrls.join(',');
    console.log('생성된 이미지 경로 문자열:', image_paths);

    // 데이터 클렌징 및 유효성 검사 헬퍼 함수
    const parseToInt = (value) => (value === '' || value === undefined || value === null) ? null : Number.parseInt(value, 10);
    const parseFloat = (value) => (value === '' || value === undefined || value === null) ? null : Number.parseFloat(value);

    // 폼 데이터 추출
    const { category, title, price, address, approval_date, purpose, direction, direction_standard, transaction_type, maintenance_fee_details, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = body;

    // 숫자 필드 안전하게 파싱
    const area = parseFloat(body.area);
    const exclusive_area = parseFloat(body.exclusive_area);
    const total_floors = parseToInt(body.total_floors);
    const floor = parseToInt(body.floor);
    const parking = parseToInt(body.parking);
    const maintenance_fee = parseToInt(body.maintenance_fee);
    const ceiling_height = parseFloat(body.ceiling_height);
    const power_supply = parseFloat(body.power_supply);
    const hoist = parseFloat(body.hoist);

    const query = `INSERT INTO properties (
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_path, youtube_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    RETURNING id;`;

    const params = [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url
    ];

    console.log('데이터베이스에 매물 정보 삽입 시도...');

    let client;
    try {
        client = await pool.connect();
        const result = await client.query(query, params);
        console.log('DB 삽입 성공! 삽입된 매물 ID:', result.rows[0].id);
        
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삽입 오류 발생:', err.stack);
        res.status(500).send(`매물 등록에 실패했습니다. 서버 로그를 확인해주세요. 오류: ${err.message}`);
    } finally {
        if (client) {
            client.release();
        }
        console.log('--- 매물 등록 요청 종료 ---');
    }
});

// ✅ [신규] 매물 수정
// ✅ [신규] 매물 수정
router.post('/listings/edit/:id', upload.array('images', 10), async (req, res) => {
    const { id } = req.params;
    
    // Netlify 환경에서 Buffer로 들어오는 body를 파싱
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    // 삭제할 이미지 처리
    if (body.deleted_images) {
        const imagesToDelete = Array.isArray(body.deleted_images) ? body.deleted_images : [body.deleted_images];
        const fileNamesToDelete = imagesToDelete.map(url => url.split('/').pop());
        
        if (fileNamesToDelete.length > 0) {
            const { data, error } = await supabase.storage
                .from('property-images')
                .remove(fileNamesToDelete);

            if (error) {
                console.error('Supabase 스토리지 삭제 오류:', error);
                // 오류가 발생해도 일단 진행하도록 설정. 필요시 에러 처리 강화
            }
        }
    }

    let imageUrls = body.existing_image_paths ? body.existing_image_paths.split(',').filter(p => p) : [];

    if (req.files) {
        for (const file of req.files) {
            // 이미지가 아닌 파일(예: 동영상)은 최적화에서 제외
            if (!file.mimetype.startsWith('image')) continue;

            const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const baseName = path.basename(originalname_utf8, path.extname(originalname_utf8));
            const newFileName = `${baseName}_${Date.now()}.webp`;

            console.log(`[server.js] Optimizing and watermarking: ${originalname_utf8}`);

            // 1. 이미지 리사이즈 및 WebP 변환
            const optimizedBuffer = await sharp(file.buffer)
                .resize({ width: 1200, withoutEnlargement: true }) // 가로 1200px로 리사이즈 (작은 이미지는 확대 안함)
                .webp({ quality: 80 }) // 80% 품질의 WebP로 변환
                .toBuffer();

            // 2. 최적화된 이미지에 워터마크 적용
            const finalBuffer = await addWatermark(optimizedBuffer);

            // 3. 최종 결과물을 Supabase에 업로드
            const { data, error } = await supabase.storage
                .from('property-images')
                .upload(newFileName, finalBuffer, {
                    contentType: 'image/webp',
                });

            if (error) {
                console.error('Supabase 스토리지 업로드 오류:', error);
                return res.status(500).send('이미지 업로드에 실패했습니다.');
            }

            const { data: { publicUrl } } = supabase.storage
                .from('property-images')
                .getPublicUrl(newFileName);
            imageUrls.push(publicUrl);
        }
    }

    const image_paths = imageUrls.join(',');
    
    // 데이터 클렌징 및 유효성 검사 헬퍼 함수
    const parseToInt = (value) => (value === '' || value === undefined || value === null) ? null : Number.parseInt(value, 10);
    const parseFloat = (value) => (value === '' || value === undefined || value === null) ? null : Number.parseFloat(value);

    // 폼 데이터 추출
    const { category, title, price, address, approval_date, purpose, direction, direction_standard, transaction_type, maintenance_fee_details, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = body;

    // 숫자 필드 안전하게 파싱
    const area = parseFloat(body.area);
    const exclusive_area = parseFloat(body.exclusive_area);
    const total_floors = parseToInt(body.total_floors);
    const floor = parseToInt(body.floor);
    const parking = parseToInt(body.parking);
    const maintenance_fee = parseToInt(body.maintenance_fee);
    const ceiling_height = parseFloat(body.ceiling_height);
    const power_supply = parseFloat(body.power_supply);
    const hoist = parseFloat(body.hoist);

    const query = `UPDATE properties SET 
        category = $1, title = $2, price = $3, address = $4, area = $5, exclusive_area = $6, approval_date = $7, purpose = $8, total_floors = $9, floor = $10, direction = $11, direction_standard = $12, transaction_type = $13, parking = $14, maintenance_fee = $15, maintenance_fee_details = $16, power_supply = $17, hoist = $18, ceiling_height = $19, permitted_business_types = $20, access_road_condition = $21, move_in_date = $22, description = $23, image_path = $24, youtube_url = $25
    WHERE id = $26`;

    const params = [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url, id
    ];

    const client = await pool.connect();
    try {
        await client.query(query, params);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 수정 오류:', err.stack);
        res.status(500).send("매물 수정에 실패했습니다.");
    } finally {
        client.release();
    }
});

// ✅ [신규] 매물 삭제
router.post('/listings/delete/:id', async (req, res) => {
    const { id } = req.params;
    const query = "DELETE FROM properties WHERE id = $1";

    const client = await pool.connect();
    try {
        await client.query(query, [id]);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삭제 오류:', err.stack);
        res.status(500).send("매물 삭제에 실패했습니다.");
    } finally {
        client.release();
    }
});


// --- 상담문의 기능 ---
router.get('/consultation-request', (req, res) => {
    res.render('consultation_request', { content: res.locals.settings });
});

router.get('/consultation-thanks', (req, res) => {
    res.render('consultation_thanks', { content: res.locals.settings });
});

router.post('/consultation-request/submit', async (req, res) => {
    let client;
    try {
        let body = {};
        if (req.body instanceof Buffer) {
            body = querystring.parse(req.body.toString());
        } else {
            body = req.body;
        }

        const {
            name, phone, email, inquiry_type, title, message
        } = body;

        if (!name || !phone || !email) {
            return res.status(400).send('이름, 전화번호, 이메일은 필수 입력 항목입니다. 양식을 다시 확인해주세요.');
        }
        
        let property_types = body.property_type;
        if (Array.isArray(property_types)) {
            property_types = property_types.join(', ');
        } else if (property_types === undefined) {
            property_types = '';
        }

        const query = `
            INSERT INTO inquiries (name, phone, email, property_types, inquiry_type, title, message)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const params = [name, phone, email, property_types, inquiry_type, title, message];

        client = await pool.connect();
        await client.query(query, params);

        // --- Nodemailer 트랜스포터 설정 (이메일 발송 직전에 생성) ---
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        // --- 관리자에게 이메일 알림 발송 ---
        const mailOptions = {
            from: `"탑부동산" <${process.env.EMAIL_USER}>`,
            to: 'jbs-sky@naver.com', // Admin's email
            subject: '새로운 상담문의가 도착했습니다.',
            html: `
                <h1>새로운 상담문의 접수</h1>
                <p>홈페이지를 통해 새로운 상담문의가 접수되었습니다.</p>
                <h2>문의 내용</h2>
                <ul>
                    <li><strong>성함:</strong> ${name}</li>
                    <li><strong>연락처:</strong> ${phone}</li>
                    <li><strong>이메일:</strong> ${email}</li>
                    <li><strong>관심분야:</strong> ${property_types}</li>
                    <li><strong>문의유형:</strong> ${inquiry_type}</li>
                    <li><strong>제목:</strong> ${title}</li>
                </ul>
                <h2>메시지</h2>
                <p>${message}</p>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log('Admin notification email sent successfully.');
        
        res.redirect('/consultation-thanks');

    } catch (err) {
        console.error('DB 삽입 오류:', err.stack);
        res.status(500).send('문의 접수 중 오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/admin/inquiries', requireLogin, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 15; // 페이지당 15개 항목
        const offset = (page - 1) * limit;

        // 전체 문의 수 계산
        const totalResult = await client.query('SELECT COUNT(*) FROM inquiries');
        const totalInquiries = parseInt(totalResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalInquiries / limit);

        // 현재 페이지에 해당하는 문의 목록 가져오기
        const result = await client.query('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        
        res.render('admin_inquiries', { 
            inquiries: result.rows,
            menus: res.locals.menus,
            currentPage: page,
            totalPages: totalPages
        });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('문의 내역을 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/admin/inquiry/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM inquiries WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).send('문의 내역을 찾을 수 없습니다.');
        }
        res.render('inquiry_detail', {
            inquiry: result.rows[0],
            menus: res.locals.menus
        });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send('문의 내역을 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.post('/admin/inquiry/delete/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('DELETE FROM inquiries WHERE id = $1', [id]);
        res.redirect('/admin/inquiries');
    } catch (err) {
        console.error('문의 삭제 오류:', err.stack);
        res.status(500).send('문의 내역 삭제에 실패했습니다.');
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

router.post('/request_contact/submit', (req, res) => {
    const { type, name, contact_method, email, phone } = req.body;

    console.log('--- 새로운 상담 접수 ---');
    console.log('상담 유형:', type);
    console.log('고객 성함:', name);
    console.log('선호 연락 방식:', contact_method);
    if (contact_method === 'email') {
        console.log('이메일:', email);
    } else if (contact_method === 'sms') {
        console.log('휴대폰 번호:', phone);
    }
    console.log('--------------------------');

    // 성공했다는 JSON 응답을 클라이언트로 보냄
    res.json({ success: true, message: '상담 신청이 정상적으로 접수되었습니다.' });
});




// 게시판 페이지 (글 목록)
router.get('/board/:slug', async (req, res) => {
    const { slug } = req.params;
    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT * FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = boardResult.rows[0];

        const postsResult = await client.query('SELECT * FROM posts WHERE board_id = $1 ORDER BY created_at DESC', [board.id]);
        const posts = postsResult.rows;

        res.render('board', { 
            board, 
            posts, 
            user: req.session, 
            content: res.locals.settings 
        });
    } catch (err) {
        console.error('게시판 페이지 오류:', err);
        res.status(500).send(`<h1>오류 발생</h1><p>게시판 정보를 가져오는 중 오류가 발생했습니다.</p><pre>${err.stack}</pre>`);
    } finally {
        if (client) client.release();
    }
});

// 글쓰기 페이지 보여주기
router.get('/board/:slug/write', requireLogin, async (req, res) => {
    const { slug } = req.params;
    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT * FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = boardResult.rows[0];
        // 이제 board.board_type을 템플릿에서 사용할 수 있습니다.
        res.render('write', { 
            board: board, 
            menus: res.locals.menus, 
            content: res.locals.settings, 
            user: req.session 
        });
    } catch (err) {
        console.error('글쓰기 페이지 오류:', err);
        res.status(500).send('오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});



// 새 글 작성 (저장)
router.post('/board/:slug/write', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const { slug } = req.params;
    let { title, content, author, youtube_url } = req.body; // youtube_url을 let으로 변경

    let attachment_path_to_db = null;
    let thumbnail_url = null; // 썸네일 URL 변수 추가
    let client;
    try {
        client = await pool.connect();

        const boardResult = await client.query('SELECT id, board_type FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = boardResult.rows[0];
        const boardId = board.id;

        if (req.files && req.files.length > 0) {
            let attachment_keys = [];
            let attachment_public_urls = [];

            for (const file of req.files) {
                const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const originalname_base64 = Buffer.from(originalname_utf8).toString('base64');
                const newFileName = `${Date.now()}_${originalname_base64}`;

                let bufferToUpload = file.buffer;
                if (slug !== 'utube' && file.mimetype.startsWith('image/')) {
                    bufferToUpload = await addWatermark(file.buffer);
                }

                const { error: uploadError } = await supabase.storage
                    .from('attachments')
                    .upload(newFileName, bufferToUpload, { contentType: file.mimetype });

                if (uploadError) {
                    throw new Error(`Supabase upload error: ${uploadError.message}`);
                }
                
                attachment_keys.push(newFileName);
                const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(newFileName);
                if (urlData) {
                    attachment_public_urls.push(urlData.publicUrl);
                }
            }

            if (board.board_type === 'archive') {
                const file = req.files[0];
                const filePath = attachment_keys[0];
                const fileMetadata = {
                    path: filePath, // Store path instead of URL
                    name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
                    size: file.size,
                    type: file.mimetype
                };
                attachment_path_to_db = JSON.stringify(fileMetadata);
            } else if (board.board_type === 'gallery') {
                attachment_path_to_db = JSON.stringify(attachment_public_urls);
            } else {
                attachment_path_to_db = attachment_public_urls[0];
            }
            
            youtube_url = null;
        }

        if (board.board_type === 'youtube' && youtube_url) {
            const videoId = getYouTubeVideoId(youtube_url);
            thumbnail_url = getYouTubeThumbnailUrl(videoId);
        }

        const query = 'INSERT INTO posts (board_id, title, content, author, attachment_path, youtube_url, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6, $7)';
        await client.query(query, [boardId, title, content, author, attachment_path_to_db, youtube_url, thumbnail_url]);

        res.redirect(`/board/${slug}`);
    } catch (err) {
        console.error('DB 삽입 오류:', err);
        res.status(500).send(`글 작성에 실패했습니다. <br><br><strong>오류 정보:</strong><pre>${err.stack}</pre>`);
    } finally {
        if (client) client.release();
    }
});

// 게시글 상세 페이지
router.get('/board/:slug/:postId', async (req, res) => {
    const { slug, postId } = req.params;
    let client;
    try {
        client = await pool.connect();
        
        const boardResult = await client.query('SELECT * FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = boardResult.rows[0];

        const postResult = await client.query('SELECT * FROM posts WHERE id = $1 AND board_id = $2', [postId, board.id]);
        if (postResult.rows.length === 0) {
            return res.status(404).send('게시글을 찾을 수 없습니다.');
        }
        const post = postResult.rows[0];

        res.render('post_detail', {
            board,
            post,
            user: req.session,
            content: res.locals.settings
        });

    } catch (err) {
        console.error('게시글 상세 조회 오류:', err);
        res.status(500).send('오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});


// 글 수정 페이지 보여주기
router.get('/board/:slug/:postId/edit', requireLogin, async (req, res) => {
    const { slug, postId } = req.params;
    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT * FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) {
            return res.status(404).send('게시판을 찾을 수 없습니다.');
        }
        const board = boardResult.rows[0];

        const postResult = await client.query('SELECT * FROM posts WHERE id = $1', [postId]);
        if (postResult.rows.length === 0) {
            return res.status(404).send('게시글을 찾을 수 없습니다.');
        }
        const post = postResult.rows[0];

        res.render('edit_post', { 
            board, 
            post, 
            menus: res.locals.menus, 
            content: res.locals.settings 
        });
    } catch (err) {
        console.error('글 수정 페이지 오류:', err);
        res.status(500).send('오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 글 수정 (저장)
router.post('/board/:slug/:postId/edit', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const { slug, postId } = req.params;
    let { title, content, author, youtube_url, delete_attachment } = req.body;

    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT id, board_type FROM boards WHERE slug = $1', [slug]);
        const board = boardResult.rows[0];

        const postResult = await client.query('SELECT attachment_path, thumbnail_url FROM posts WHERE id = $1', [postId]);
        let attachment_path_to_db = postResult.rows[0].attachment_path;
        let thumbnail_url = postResult.rows[0].thumbnail_url;

        // Case 1: A new file is uploaded. This takes precedence over everything.
        if (req.files && req.files.length > 0) {
            let new_attachment_keys = [];
            let new_attachment_public_urls = [];

            for (const file of req.files) {
                const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const originalname_base64 = Buffer.from(originalname_utf8).toString('base64');
                const newFileName = `${Date.now()}_${originalname_base64}`;
                let bufferToUpload = file.buffer;

                if (slug !== 'utube' && file.mimetype.startsWith('image/')) {
                    bufferToUpload = await addWatermark(file.buffer);
                }
                const { error: uploadError } = await supabase.storage.from('attachments').upload(newFileName, bufferToUpload, { contentType: file.mimetype });
                if (uploadError) throw new Error(`Supabase upload error: ${uploadError.message}`);
                
                new_attachment_keys.push(newFileName);
                const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(newFileName);
                if (urlData) {
                    new_attachment_public_urls.push(urlData.publicUrl);
                }
            }

            if (board.board_type === 'archive') {
                const file = req.files[0];
                const filePath = new_attachment_keys[0];
                const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const fileMetadata = {
                    path: filePath, // Store path
                    name: originalname_utf8,
                    size: file.size,
                    type: file.mimetype
                };
                attachment_path_to_db = JSON.stringify(fileMetadata);
            } else if (board.board_type === 'gallery') {
                const existing_attachments = JSON.parse(attachment_path_to_db || '[]');
                attachment_path_to_db = JSON.stringify([...existing_attachments, ...new_attachment_public_urls]);
            } else {
                attachment_path_to_db = new_attachment_public_urls[0];
            }
            
            youtube_url = null;
            thumbnail_url = null;
        } 
        // Case 2: No new file, but user wants to delete existing attachment.
        else if (delete_attachment) {
            const attachments_to_delete = Array.isArray(delete_attachment) ? delete_attachment : [delete_attachment];
            if (attachments_to_delete.length > 0) {
                const fileNamesToDelete = attachments_to_delete.map(url => url.split('/').pop());
                await supabase.storage.from('attachments').remove(fileNamesToDelete);

                if (board.board_type === 'gallery') {
                    const remaining_attachments = JSON.parse(attachment_path_to_db || '[]').filter(url => !attachments_to_delete.includes(url));
                    attachment_path_to_db = JSON.stringify(remaining_attachments);
                } else {
                    attachment_path_to_db = null;
                }
            }
        }
        
        // Case 3: No file actions, but a YouTube URL is present.
        if (youtube_url) {
            const videoId = getYouTubeVideoId(youtube_url);
            thumbnail_url = getYouTubeThumbnailUrl(videoId);
            attachment_path_to_db = null; // Clear any old file path
        }

        const query = 'UPDATE posts SET title = $1, content = $2, author = $3, attachment_path = $4, youtube_url = $5, thumbnail_url = $6 WHERE id = $7';
        const params = [title, content, author, attachment_path_to_db, youtube_url, thumbnail_url, postId];
        
        await client.query(query, params);
        res.redirect(`/board/${slug}`);

    } catch (err) {
        console.error('글 수정 최종 오류:', err.stack);
        res.status(500).send(`글 수정에 실패했습니다. <br><br><strong>오류 정보:</strong><pre>${err.stack}</pre>`);
    } finally {
        if (client) client.release();
    }
});

// 글 삭제
router.post('/board/:slug/:postId/delete', requireLogin, async (req, res) => {
    const { slug, postId } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('DELETE FROM posts WHERE id = $1', [postId]);
        res.redirect(`/board/${slug}`);
    } catch (err) {
        console.error('DB 삭제 오류:', err);
        res.status(500).send('글 삭제에 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// 자료실 파일 다운로드 라우트 (v2: 리디렉션 방식)
router.get('/download/:postId', async (req, res) => {
    const { postId } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT attachment_path FROM posts WHERE id = $1', [postId]);
        if (result.rows.length === 0 || !result.rows[0].attachment_path) {
            return res.status(404).send('첨부파일을 찾을 수 없습니다.');
        }

        const attachmentPath = result.rows[0].attachment_path;
        let fileMeta = null;
        try {
            fileMeta = JSON.parse(attachmentPath);
        } catch (e) {
            // 하위 호환성: 예전 데이터는 JSON이 아닌 일반 URL일 수 있음
            return res.redirect(attachmentPath);
        }

        let downloadUrl = null;

        // 신규 로직: path 속성이 있으면 최신 파일로 간주하고 서명된 URL 생성
        if (fileMeta.path) {
            const { data, error } = await supabase.storage
                .from('attachments')
                .createSignedUrl(fileMeta.path, 60, { // 60초 동안 유효한 링크
                    download: fileMeta.name // 원본 파일 이름으로 다운로드되도록 설정
                });

            if (error) {
                throw new Error(`Supabase에서 서명된 URL을 생성하지 못했습니다: ${error.message}`);
            }
            downloadUrl = data.signedUrl;
        } 
        // 하위 호환성: url 속성이 있으면 예전 파일로 간주
        else if (fileMeta.url) {
            downloadUrl = fileMeta.url;
        }
        // 둘 다 없으면 유효하지 않은 데이터
        else {
            return res.status(404).send('유효한 첨부파일 정보가 없습니다.');
        }

        if (downloadUrl) {
            res.redirect(downloadUrl);
        } else {
            res.status(404).send('다운로드 URL을 생성할 수 없습니다.');
        }

    } catch (err) {
        console.error('파일 다운로드 오류:', err);
        res.status(500).send(`파일 다운로드 중 오류가 발생했습니다: ${err.message}`);
    }
    finally {
        if (client) client.release();
    }
});

// --- End of 게시판 관련 라우트 ---

// 매물 상세 페이지
router.get('/property/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query("SELECT * FROM properties WHERE id = $1", [id]);
        const property = result.rows[0];

        if (property) {
            if (property.address) {
                property.short_address = property.address.split(' ').slice(0, 3).join(' ');
            }

            const page = parseInt(req.query.page, 10) || 1;
            const limit = 5;
            const offset = (page - 1) * limit;

            const countResult = await client.query(
                "SELECT COUNT(*) FROM properties WHERE category = $1 AND id != $2",
                [property.category, id]
            );
            const totalCount = parseInt(countResult.rows[0].count, 10);
            const totalPages = Math.ceil(totalCount / limit);

            const relatedPropertiesResult = await client.query(
                "SELECT * FROM properties WHERE category = $1 AND id != $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4",
                [property.category, id, limit, offset]
            );
            const relatedProperties = relatedPropertiesResult.rows;

            // 관련 매물 주소 축약
            relatedProperties.forEach(p => {
                if (p.address) {
                    p.short_address = p.address.split(' ').slice(0, 3).join(' ');
                }
            });

            res.render('property_detail', { 
                property, 
                relatedProperties, 
                content: res.locals.settings,
                currentPage: page,
                totalPages
            });
        } else {
            res.status(404).send("매물을 찾을 수 없습니다.");
        }
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
    } finally {
        if (client) client.release();
    }
});



// API: 특정 매물 정보 가져오기
router.get('/api/property/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM properties WHERE id = $1";

    const client = await pool.connect();
    try {
        const result = await client.query(query, [id]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: '매물을 찾을 수 없습니다.' });
        }
    } catch (err) {
        console.error('API DB 조회 오류:', err.stack);
        res.status(500).json({ error: '데이터베이스 오류' });
    } finally {
        client.release();
    }
});

// Express 앱에 라우터 마운트
// serverless-http가 경로를 자동으로 처리하므로, 기본 경로('/')에 라우터를 마운트합니다.
app.use('/', router);


// --- 서버리스 핸들러 ---
module.exports.handler = serverless(app);

// 로컬 테스트 환경을 위한 서버 실행 코드
// 이 코드는 Netlify 배포 시에는 실행되지 않습니다.
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
} else {
    // Netlify 환경에서만 실행되는 디버깅 코드
    (async () => {
        try {
            console.log('--- Netlify 배포 환경 파일 목록 ---');
            const files = await getFiles(path.dirname(__filename));
            console.log(files.join('\n'));
            console.log('------------------------------------');
        } catch (err) {
            console.error('파일 목록을 가져오는 중 오류 발생:', err);
        }
    })();
}