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

// MIDDLEWARE
app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

// 모든 요청을 로깅하는 미들웨어 (디버깅용)
app.use((req, res, next) => {
    console.log('--- GLOBAL REQUEST LOGGER --- ');
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    console.log(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
    next();
});

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

router.get('/page/:slug', (req, res) => {
    const { slug } = req.params;
    const pagesContentPath = path.resolve(projectRoot, 'data', 'pages_content.json');

    fs.readFile(pagesContentPath, 'utf8', (err, data) => {
        if (err) {
            console.error('페이지 콘텐츠 파일 읽기 오류:', err);
            return res.status(500).send('페이지를 불러오는 중 오류가 발생했습니다.');
        }

        try {
            const pages = JSON.parse(data);
            const pageContent = pages[slug];

            if (pageContent) {
                res.render('page', {
                    content: res.locals.settings,
                    page: pageContent,
                    menus: res.locals.menus
                });
            } else {
                res.status(404).send('페이지를 찾을 수 없습니다.');
            }
        } catch (parseErr) {
            console.error('페이지 콘텐츠 JSON 파싱 오류:', parseErr);
            res.status(500).send('페이지를 불러오는 중 오류가 발생했습니다.');
        }
    });
});

router.get('/property/:id', async (req, res) => {
    const { id } = req.params;
    let client;

    try {
        client = await pool.connect();
        const propertyResult = await client.query('SELECT * FROM properties WHERE id = $1', [id]);

        if (propertyResult.rows.length === 0) {
            return res.status(404).send('매물을 찾을 수 없습니다.');
        }

        const property = propertyResult.rows[0];
        if (property.address) {
            property.short_address = property.address.split(' ').slice(0, 3).join(' ');
        }

        const relatedResult = await client.query(
            'SELECT * FROM properties WHERE category = $1 AND id != $2 ORDER BY created_at DESC LIMIT 4',
            [property.category, id]
        );
        const relatedProperties = relatedResult.rows;

        res.render('property_detail', {
            content: res.locals.settings,
            property: property,
            relatedProperties: relatedProperties,
            menus: res.locals.menus,
            totalPages: 1,
            currentPage: 1
        });

    } catch (err) {
        console.error('DB 조회 오류 (매물 상세):', err.stack);
        res.status(500).send('매물 정보를 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

router.get('/board/:board_slug/:post_id', async (req, res) => {
    const { board_slug, post_id } = req.params;
    let client;

    try {
        client = await pool.connect();

        const postQuery = `
            SELECT p.*, b.name as board_name, b.slug as board_slug, b.board_type
            FROM posts p
            JOIN boards b ON p.board_id = b.id
            WHERE p.id = $1 AND b.slug = $2
        `;
        const postResult = await client.query(postQuery, [post_id, board_slug]);

        if (postResult.rows.length === 0) {
            return res.status(404).send('게시글을 찾을 수 없습니다.');
        }

        const post = postResult.rows[0];
        const board = {
            name: post.board_name,
            slug: post.board_slug,
            board_type: post.board_type
        };

        res.render('post_detail', {
            content: res.locals.settings,
            board: board,
            post: post,
            menus: res.locals.menus,
            user: req.session // Pass session to the template
        });

    } catch (err) {
        console.error('DB 조회 오류 (게시글 상세):', err.stack);
        res.status(500).send('게시글 정보를 불러오는 데 실패했습니다.');
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

router.get('/add_property', requireLogin, (req, res) => {
    res.render('add_property', { menus: res.locals.menus });
});

router.get('/add_commercial_property', requireLogin, (req, res) => {
    res.render('add_commercial_property', { menus: res.locals.menus });
});

router.get('/add_factory_property', requireLogin, (req, res) => {
    res.render('add_factory_property', { menus: res.locals.menus });
});

router.post('/listings/add', requireLogin, upload.array('images', 10), async (req, res) => {
    const body = req.body;
    let client;

    try {
        client = await pool.connect();
        
        const newImagePaths = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const newFileName = `${Date.now()}_${file.originalname}`;
                const { data, error } = await supabase.storage
                    .from('property-images')
                    .upload(newFileName, file.buffer, {
                        contentType: file.mimetype,
                        cacheControl: '3600',
                        upsert: false,
                    });
                if (error) {
                    throw new Error(`Supabase 업로드 실패: ${error.message}`);
                }
                const { data: { publicUrl } } = supabase.storage
                    .from('property-images')
                    .getPublicUrl(newFileName);
                newImagePaths.push(publicUrl);
            }
        }
        const image_path = newImagePaths.join(',');

        const query = `
            INSERT INTO properties (
                title, price, category, area, address, exclusive_area,
                approval_date, purpose, total_floors, floor, direction,
                direction_standard, transaction_type, parking, maintenance_fee,
                move_in_date, description, youtube_url, image_path
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `;

        const values = [
            body.title || null,
            body.price || null,
            body.category || null,
            body.area ? Number(body.area) : null,
            body.address || null,
            body.exclusive_area ? Number(body.exclusive_area) : null,
            body.approval_date || null,
            body.purpose || null,
            body.total_floors ? Number(body.total_floors) : null,
            body.floor ? Number(body.floor) : null,
            body.direction || null,
            body.direction_standard || null,
            body.transaction_type || null,
            body.parking ? Number(body.parking) : null,
            body.maintenance_fee ? Number(body.maintenance_fee) : null,
            body.move_in_date || null,
            body.description || null,
            body.youtube_url || null,
            image_path || null
        ];

        await client.query(query, values);

        res.redirect('/listings');

    } catch (err) {
        console.error('DB 삽입 오류 (새 매물):', err.stack);
        res.status(500).send(`매물 등록 중 오류가 발생했습니다: ${err.message}`);
    } finally {
        if (client) client.release();
    }
});

router.get('/listings', requireLogin, async (req, res) => {
    const { category } = req.query;
    let client;

    try {
        client = await pool.connect();
        let query = 'SELECT * FROM properties ORDER BY created_at DESC';
        const params = [];

        if (category) {
            query = 'SELECT * FROM properties WHERE category = $1 ORDER BY created_at DESC';
            params.push(category);
        }

        const result = await client.query(query, params);
        
        res.render('listings', {
            menus: res.locals.menus,
            properties: result.rows,
            currentCategory: category || null
        });

    } catch (err) {
        console.error('DB 조회 오류 (매물 목록):', err.stack);
        res.status(500).send('매물 목록을 불러오는 데 실패했습니다.');
    } finally {
        if (client) client.release();
    }
});

// For fetching property data for the edit modal
router.get('/api/property/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT * FROM properties WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: '매물을 찾을 수 없습니다.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('API DB 조회 오류:', err.stack);
        res.status(500).json({ message: '서버 오류' });
    } finally {
        if (client) client.release();
    }
});

// For handling property deletion
router.post('/listings/delete/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        const selectResult = await client.query('SELECT image_path FROM properties WHERE id = $1', [id]);
        if (selectResult.rows.length > 0) {
            const image_path = selectResult.rows[0].image_path;
            if (image_path) {
                const imagePaths = image_path.split(',');
                const filePaths = imagePaths.map(p => p.substring(p.lastIndexOf('/') + 1));
                
                const { error } = await supabase.storage.from('property-images').remove(filePaths);
                if (error) {
                    console.error('Supabase 스토리지 삭제 오류:', error);
                }
            }
        }

        await client.query('DELETE FROM properties WHERE id = $1', [id]);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삭제 오류:', err.stack);
        res.status(500).send('매물 삭제 중 오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});

// For handling property edit submission
router.post('/listings/edit/:id', requireLogin, upload.array('images', 10), async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        let existing_image_paths = (body.existing_image_paths && body.existing_image_paths.length > 0) ? body.existing_image_paths.split(',') : [];
        try {
            if (body.deleted_images) {
                const deleted_images = Array.isArray(body.deleted_images) ? body.deleted_images : [body.deleted_images];
                const filePathsToDelete = deleted_images.map(p => p.substring(p.lastIndexOf('/') + 1));
                
                if (filePathsToDelete.length > 0) {
                    const { error } = await supabase.storage.from('property-images').remove(filePathsToDelete);
                    if (error) throw new Error(`Supabase 이미지 삭제 실패: ${error.message}`);
                }
                existing_image_paths = existing_image_paths.filter(p => !deleted_images.includes(p));
            }
        } catch (e) {
            throw new Error(`이미지 삭제 중 오류: ${e.message}`);
        }

        const newImagePaths = [];
        try {
            if (req.files && req.files.length > 0) {
                for (const file of req.files) {
                    const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                    const originalname_base64 = Buffer.from(originalname_utf8).toString('base64');
                    const newFileName = `${Date.now()}_${originalname_base64}`;
                    const { error } = await supabase.storage
                        .from('property-images')
                        .upload(newFileName, file.buffer, {
                            contentType: file.mimetype,
                            cacheControl: '3600',
                            upsert: false,
                        });
                    if (error) {
                        throw new Error(`Supabase 업로드 실패: ${error.message}`);
                    }
                    const { data: { publicUrl } } = supabase.storage
                        .from('property-images')
                        .getPublicUrl(newFileName);
                    newImagePaths.push(publicUrl);
                }
            }
        } catch (e) {
            throw new Error(`이미지 업로드 중 오류: ${e.message}`);
        }
        
        const allImagePaths = [...existing_image_paths, ...newImagePaths].join(',');

        try {
            const fields = [
                'title', 'price', 'category', 'area', 'address', 'exclusive_area',
                'approval_date', 'purpose', 'total_floors', 'floor', 'direction',
                'direction_standard', 'transaction_type', 'parking', 'maintenance_fee',
                'move_in_date', 'description', 'youtube_url'
            ];
            
            const setClauses = fields.map((field, i) => `${field} = $${i + 1}`).join(', ');
            const values = fields.map(field => body[field] || null);

            const query = `
                UPDATE properties SET ${setClauses}, image_path = $${fields.length + 1}
                WHERE id = $${fields.length + 2}
            `;
            const queryParams = [...values, allImagePaths, id];

            await client.query(query, queryParams);
        } catch (e) {
            throw new Error(`데이터베이스 업데이트 중 오류: ${e.message}`);
        }

        await client.query('COMMIT');
        res.redirect('/listings');

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('DB 업데이트 오류 (매물 수정):', err.stack);
        res.status(500).send(err.message || '매물 수정 중 오류가 발생했습니다.');
    } finally {
        if (client) client.release();
    }
});

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
    let body = req.body;
    if (req.body instanceof Buffer) {
        try {
            body = JSON.parse(req.body.toString());
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid JSON format.' });
        }
    }

    const { type, name, contact_method, email, phone } = body;
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

app.use('/', router);
module.exports.handler = serverless(app);

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}