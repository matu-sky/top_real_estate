const express = require('express');
const path = require('path');

const session = require('express-session');
const fs = require('fs');
const multer = require('multer');
const serverless = require('serverless-http'); // serverless-http 추가
const querystring = require('querystring');

const app = express();

// Netlify 함수 환경에서는 __dirname이 functions 폴더를 가리키므로,
// 프로젝트 루트를 기준으로 경로를 재설정해야 합니다.
const projectRoot = path.resolve(__dirname, '..');

const { Pool } = require('pg');
const { parse } = require('pg-connection-string');

// --- 데이터베이스 연결 ---
// Supabase 연결 정보를 Netlify 환경 변수에서 가져옵니다.
// 로컬 테스트 시에는 .env 파일(git에 포함되지 않음)을 통해 환경 변수를 로드할 수 있습니다.
console.log('Attempting to connect with DATABASE_URL:', process.env.DATABASE_URL); // 디버깅 로그 추가
const connectionString = process.env.DATABASE_URL;
const config = parse(connectionString);

const pool = new Pool({
    ...config,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('데이터베이스 연결 오류', err.stack);
    }
    console.log('Supabase 데이터베이스에 성공적으로 연결되었습니다.');
    client.release();
});

// 기존 properties 테이블 생성 로직은 SQL 파일이나 Supabase 대시보드에서 직접 관리하는 것이 좋습니다.
// 여기서는 앱 실행 시마다 확인하지 않습니다.

// --- 메뉴 데이터 로더 ---
const menuFilePath = path.join(projectRoot, 'data', 'menu_settings.json');

function getMenus(callback) {
    fs.readFile(menuFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('메뉴 파일 읽기 오류:', err);
            return callback(err, []);
        }
        try {
            const menus = JSON.parse(data);
            callback(null, menus);
        } catch (parseErr) {
            console.error('메뉴 파일 파싱 오류:', parseErr);
            callback(parseErr, []);
        }
    });
}

function saveMenus(menus, callback) {
    fs.writeFile(menuFilePath, JSON.stringify(menus, null, 2), 'utf8', callback);
}


// --- 파일 업로드 설정 ---
// 중요: Netlify 함수 환경의 파일 시스템은 읽기 전용입니다 (예외: /tmp).
// public/uploads/ 에 직접 파일을 저장할 수 없습니다.
// 이미지 같은 사용자 업로드 파일은 Cloudinary, AWS S3 같은 외부 스토리지 서비스에 저장해야 합니다.
const uploadDir = '/tmp/uploads';
fs.mkdirSync(uploadDir, { recursive: true }); // 임시 업로드 디렉토리 생성

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- 미들웨어 설정 ---
// 정적 파일 경로 수정
app.use(express.static(path.join(projectRoot, 'public')));
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


// --- 라우팅(Routing) ---
// 라우터 경로 수정: Netlify 함수는 단일 엔드포인트에서 실행되므로, 
// Express 앱이 모든 경로를 처리하도록 app.use()의 기본 경로를 수정해야 할 수 있습니다.
// 여기서는 Netlify의 redirects 규칙을 사용하므로 Express 코드는 그대로 둡니다.
const router = express.Router();

// 메인 페이지
router.get('/', async (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    let content = {};
    try {
        const data = fs.readFileSync(contentPath, 'utf8');
        content = JSON.parse(data);
    } catch (err) {
        console.error('콘텐츠 파일 읽기 오류:', err);
    }

    try {
        const query = "SELECT * FROM properties ORDER BY created_at DESC LIMIT 4";
        const result = await pool.query(query);
        const properties = result.rows.map(row => {
            if (row.address) {
                const addressParts = row.address.split(' ');
                let shortAddress = addressParts[0];
                if (addressParts.length > 1) {
                    shortAddress += ' ' + addressParts[1];
                }
                if (addressParts.length > 2 && (addressParts[2].endsWith('동') || addressParts[2].endsWith('읍') || addressParts[2].endsWith('면'))) {
                    shortAddress += ' ' + addressParts[2];
                }
                row.short_address = shortAddress;
            } else {
                row.short_address = '주소 정보 없음';
            }
            return row;
        });
        res.render('index', { content, properties });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.render('index', { content, properties: [] });
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

// 인증 확인 및 메뉴 로드 미들웨어
function requireLoginAndLoadMenus(req, res, next) {
    if (!req.session.loggedin) {
        return res.redirect('/login');
    }
    getMenus((err, menus) => {
        if (err) {
            return res.status(500).send('메뉴를 불러올 수 없습니다.');
        }
        res.locals.menus = menus;
        next();
    });
}

// 모든 관리자 페이지 라우트에 미들웨어 적용
router.use('/admin', requireLoginAndLoadMenus);
router.use('/dashboard', requireLoginAndLoadMenus);
router.use('/listings', requireLoginAndLoadMenus);
router.use('/add_property', requireLoginAndLoadMenus);

// 홈페이지 관리 페이지
router.get('/admin', (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        let content = {};
        if (err) {
            content = {
                hero_title: '최고의 공간,\n데이터로 증명하는 가치',
                hero_subtitle: '군포첨단탑공인중개사는 감각적인 안목과 정확한 데이터로 당신의 선택을 돕습니다.',
                lifestyle_card1_title: '내 집 마련의 꿈',
                lifestyle_card1_desc: '가족의 행복이 자라는 포근한 보금자리',
                lifestyle_card2_title: '성공적인 비즈니스',
                lifestyle_card2_desc: '최적의 입지에서 시작하는 당신의 사업 (상가, 공장, 지식산업센터 전문)',
                lifestyle_card3_title: '안정적인 수익형 투자',
                lifestyle_card3_desc: '미래를 준비하는 현명한 자산 관리',
                consulting_title: '단순한 중개를 넘어,\n지역 최고의 파트너가 되겠습니다.',
                consulting_desc: '군포첨단탑공인중개사는 다년간의 경험과 데이터 분석을 통해 군포시의 부동산 시장을 가장 깊이 이해하고 있습니다. 주거용 부동산은 물론, 상가, 공장, 지식산업센터 등 특수 목적의 비주거용 부동산에 대한 깊이 있는 컨설팅을 제공합니다. 법률, 세무, 대출까지 원스톱으로 이어지는 전문가 네트워크를 통해 복잡한 부동산 거래를 가장 쉽고 안전하게 해결해 드립니다.',
                consulting_button_text: '컨설팅 상담 신청'
            };
        } else {
            content = JSON.parse(data);
        }
        res.render('admin', { content: content, menus: res.locals.menus });
    });
});

// 홈페이지 관리 정보 업데이트
router.post('/admin/update', requireLoginAndLoadMenus, (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');

    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            console.error('파일 읽기 오류:', err);
            return res.status(500).send('콘텐츠 파일을 읽는 데 실패했습니다.');
        }

        let content = JSON.parse(data);

        for (const key in req.body) {
            if (Object.prototype.hasOwnProperty.call(content, key)) {
                content[key] = req.body[key];
            }
        }

        fs.writeFile(contentPath, JSON.stringify(content, null, 2), 'utf8', (writeErr) => {
            if (writeErr) {
                console.error('파일 쓰기 오류:', writeErr);
                return res.status(500).send('콘텐츠 업데이트에 실패했습니다.');
            }
            res.redirect('/admin');
        });
    });
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
    try {
        const totalQuery = "SELECT COUNT(*) AS count FROM properties";
        const categoryQuery = "SELECT category, COUNT(*) AS count FROM properties GROUP BY category";

        const totalResult = await pool.query(totalQuery);
        const categoryResult = await pool.query(categoryQuery);

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

    try {
        const result = await pool.query(query, params);
        res.render('listings', { 
            properties: result.rows, 
            menus: res.locals.menus, 
            currentCategory: category
        });
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
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
router.get('/admin/menu', (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('콘텐츠 파일을 읽을 수 없습니다.');
        }
        const content = JSON.parse(data);
        res.render('menu_settings', { menus: res.locals.menus, content: content });
    });
});

router.post('/admin/menu/update', (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('콘텐츠 파일을 읽을 수 없습니다.');
        }
        let content = JSON.parse(data);
        
        content.header_nav_links = req.body.links || [];

        fs.writeFile(contentPath, JSON.stringify(content, null, 2), 'utf8', (err) => {
            if (err) {
                return res.status(500).send('메뉴 저장에 실패했습니다.');
            }
            res.redirect('/admin/menu');
        });
    });
});


// ✅ [신규] 새 매물 추가: 폼에서 전송된 데이터를 DB에 저장
router.post('/listings/add', upload.array('images', 10), async (req, res) => {
    const image_paths = req.files ? req.files.map(file => file.path).join(',') : null;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = req.body;

    const query = `INSERT INTO properties (
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_path, youtube_url
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`;

    const params = [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url
    ];

    try {
        await pool.query(query, params);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삽입 오류:', err.stack);
        res.status(500).send("매물 등록에 실패했습니다.");
    }
});

// ✅ [신규] 매물 수정
router.post('/listings/edit/:id', upload.array('images', 10), async (req, res) => {
    const { id } = req.params;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = req.body;
    
    let image_paths = req.body.existing_image_paths || '';
    if (req.files && req.files.length > 0) {
        const new_image_paths = req.files.map(file => file.path).join(',');
        image_paths = image_paths ? [image_paths, new_image_paths].filter(p => p).join(',') : new_image_paths;
    }

    const query = `UPDATE properties SET 
        category = $1, title = $2, price = $3, address = $4, area = $5, exclusive_area = $6, approval_date = $7, purpose = $8, total_floors = $9, floor = $10, direction = $11, direction_standard = $12, transaction_type = $13, parking = $14, maintenance_fee = $15, maintenance_fee_details = $16, power_supply = $17, hoist = $18, ceiling_height = $19, permitted_business_types = $20, access_road_condition = $21, move_in_date = $22, description = $23, image_path = $24, youtube_url = $25
    WHERE id = $26`;

    const params = [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url, id
    ];

    try {
        await pool.query(query, params);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 수정 오류:', err.stack);
        res.status(500).send("매물 수정에 실패했습니다.");
    }
});

// ✅ [신규] 매물 삭제
router.post('/listings/delete/:id', async (req, res) => {
    const { id } = req.params;
    const query = "DELETE FROM properties WHERE id = $1";

    try {
        await pool.query(query, [id]);
        res.redirect('/listings');
    } catch (err) {
        console.error('DB 삭제 오류:', err.stack);
        res.status(500).send("매물 삭제에 실패했습니다.");
    }
});


// 매물 상세 페이지
router.get('/property/:id', async (req, res) => {
    const { id } = req.params;
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    let content = {};
    try {
        const data = fs.readFileSync(contentPath, 'utf8');
        content = JSON.parse(data);
    } catch (err) {
        console.error('콘텐츠 파일 읽기 오류:', err);
    }

    try {
        const query = "SELECT * FROM properties WHERE id = $1";
        const result = await pool.query(query, [id]);
        const property = result.rows[0];

        if (property) {
            if (property.address) {
                const addressParts = property.address.split(' ');
                property.short_address = addressParts.slice(0, 3).join(' ');
            }
            res.render('property_detail', { property, content });
        } else {
            res.status(404).send("매물을 찾을 수 없습니다.");
        }
    } catch (err) {
        console.error('DB 조회 오류:', err.stack);
        res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
    }
});

// API: 특정 매물 정보 가져오기
router.get('/api/property/:id', requireLoginAndLoadMenus, async (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM properties WHERE id = $1";

    try {
        const result = await pool.query(query, [id]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: '매물을 찾을 수 없습니다.' });
        }
    } catch (err) {
        console.error('API DB 조회 오류:', err.stack);
        res.status(500).json({ error: '데이터베이스 오류' });
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