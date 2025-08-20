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

const router = express.Router();
router.use(loadSettings);

// ... (other routes are unchanged) ...

router.post('/listings/add', upload.array('images', 10), async (req, res) => {
    let body = req.body instanceof Buffer ? querystring.parse(req.body.toString()) : req.body;
    const imageUrls = [];
    if (req.files) {
        for (const file of req.files) {
            const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const newFileName = `${Date.now()}_${encodeURIComponent(originalname_utf8)}`;
            
            const watermarkTextKR = '군포첨단 탑공인중개사';
            const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';
            const svgKR = `<svg width="1600" height="300"><style>.title { fill: rgba(255, 255, 255, 0.7); font-size: 120px; font-weight: bold; font-family: "sans-serif"; }</style><text x="50%" y="50%" text-anchor="middle" class="title">${watermarkTextKR}</text></svg>`;
            const bufferKR = Buffer.from(svgKR);
            const svgEN = `<svg width="400" height="50"><style>.title { fill: rgba(255, 255, 255, 0.6); font-size: 20px; font-family: "sans-serif"; }</style><text x="95%" y="50%" text-anchor="end" class="title">${watermarkTextEN}</text></svg>`;
            const bufferEN = Buffer.from(svgEN);

            const watermarkedBuffer = await sharp(file.buffer).composite([{ input: bufferKR, gravity: 'center' },{ input: bufferEN, gravity: 'southeast' }]).toBuffer();

            const { data, error } = await supabase.storage.from('property-images').upload(newFileName, watermarkedBuffer, { contentType: file.mimetype });
            if (error) {
                console.error('Supabase 스토리지 업로드 오류:', error);
                return res.status(500).send('이미지 업로드에 실패했습니다.');
            }
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
        console.error('DB 삽입 오류 발생:', err.stack);
        res.status(500).send(`매물 등록에 실패했습니다. 서버 로그를 확인해주세요. 오류: ${err.message}`);
    } finally {
        if (client) client.release();
    }
});

router.post('/listings/edit/:id', upload.array('images', 10), async (req, res) => {
    const { id } = req.params;
    let body = req.body instanceof Buffer ? querystring.parse(req.body.toString()) : req.body;
    if (body.deleted_images) {
        const imagesToDelete = Array.isArray(body.deleted_images) ? body.deleted_images : [body.deleted_images];
        const fileNamesToDelete = imagesToDelete.map(url => url.split('/').pop());
        if (fileNamesToDelete.length > 0) {
            await supabase.storage.from('property-images').remove(fileNamesToDelete);
        }
    }
    let imageUrls = body.existing_image_paths ? body.existing_image_paths.split(',').filter(p => p) : [];
    if (req.files) {
        for (const file of req.files) {
            const newFileName = `${Date.now()}_${file.originalname}`;
            const watermarkTextKR = '군포첨단 탑공인중개사';
            const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';
            const svgKR = `<svg width="1600" height="300"><style>.title { fill: rgba(255, 255, 255, 0.7); font-size: 120px; font-weight: bold; font-family: "sans-serif"; }</style><text x="50%" y="50%" text-anchor="middle" class="title">${watermarkTextKR}</text></svg>`;
            const bufferKR = Buffer.from(svgKR);
            const svgEN = `<svg width="400" height="50"><style>.title { fill: rgba(255, 255, 255, 0.6); font-size: 20px; font-family: "sans-serif"; }</style><text x="95%" y="50%" text-anchor="end" class="title">${watermarkTextEN}</text></svg>`;
            const bufferEN = Buffer.from(svgEN);
            const watermarkedBuffer = await sharp(file.buffer).composite([{ input: bufferKR, gravity: 'center' },{ input: bufferEN, gravity: 'southeast' }]).toBuffer();
            const { data, error } = await supabase.storage.from('property-images').upload(newFileName, watermarkedBuffer, { contentType: file.mimetype });
            if (error) {
                console.error('Supabase 스토리지 업로드 오류:', error);
                return res.status(500).send('이미지 업로드에 실패했습니다.');
            }
            const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(newFileName);
            imageUrls.push(publicUrl);
        }
    }
    const image_paths = imageUrls.join(',');
    const { category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, youtube_url } = body;
    const query = `UPDATE properties SET category = $1, title = $2, price = $3, address = $4, area = $5, exclusive_area = $6, approval_date = $7, purpose = $8, total_floors = $9, floor = $10, direction = $11, direction_standard = $12, transaction_type = $13, parking = $14, maintenance_fee = $15, maintenance_fee_details = $16, power_supply = $17, hoist = $18, ceiling_height = $19, permitted_business_types = $20, access_road_condition = $21, move_in_date = $22, description = $23, image_path = $24, youtube_url = $25 WHERE id = $26`;
    const params = [category, title, price, address, area, exclusive_area, approval_date, purpose, total_floors, floor, direction, direction_standard, transaction_type, parking, maintenance_fee, maintenance_fee_details, power_supply, hoist, ceiling_height, permitted_business_types, access_road_condition, move_in_date, description, image_paths, youtube_url, id];
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

router.post('/board/:slug/write', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const { slug } = req.params;
    const { title, content, author, youtube_url } = req.body;
    let attachment_path_to_db = null;
    let thumbnail_url = null;
    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT id, board_type FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) return res.status(404).send('게시판을 찾을 수 없습니다.');
        const board = boardResult.rows[0];
        const boardId = board.id;
        if (board.board_type === 'youtube' && youtube_url) {
            const videoId = getYouTubeVideoId(youtube_url);
            thumbnail_url = getYouTubeThumbnailUrl(videoId);
        }
        let attachment_paths = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const originalname_base64 = Buffer.from(originalname_utf8).toString('base64');
                const newFileName = `${Date.now()}_${originalname_base64}`;
                let bufferToUpload = file.buffer;
                if (file.mimetype.startsWith('image/')) {
                    const watermarkTextKR = '군포첨단 탑공인중개사';
                    const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';
                    const svgKR = `<svg width="1600" height="300"><style>.title { fill: rgba(255, 255, 255, 0.7); font-size: 120px; font-weight: bold; font-family: "sans-serif"; }</style><text x="50%" y="50%" text-anchor="middle" class="title">${watermarkTextKR}</text></svg>`;
                    const bufferKR = Buffer.from(svgKR);
                    const svgEN = `<svg width="400" height="50"><style>.title { fill: rgba(255, 255, 255, 0.6); font-size: 20px; font-family: "sans-serif"; }</style><text x="95%" y="50%" text-anchor="end" class="title">${watermarkTextEN}</text></svg>`;
                    const bufferEN = Buffer.from(svgEN);
                    bufferToUpload = await sharp(file.buffer).composite([{ input: bufferKR, gravity: 'center' },{ input: bufferEN, gravity: 'southeast' }]).toBuffer();
                }
                const { error: uploadError } = await supabase.storage.from('attachments').upload(newFileName, bufferToUpload, { contentType: file.mimetype });
                if (uploadError) throw new Error(`Supabase upload error: ${uploadError.message}`);
                const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(newFileName);
                if (!urlData || !urlData.publicUrl) throw new Error('Failed to get public URL from Supabase.');
                attachment_paths.push(urlData.publicUrl);
            }
            if (board.board_type === 'gallery') {
                attachment_path_to_db = JSON.stringify(attachment_paths);
            } else {
                attachment_path_to_db = attachment_paths[0];
            }
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

router.post('/board/:slug/:postId/edit', requireLogin, upload.array('attachments', 10), async (req, res) => {
    const { slug, postId } = req.params;
    const { title, content, author, youtube_url, delete_attachment } = req.body;
    let client;
    try {
        client = await pool.connect();
        const boardResult = await client.query('SELECT id, board_type FROM boards WHERE slug = $1', [slug]);
        if (boardResult.rows.length === 0) return res.status(404).send('게시판을 찾을 수 없습니다.');
        const board = boardResult.rows[0];
        const postResult = await client.query('SELECT attachment_path FROM posts WHERE id = $1', [postId]);
        if (postResult.rows.length === 0) return res.status(404).send('수정할 게시글을 찾을 수 없습니다.');
        let current_attachment_path = postResult.rows[0].attachment_path;
        let attachment_path_to_db = current_attachment_path;
        if (delete_attachment) {
            const attachments_to_delete = Array.isArray(delete_attachment) ? delete_attachment : [delete_attachment];
            if (attachments_to_delete.length > 0) {
                const fileNamesToDelete = attachments_to_delete.map(url => url.split('/').pop());
                await supabase.storage.from('attachments').remove(fileNamesToDelete);
                if (board.board_type === 'gallery') {
                    const remaining_attachments = JSON.parse(current_attachment_path || '[]').filter(url => !attachments_to_delete.includes(url));
                    attachment_path_to_db = JSON.stringify(remaining_attachments);
                } else {
                    attachment_path_to_db = null;
                }
            }
        }
        let new_attachment_paths = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const originalname_utf8 = Buffer.from(file.originalname, 'latin1').toString('utf8');
                const originalname_base64 = Buffer.from(originalname_utf8).toString('base64');
                const newFileName = `${Date.now()}_${originalname_base64}`;
                let bufferToUpload = file.buffer;
                if (file.mimetype.startsWith('image/')) {
                    const watermarkTextKR = '군포첨단 탑공인중개사';
                    const watermarkTextEN = 'Gunpo Cheomdan Top Real Estate';
                    const svgKR = `<svg width="1600" height="300"><style>.title { fill: rgba(255, 255, 255, 0.7); font-size: 120px; font-weight: bold; font-family: "sans-serif"; }</style><text x="50%" y="50%" text-anchor="middle" class="title">${watermarkTextKR}</text></svg>`;
                    const bufferKR = Buffer.from(svgKR);
                    const svgEN = `<svg width="400" height="50"><style>.title { fill: rgba(255, 255, 255, 0.6); font-size: 20px; font-family: "sans-serif"; }</style><text x="95%" y="50%" text-anchor="end" class="title">${watermarkTextEN}</text></svg>`;
                    const bufferEN = Buffer.from(svgEN);
                    bufferToUpload = await sharp(file.buffer).composite([{ input: bufferKR, gravity: 'center' },{ input: bufferEN, gravity: 'southeast' }]).toBuffer();
                }
                const { error: uploadError } = await supabase.storage.from('attachments').upload(newFileName, bufferToUpload, { contentType: file.mimetype });
                if (uploadError) throw new Error(`Supabase upload error: ${uploadError.message}`);
                const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(newFileName);
                if (!urlData || !urlData.publicUrl) throw new Error('Failed to get public URL.');
                new_attachment_paths.push(urlData.publicUrl);
            }
            if (board.board_type === 'gallery') {
                const existing_attachments = JSON.parse(attachment_path_to_db || '[]');
                attachment_path_to_db = JSON.stringify([...existing_attachments, ...new_attachment_paths]);
            } else {
                attachment_path_to_db = new_attachment_paths[0];
            }
        }
        let thumbnail_url = null;
        if (board.board_type === 'youtube' && youtube_url) {
            const videoId = getYouTubeVideoId(youtube_url);
            thumbnail_url = getYouTubeThumbnailUrl(videoId);
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

// ... (rest of the file is unchanged) ...

app.use('/', router);
module.exports.handler = serverless(app);

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`로컬 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}
