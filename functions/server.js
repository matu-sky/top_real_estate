const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');
const multer = require('multer');
const serverless = require('serverless-http'); // serverless-http 추가

const app = express();

// Netlify 함수 환경에서는 __dirname이 functions 폴더를 가리키므로,
// 프로젝트 루트를 기준으로 경로를 재설정해야 합니다.
const projectRoot = path.resolve(__dirname, '..');

// --- 데이터베이스 연결 ---
// 중요: Netlify의 파일 시스템은 일시적입니다. 
// 배포 시마다 데이터베이스 파일이 초기화될 수 있으며, 런타임 중 쓰기 작업은 영구 저장되지 않습니다.
// 프로덕션 환경에서는 클라우드 기반 데이터베이스(예: PlanetScale, Supabase) 사용을 강력히 권장합니다.
const dbPath = path.join(projectRoot, 'data', 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('데이터베이스 연결 실패:', err.message);
    } else {
        console.log('데이터베이스에 성공적으로 연결되었습니다.');
        // properties 테이블 생성 (모든 컬럼 포함)
        db.run(`CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            price TEXT,
            address TEXT,
            area REAL, -- 주거용: 면적, 공장/지산: 분양면적
            exclusive_area REAL, -- 공장/지산: 전용면적
            approval_date TEXT,
            purpose TEXT,
            total_floors INTEGER,
            floor INTEGER,
            direction TEXT,
            direction_standard TEXT,
            transaction_type TEXT,
            parking INTEGER,
            maintenance_fee INTEGER,
            maintenance_fee_details TEXT, -- [신규] 관리비 상세
            power_supply TEXT, -- 공장/지산: 사용전력
            hoist TEXT, -- 공장/지산: 호이스트
            ceiling_height REAL, -- 공장/지산: 층고
            permitted_business_types TEXT, -- [신규] 가능 업종
            access_road_condition TEXT, -- [신규] 진입로 사정
            move_in_date TEXT,
            description TEXT,
            image_path TEXT, -- 다중 이미지 경로 (쉼표로 구분)
            youtube_url TEXT,
            status TEXT DEFAULT '게시중',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('테이블 생성 실패:', err.message);
            }
        });
    }
});

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
router.get('/', (req, res) => {
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        let content = {};
        if (!err) {
            content = JSON.parse(data);
        }

        const query = "SELECT * FROM properties ORDER BY created_at DESC LIMIT 4";
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('DB 조회 오류:', err.message);
                return res.render('index', { content: content, properties: [] });
            }
            
            const processedRows = rows.map(row => {
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

            res.render('index', { content: content, properties: processedRows });
        });
    });
});

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login');
});

// 로그인 처리
router.post('/login', (req, res) => {
    const { username, password } = req.body;

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
router.get('/dashboard', (req, res) => {
    const queries = {
        totalProperties: "SELECT COUNT(*) as count FROM properties",
        propertiesByCategory: "SELECT category, COUNT(*) as count FROM properties GROUP BY category"
    };

    db.get(queries.totalProperties, [], (err, total) => {
        if (err) return res.status(500).send("데이터베이스 오류");
        db.all(queries.propertiesByCategory, [], (err, categories) => {
            if (err) return res.status(500).send("데이터베이스 오류");

            res.render('dashboard', { 
                menus: res.locals.menus, 
                stats: {
                    total: total.count,
                    byCategory: categories
                }
            });
        });
    });
});

// 게시판 설정 페이지
router.get('/admin/board_settings', (req, res) => {
    res.render('board_settings', { menus: res.locals.menus });
});

// 매물 관리 페이지
router.get('/listings', (req, res) => {
    const category = req.query.category;
    let query = "SELECT * FROM properties";
    const params = [];

    if (category) {
        query += " WHERE category = ?";
        params.push(category);
    }

    query += " ORDER BY created_at DESC";

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('DB 조회 오류:', err.message);
            return res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
        }
        res.render('listings', { 
            properties: rows, 
            menus: res.locals.menus, 
            currentCategory: category
        });
    });
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
router.post('/listings/add', upload.array('images', 10), (req, res) => {
    // 중요: Netlify에서는 /tmp에 저장된 파일은 영구적이지 않으며,
    // 'uploads/' 경로로 직접 접근할 수 없습니다.
    // 이 로직은 외부 스토리지(S3 등)와 연동해야 정상 작동합니다.
    const image_paths = req.files ? req.files.map(file => file.path).join(',') : null;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = req.body;

    const query = `INSERT INTO properties (
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_path, youtube_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(query, [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url
    ], function(err) {
        if (err) {
            console.error('DB 삽입 오류:', err.message);
            res.status(500).send("매물 등록에 실패했습니다.");
            return;
        }
        res.redirect('/listings');
    });
});

// ✅ [신규] 매물 수정
router.post('/listings/edit/:id', upload.array('images', 10), (req, res) => {
    const { id } = req.params;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = req.body;
    
    let image_paths = req.body.existing_image_paths || '';
    if (req.files && req.files.length > 0) {
        const new_image_paths = req.files.map(file => file.path).join(',');
        image_paths = image_paths ? [image_paths, new_image_paths].filter(p => p).join(',') : new_image_paths;
    }

    const query = `UPDATE properties SET 
        category = ?, title = ?, price = ?, address = ?, area = ?, exclusive_area = ?, approval_date = ?, purpose = ?, total_floors = ?, floor = ?, direction = ?, direction_standard = ?, transaction_type = ?, parking = ?, maintenance_fee = ?, maintenance_fee_details = ?, power_supply = ?, hoist = ?, ceiling_height = ?, permitted_business_types = ?, access_road_condition = ?, move_in_date = ?, description = ?, image_path = ?, youtube_url = ?
    WHERE id = ?`;

    db.run(query, [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url, id
    ], function(err) {
        if (err) {
            console.error('DB 수정 오류:', err.message);
            res.status(500).send("매물 수정에 실패했습니다.");
            return;
        }
        res.redirect('/listings');
    });
});

// ✅ [신규] 매물 삭제
router.post('/listings/delete/:id', (req, res) => {
    const { id } = req.params;

    db.get("SELECT image_path FROM properties WHERE id = ?", [id], (err, row) => {
        if (err) {
            return res.status(500).send("오류가 발생했습니다.");
        }

        const query = "DELETE FROM properties WHERE id = ?";
        db.run(query, id, function(err) {
            if (err) {
                console.error('DB 삭제 오류:', err.message);
                res.status(500).send("매물 삭제에 실패했습니다.");
                return;
            }
            // 중요: Netlify 환경에서는 이 로직이 예상대로 동작하지 않을 수 있습니다.
            if (row && row.image_path) {
                 const images = row.image_path.split(',');
                 images.forEach(p => {
                    fs.unlink(p, (err) => {
                        if (err) console.error('이미지 파일 삭제 실패:', err);
                    });
                 });
            }
            res.redirect('/listings');
        });
    });
});


// 매물 상세 페이지
router.get('/property/:id', (req, res) => {
    const { id } = req.params;
    const contentPath = path.join(projectRoot, 'data', 'homepage_content.json');

    fs.readFile(contentPath, 'utf8', (err, data) => {
        let content = {};
        if (!err) {
            content = JSON.parse(data);
        }

        const query = "SELECT * FROM properties WHERE id = ?";
        db.get(query, [id], (err, row) => {
            if (err) {
                console.error('DB 조회 오류:', err.message);
                return res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
            }
            if (row) {
                if (row.address) {
                    const addressParts = row.address.split(' ');
                    row.short_address = addressParts.slice(0, 3).join(' ');
                }
                res.render('property_detail', { property: row, content: content });
            } else {
                res.status(404).send("매물을 찾을 수 없습니다.");
            }
        });
    });
});

// API: 특정 매물 정보 가져오기
router.get('/api/property/:id', requireLoginAndLoadMenus, (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM properties WHERE id = ?";

    db.get(query, [id], (err, row) => {
        if (err) {
            console.error('API DB 조회 오류:', err.message);
            return res.status(500).json({ error: '데이터베이스 오류' });
        }
        if (row) {
            res.json(row);
        }
        else {
            res.status(404).json({ error: '매물을 찾을 수 없습니다.' });
        }
    });
});

// Express 앱에 라우터 마운트
// serverless-http가 경로를 자동으로 처리하므로, 기본 경로('/')에 라우터를 마운트합니다.
app.use('/', router);


// --- 서버리스 핸들러 ---
module.exports.handler = serverless(app);