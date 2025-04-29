const mysql = require('mysql2/promise');
require('dotenv').config();

console.log("Connecting to DB as:", process.env.DB_USER, "with pass?", !!process.env.DB_PASS);

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

module.exports = pool;
