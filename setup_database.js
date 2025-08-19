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
                'INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
                [key, valueToStore]
            );
        }
        console.log('성공: 모든 콘텐츠를 "site_settings" 테이블로 이전했습니다.');

        // 5. 기본 페이지 데이터 삽입
        const pages = [
            { slug: 'privacy-policy', title: '개인정보처리방침', content: `<h4>제1조 (총칙)</h4><p>탑부동산 (이하 '회사')는 이용자의 개인정보를 중요시하며, '정보통신망 이용촉진 및 정보보호에 관한 법률' 및 '개인정보보호법' 등 관련 법규를 준수하고 있습니다. 회사는 개인정보처리방침을 통하여 이용자가 제공하는 개인정보가 어떠한 용도와 방식으로 이용되고 있으며, 개인정보보호를 위해 어떠한 조치가 취해지고 있는지 알려드립니다.</p><h4>제2조 (개인정보의 수집 및 이용 목적)</h4><p>회사는 다음의 목적을 위하여 개인정보를 수집하고 이용합니다.</p><ul><li>서비스 제공에 관한 계약 이행 및 서비스 제공에 따른 요금 정산</li><li>회원 관리: 회원제 서비스 이용에 따른 본인확인, 개인 식별, 불량회원의 부정 이용 방지와 비인가 사용 방지, 가입 의사 확인</li><li>마케팅 및 광고에 활용: 신규 서비스 개발 및 맞춤 서비스 제공, 이벤트 등 광고성 정보 전달</li></ul><h4>제3조 (수집하는 개인정보의 항목)</h4><p>회사는 회원가입, 상담, 서비스 신청 등을 위해 아래와 같은 개인정보를 수집하고 있습니다.</p><ul><li>필수항목: 이름, 연락처, 이메일 주소</li><li>선택항목: 주소, 기타 문의사항</li></ul><h4>제4조 (개인정보의 보유 및 이용기간)</h4><p>회사는 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 단, 다음의 정보에 대해서는 아래의 이유로 명시한 기간 동안 보존합니다.</p><ul><li>보존 항목: 이름, 연락처, 이메일 주소</li><li>보존 근거: 회원의 동의</li><li>보존 기간: 회원 탈퇴 시까지</li></ul><h4>제5조 (개인정보의 파기절차 및 방법)</h4><p>회사는 원칙적으로 개인정보 수집 및 이용목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다. 파기절차 및 방법은 다음과 같습니다.</p><ul><li>파기절차: 이용자가 회원가입 등을 위해 입력한 정보는 목적이 달성된 후 별도의 DB로 옮겨져(종이의 경우 별도의 서류함) 내부 방침 및 기타 관련 법령에 의한 정보보호 사유에 따라(보유 및 이용기간 참조) 일정 기간 저장된 후 파기됩니다.</li><li>파기방법: 전자적 파일형태로 저장된 개인정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제합니다.</li></ul><h4>제6조 (개인정보 제공)</h4><p>회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 다만, 아래의 경우에는 예외로 합니다.</p><ul><li>이용자들이 사전에 동의한 경우</li><li>법령의 규정에 의거하거나, 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li></ul><h4>제7조 (개인정보처리의 위탁)</h4><p>회사는 서비스 향상을 위해서 아래와 같이 개인정보를 위탁하고 있으며, 관계 법령에 따라 위탁계약 시 개인정보가 안전하게 관리될 수 있도록 필요한 사항을 규정하고 있습니다.</p><ul><li>위탁 대상 : [위탁업체 명]</li><li>위탁업무 내용 : [위탁업무 내용]</li></ul><h4>제8조 (이용자 및 법정대리인의 권리와 그 행사방법)</h4><p>이용자 및 법정 대리인은 언제든지 등록되어 있는 자신 혹은 당해 만 14세 미만 아동의 개인정보를 조회하거나 수정할 수 있으며 가입해지를 요청할 수도 있습니다.</p><h4>제9조 (개인정보 자동수집 장치의 설치, 운영 및 그 거부에 관한 사항)</h4><p>회사는 이용자에게 특화된 맞춤서비스를 제공하기 위해서 이용자들의 정보를 저장하고 수시로 불러오는 '쿠키(cookie)'를 사용합니다. 쿠키는 웹사이트를 운영하는데 이용되는 서버(HTTP)가 이용자의 컴퓨터 브라우저에게 보내는 소량의 정보이며 이용자들의 PC 컴퓨터내의 하드디스크에 저장되기도 합니다.</p><h4>제10조 (개인정보에 관한 민원서비스)</h4><p>회사는 고객의 개인정보를 보호하고 개인정보와 관련한 불만을 처리하기 위하여 아래와 같이 관련 부서 및 개인정보관리책임자를 지정하고 있습니다.</p><ul><li>개인정보관리책임자 성명 : [담당자 이름]</li><li>전화번호 : [담당자 연락처]</li><li>이메일 : [담당자 이메일]</li></ul><p>이용자는 회사의 서비스를 이용하시며 발생하는 모든 개인정보보호 관련 민원을 개인정보관리책임자 혹은 담당부서로 신고하실 수 있습니다. 회사는 이용자들의 신고사항에 대해 신속하게 충분한 답변을 드릴 것입니다.</p>` },
            { slug: 'reject-email-collection', title: '이메일무단수집거부', content: '<p>본 웹사이트에 게시된 이메일 주소가 전자우편 수집 프로그램이나<br>그 밖의 기술적 장치를 이용하여 무단으로 수집되는 것을 거부하며,<br>이를 위반 시 <strong>정보통신망 이용촉진 및 정보보호 등에 관한 법률</strong>에 의해<br>형사 처벌됨을 유념하시기 바랍니다.</p>' },
            { slug: 'terms-of-service', title: '이용약관', content: '<h2>제1조(목적)</h2><p>이 약관은 탑부동산 웹사이트(이하 "사이트"라 함)에서 제공하는 모든 서비스(이하 "서비스"라 함)의 이용조건 및 절차, 이용자와 사이트의 권리, 의무, 책임사항과 기타 필요한 사항을 규정함을 목적으로 합니다.</p><h2>제2조(약관의 효력과 변경)</h2><p>1. 이 약관은 사이트를 통해 온라인으로 공시함으로써 효력을 발생하며, 합리적인 사유가 발생할 경우 관련 법령에 위배되지 않는 범위 안에서 개정될 수 있습니다.</p><p>2. 사이트는 약관을 개정할 경우, 적용일자 및 개정사유를 명시하여 현행약관과 함께 사이트의 초기화면에 그 적용일자 7일 이전부터 적용일자 전일까지 공지합니다.</p><h2>제3조(서비스의 제공 및 변경)</h2><p>1. 사이트는 다음과 같은 서비스를 제공합니다.</p><ul><li>부동산 매물 정보 제공</li><li>부동산 관련 컨설팅 상담 접수</li><li>기타 사이트가 정하는 서비스</li></ul><p>2. 사이트는 서비스의 내용 및 제공일자를 변경할 수 있으며, 이 경우 서비스의 내용 및 제공일자를 명시하여 현재의 서비스 내용을 게시한 곳에 즉시 공지합니다.</p><p><em>(이곳에 사이트 운영에 필요한 구체적인 이용약관을 추가하세요.)</em></p>' },
            { slug: 'lifestyle-1', title: '라이프스타일 제안 1', content: '<p>첫 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' },
            { slug: 'lifestyle-2', title: '라이프스타일 제안 2', content: '<p>두 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' },
            { slug: 'lifestyle-3', title: '라이프스타일 제안 3', content: '<p>세 번째 라이프스타일 제안에 대한 내용을 이곳에 입력해주세요.</p>' }
        ];

        for (const page of pages) {
            await client.query(
                'INSERT INTO pages (slug, title, content) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING',
                [page.slug, page.title, page.content]
            );
        }
        console.log('성공: 기본 페이지 데이터를 "pages" 테이블에 삽입했습니다. (기존 데이터는 덮어쓰지 않음)');

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