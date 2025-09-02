require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function findConstraints() {
    let client;
    try {
        client = await pool.connect();
        console.log('Finding constraints for table: public.boards');
        const query = `
            SELECT tc.constraint_name, tc.constraint_type, cc.check_clause
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.check_constraints AS cc
            ON tc.constraint_name = cc.constraint_name
            WHERE tc.table_name = 'boards';
        `;
        const result = await client.query(query);
        console.log('Found constraints:');
        console.table(result.rows);
    } catch (err) {
        console.error('Error finding constraints:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

findConstraints();