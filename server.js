const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');
const multer = require('multer');

const app = express();
const port = 8080; // Cloud Shell 환경을 위해 8080 포트 사용

// --- 데이터베이스 연결 ---
const dbPath = path.resolve(__dirname, 'data', 'database.db');
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
            power_supply TEXT, -- 공장/지산: 사용전력
            hoist TEXT, -- 공장/지산: 호이스트
            ceiling_height REAL, -- 공장/지산: 층고
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
const menuFilePath = path.join(__dirname, 'data', 'menu_settings.json');

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
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- 미들웨어 설정 ---
// 정적 파일 (CSS, JS, 이미지) 제공
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));


// 세션 미들웨어 설정
app.use(session({
    secret: 'your-secret-key', // 실제 프로덕션 환경에서는 강력한 키 사용
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // HTTPS를 사용한다면 true로 변경
}));

// --- 뷰 엔진 설정 ---
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);


// --- 라우팅(Routing) ---
// 메인 페이지
app.get('/', (req, res) => {
    const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        let content = {};
        if (!err) {
            content = JSON.parse(data);
        }

        const query = "SELECT * FROM properties ORDER BY created_at DESC LIMIT 4";
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('DB 조회 오류:', err.message);
                // 오류가 발생해도 페이지는 렌더링하도록 rows를 빈 배열로 설정
                return res.render('index', { content: content, properties: [] });
            }
            res.render('index', { content: content, properties: rows });
        });
    });
});

// 로그인 페이지 렌더링
app.get('/login', (req, res) => {
    res.render('login');
});

// 로그인 처리
app.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password } = req.body;

    // 사용자 인증 (실제 앱에서는 데이터베이스와 비교해야 함)
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
        res.locals.menus = menus; // 템플릿에서 사용할 수 있도록 menus를 res.locals에 저장
        next();
    });
}

// 모든 관리자 페이지 라우트에 미들웨어 적용
app.use('/admin', requireLoginAndLoadMenus);
app.use('/dashboard', requireLoginAndLoadMenus);
app.use('/listings', requireLoginAndLoadMenus);

// 홈페이지 관리 페이지
app.get('/admin', (req, res) => {
    const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        let content = {};
        if (err) {
            // 파일이 없거나 읽기 오류 시 기본값 설정
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
app.post('/admin/update', requireLoginAndLoadMenus, (req, res) => {
    const contentPath = path.join(__dirname, 'data', 'homepage_content.json');

    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            console.error('파일 읽기 오류:', err);
            return res.status(500).send('콘텐츠 파일을 읽는 데 실패했습니다.');
        }

        let content = JSON.parse(data);

        // 외과수술식 업데이트: 폼에서 넘어온 데이터 키만 정확히 업데이트합니다.
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
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/admin');
        }
        res.redirect('/');
    });
});

// 대시보드 페이지
app.get('/dashboard', (req, res) => {
    res.render('dashboard', { menus: res.locals.menus });
});

// 게시판 설정 페이지
app.get('/admin/board_settings', (req, res) => {
    res.render('board_settings', { menus: res.locals.menus });
});

// 매물 관리 페이지
app.get('/listings', (req, res) => {
    const query = "SELECT * FROM properties ORDER BY created_at DESC";
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('DB 조회 오류:', err.message);
            res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
            return;
        }
        res.render('listings', { properties: rows, menus: res.locals.menus });
    });
});

// --- 홈페이지 메뉴 관리 ---
app.get('/admin/menu', (req, res) => {
    const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('콘텐츠 파일을 읽을 수 없습니다.');
        }
        const content = JSON.parse(data);
        res.render('menu_settings', { menus: res.locals.menus, content: content });
    });
});

app.post('/admin/menu/update', (req, res) => {
    const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
    fs.readFile(contentPath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('콘텐츠 파일을 읽을 수 없습니다.');
        }
        let content = JSON.parse(data);
        
        // 폼에서 전송된 데이터로 메뉴 링크 업데이트
        // req.body.links가 없는 경우를 대비하여 빈 배열로 처리
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
app.post('/listings/add', upload.array('images', 10), (req, res) => { // 'images' 필드에서 최대 10개 파일
    const image_paths = req.files ? req.files.map(file => '/uploads/' + file.filename).join(',') : null;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, power_supply, hoist, ceiling_height, move_in_date, description, youtube_url } = req.body;

    const query = `INSERT INTO properties (
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, power_supply, hoist, ceiling_height, move_in_date, description, image_path, youtube_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(query, [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, power_supply, hoist, ceiling_height, move_in_date, description, image_paths, youtube_url
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
app.post('/listings/edit/:id', upload.array('images', 10), (req, res) => {
    const { id } = req.params;
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, power_supply, hoist, ceiling_height, move_in_date, description, youtube_url } = req.body;
    
    let image_paths = req.body.existing_image_paths || '';
    if (req.files && req.files.length > 0) {
        const new_image_paths = req.files.map(file => '/uploads/' + file.filename).join(',');
        image_paths = image_paths ? image_paths + ',' + new_image_paths : new_image_paths;
    }

    const query = `UPDATE properties SET 
        category = ?, title = ?, price = ?, address = ?, area = ?, exclusive_area = ?, approval_date = ?, purpose = ?, total_floors = ?, floor = ?, direction = ?, direction_standard = ?, transaction_type = ?, parking = ?, maintenance_fee = ?, power_supply = ?, hoist = ?, ceiling_height = ?, move_in_date = ?, description = ?, image_path = ?, youtube_url = ?
    WHERE id = ?`;

    db.run(query, [
        category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, power_supply, hoist, ceiling_height, move_in_date, description, image_paths, youtube_url, id
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
app.post('/listings/delete/:id', (req, res) => {
    const { id } = req.params;

    // 먼저 삭제할 매물의 이미지 경로를 가져옴
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
            // DB에서 성공적으로 삭제 후, 이미지 파일도 삭제
            if (row && row.image_path) {
                fs.unlink(path.join(__dirname, 'public', row.image_path), (err) => {
                    if (err) console.error('이미지 파일 삭제 실패:', err);
                });
            }
            res.redirect('/listings');
        });
    });
});


// 매물 상세 페이지
app.get('/property/:id', (req, res) => {
    const { id } = req.params;
    const query = "SELECT * FROM properties WHERE id = ?";

    db.get(query, [id], (err, row) => {
        if (err) {
            console.error('DB 조회 오류:', err.message);
            return res.status(500).send("매물 정보를 가져오는 데 실패했습니다.");
        }
        if (row) {
            res.render('property_detail', { property: row });
        }
        else {
            res.status(404).send("매물을 찾을 수 없습니다.");
        }
    });
});

// --- 서버 시작 ---
app.listen(port, '0.0.0.0', () => {
    console.log(`서버가 http://localhost:${port} 에서 실행 중입니다.`);
});

// 앱 종료 시 데이터베이스 연결 닫기
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            return console.error(err.message);
        }
        console.log('데이터베이스 연결이 종료되었습니다.');
        process.exit(0);
    });
});