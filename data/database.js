
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 데이터베이스 파일의 경로를 data 폴더 안으로 지정합니다.
const dbPath = path.resolve(__dirname, 'database.db');

// 데이터베이스에 연결합니다. 파일이 없으면 새로 생성됩니다.
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('데이터베이스 연결 실패:', err.message);
    } else {
        console.log('데이터베이스에 성공적으로 연결되었습니다.');
        createTable();
    }
});

// 매물 정보를 저장할 테이블을 생성하는 함수
function createTable() {
    const createTableSql = `
    CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        price TEXT,
        description TEXT,
        image_url TEXT,
        status TEXT DEFAULT '게시중',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `;

    db.run(createTableSql, (err) => {
        if (err) {
            console.error('테이블 생성 실패:', err.message);
        } else {
            console.log("'properties' 테이블이 성공적으로 생성되었거나 이미 존재합니다.");
        }
        
        // 모든 작업이 끝난 후 데이터베이스 연결을 닫습니다.
        db.close((err) => {
            if (err) {
                console.error('데이터베이스 연결 종료 실패:', err.message);
            } else {
                console.log('데이터베이스 연결이 종료되었습니다.');
            }
        });
    });
}
