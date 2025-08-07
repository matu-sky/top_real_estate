
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// .env 파일에 PG_HOST, PG_USER 등이 설정되어 있어야 합니다.
const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    const client = await pool.connect();
    console.log('데이터베이스에 연결되었습니다.');

    try {
        // 1. setup_db.sql 파일 읽기
        const sql = fs.readFileSync(path.join(__dirname, 'setup_db.sql'), 'utf8');
        // 2. SQL 쿼리 실행
        await client.query(sql);
        console.log('성공: "setup_db.sql" 파일의 모든 쿼리를 실행했습니다.');

        // 3. homepage_content.json 파일 읽기
        const contentPath = path.join(__dirname, 'data', 'homepage_content.json');
        const data = fs.readFileSync(contentPath, 'utf8');
        const content = JSON.parse(data);
        console.log('성공: "homepage_content.json" 파일을 읽었습니다.');

        // 4. JSON 데이터를 데이터베이스에 삽입/업데이트
        for (const [key, value] of Object.entries(content)) {
            // 값이 객체나 배열이면 JSON 문자열로 변환, 아니면 그대로 사용
            const valueToStore = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : value;
            
            await client.query(
                'INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
                [key, valueToStore]
            );
        }
        console.log('성공: 모든 콘텐츠를 "site_settings" 테이블로 이전했습니다.');

        // 5. 기본 페이지 데이터 삽입
        const pages = [
            { slug: 'privacy-policy', title: '개인정보처리방침', content: '<h1>개인정보처리방침</h1><p><strong>탑부동산</strong>은(는) 개인정보보호법에 따라 이용자의 개인정보 보호 및 권익을 보호하고 개인정보와 관련한 이용자의 고충을 원활하게 처리할 수 있도록 다음과 같은 처리방침을 두고 있습니다.</p><h2>제1조(개인정보의 처리 목적)</h2><p>회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 개인정보 보호법 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.</p><ul><li><strong>상담 및 문의 응대:</strong> 매물 문의, 컨설팅 신청 등에 따른 연락 및 정보 제공</li><li><strong>서비스 제공:</strong> 맞춤형 매물 정보 제공 등</li></ul><h2>제2조(개인정보의 처리 및 보유 기간)</h2><p>회사는 법령에 따른 개인정보 보유·이용기간 또는 정보주체로부터 개인정보를 수집 시에 동의받은 개인정보 보유·이용기간 내에서 개인정보를 처리·보유합니다.</p><p><em>(이곳에 구체적인 보유 기간 정책을 입력하세요.)</em></p><h2>제3조(개인정보의 제3자 제공)</h2><p>회사는 정보주체의 개인정보를 제1조(개인정보의 처리 목적)에서 명시한 범위 내에서만 처리하며, 정보주체의 동의, 법률의 특별한 규정 등 개인정보 보호법 제17조에 해당하는 경우에만 개인정보를 제3자에게 제공합니다.</p><p><em>(이곳에 제3자 제공에 관한 구체적인 내용을 입력하세요.)</em></p>' },
            { slug: 'reject-email-collection', title: '이메일무단수집거부', content: '<p>본 웹사이트에 게시된 이메일 주소가 전자우편 수집 프로그램이나<br>그 밖의 기술적 장치를 이용하여 무단으로 수집되는 것을 거부하며,<br>이를 위반 시 <strong>정보통신망 이용촉진 및 정보보호 등에 관한 법률</strong>에 의해<br>형사 처벌됨을 유념하시기 바랍니다.</p>' },
            { slug: 'terms-of-service', title: '이용약관', content: '<h1>이용약관</h1><h2>제1조(목적)</h2><p>이 약관은 탑부동산 웹사이트(이하 "사이트"라 함)에서 제공하는 모든 서비스(이하 "서비스"라 함)의 이용조건 및 절차, 이용자와 사이트의 권리, 의무, 책임사항과 기타 필요한 사항을 규정함을 목적으로 합니다.</p><h2>제2조(약관의 효력과 변경)</h2><p>1. 이 약관은 사이트를 통해 온라인으로 공시함으로써 효력을 발생하며, 합리적인 사유가 발생할 경우 관련 법령에 위배되지 않는 범위 안에서 개정될 수 있습니다.</p><p>2. 사이트는 약관을 개정할 경우, 적용일자 및 개정사유를 명시하여 현행약관과 함께 사이트의 초기화면에 그 적용일자 7일 이전부터 적용일자 전일까지 공지합니다.</p><h2>제3조(서비스의 제공 및 변경)</h2><p>1. 사이트는 다음과 같은 서비스를 제공합니다.</p><ul><li>부동산 매물 정보 제공</li><li>부동산 관련 컨설팅 상담 접수</li><li>기타 사이트가 정하는 서비스</li></ul><p>2. 사이트는 서비스의 내용 및 제공일자를 변경할 수 있으며, 이 경우 서비스의 내용 및 제공일자를 명시하여 현재의 서비스 내용을 게시한 곳에 즉시 공지합니다.</p><p><em>(이곳에 사이트 운영에 필요한 구체적인 이용약관을 추가하세요.)</em></p>' },
            { slug: 'lifestyle-1', title: '라이프스타일 제안 1', content: '<p>첫 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' },
            { slug: 'lifestyle-2', title: '라이프스타일 제안 2', content: '<p>두 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' },
            { slug: 'lifestyle-3', title: '라이프스타일 제안 3', content: '<p>세 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' }
        ];

        for (const page of pages) {
            await client.query(
                'INSERT INTO pages (slug, title, content) VALUES ($1, $2, $3) ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = CURRENT_TIMESTAMP',
                [page.slug, page.title, page.content]
            );
        }
        console.log('성공: 기본 페이지 데이터를 "pages" 테이블에 삽입했습니다.');

        console.log('--------------------------------------------------');
        console.log('데이터베이스 설정 및 데이터 이전이 완료되었습니다.');
        console.log('--------------------------------------------------');

    } catch (err) {
        console.error('오류: 데이터베이스 설정 중 문제가 발생했습니다.', err.stack);
    } finally {
        console.log('데이터베이스 연결을 종료합니다.');
        await client.release();
        await pool.end();
    }
}

setupDatabase();
