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
            // 값이 JSON 형태일 경우 객체로 파싱
            settings[row.key] = JSON.parse(row.value);
        } catch (e) {
            // 파싱 실패 시 일반 텍스트로 사용
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
// 뷰 디렉토리 경로 수정
app.set('views', path.join(projectRoot, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);


// 모든 페이지에 설정을 로드하는 미들웨어
async function loadSettings(req, res, next) {
    let client;
    try {
        client = await pool.connect();
        res.locals.settings = await getSettings(client);
        // 메뉴(네비게이션 링크)는 content 객체 안에 포함되어 있음
        res.locals.menus = res.locals.settings.header_nav_links || [];
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

// 메인 페이지
router.get('/', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query("SELECT * FROM properties ORDER BY created_at DESC LIMIT 4");
        const properties = result.rows.map(row => {
            if (row.address) {
                const addressParts = row.address.split(' ');
                row.short_address = addressParts.slice(0, 3).join(' ');
            }
            return row;
        });
        res.render('index', { content: res.locals.settings, properties });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.render('index', { content: res.locals.settings, properties: [] });
    } finally {
        if (client) client.release();
    }
});

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login');
});

// 로그인 처리
router.post('/login', (req, res) => {
    // Netlify 환경에서 Buffer로 들어오는 body를 파싱
    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }
    console.log('Login attempt with parsed body:', body); // 디버깅 로그 수정
    const { username, password } = body;

    if (username === 'as123' && password === 'asd123') {
        req.session.loggedin = true;
        res.redirect('/admin');
    } else {
        res.send('Incorrect Username and/or Password!');
    }
});

// 인증 확인 미들웨어 (메뉴 로드는 loadSettings에서 처리)
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

// 홈페이지 관리 페이지
router.get('/admin', (req, res) => {
    res.render('admin', { content: res.locals.settings, menus: res.locals.menus });
});

// 홈페이지 관리 정보 업데이트
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
        await client.query('BEGIN'); // 트랜잭션 시작

        for (const key in body) {
            if (Object.prototype.hasOwnProperty.call(res.locals.settings, key)) {
                const valueToStore = body[key];
                await client.query(
                    'UPDATE site_settings SET value = $1 WHERE key = $2',
                    [valueToStore, key]
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
router.get('/admin/board_settings', (req, res) => {
    res.render('board_settings', { menus: res.locals.menus });
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
router.get('/add_property', requireLoginAndLoadMenus, (req, res) => {
    res.render('add_property', { menus: res.locals.menus });
});

// 새 상업용 매물 등록 페이지
router.get('/add_commercial_property', requireLoginAndLoadMenus, (req, res) => {
    res.render('add_commercial_property', { menus: res.locals.menus });
});

// 새 공장/지산 매물 등록 페이지
router.get('/add_factory_property', requireLoginAndLoadMenus, (req, res) => {
    res.render('add_factory_property', { menus: res.locals.menus });
});

// --- 홈페이지 메뉴 관리 ---
router.get('/admin/menu', requireLogin, (req, res) => {
    res.render('menu_settings', { menus: res.locals.menus, content: res.locals.settings });
});

router.post('/admin/menu/update', requireLogin, async (req, res) => {
    const links = req.body.links || [];
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
router.post('/listings/add', async (req, res) => {
    console.log('--- 매물 등록 요청 시작 ---');
    console.log('요청 본문:', req.body);
    console.log('업로드된 파일:', req.files ? req.files.length + '개' : '없음');

    let body = {};
    if (req.body instanceof Buffer) {
        body = querystring.parse(req.body.toString());
    } else {
        body = req.body;
    }

    const image_paths = body.image_urls || '';
    console.log('생성된 이미지 경로 문자열:', image_paths);

    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = body;

    const query = `INSERT INTO properties (
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_path, youtube_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
    RETURNING id;`; // RETURNING id 추가하여 삽입된 행의 id를 반환받음

    const params = [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url
    ];

    console.log('데이터베이스에 매물 정보 삽입 시도...');
    console.log('쿼리:', query);
    console.log('파라미터:', params);

    let client;
    try {
        console.log('데이터베이스 풀에서 클라이언트 가져오는 중...');
        client = await pool.connect();
        console.log('클라이언트 가져오기 성공.');

        const result = await client.query(query, params);
        console.log('DB 삽입 성공! 삽입된 매물 ID:', result.rows[0].id);
        
        console.log('매물 목록 페이지로 리디렉션...');
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삽입 오류 발생:', err.stack);
        // 사용자에게 좀 더 구체적인 오류 메시지를 보낼 수 있습니다.
        res.status(500).send(`매물 등록에 실패했습니다. 서버 로그를 확인해주세요. 오류: ${err.message}`);
    } finally {
        if (client) {
            console.log('데이터베이스 클라이언트 반환.');
            client.release();
        }
        console.log('--- 매물 등록 요청 종료 ---');
    }
});

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
            const newFileName = `${Date.now()}_${file.originalname}`;
            const { data, error } = await supabase.storage
                .from('property-images')
                .upload(newFileName, file.buffer, {
                    contentType: file.mimetype,
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
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = req.body;

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
                const addressParts = property.address.split(' ');
                property.short_address = addressParts.slice(0, 3).join(' ');
            }
            res.render('property_detail', { property, content: res.locals.settings });
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
}