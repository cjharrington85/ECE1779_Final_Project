const { Pool } = require("pg");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || "taskapp",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "taskapp",
};
const pool = new Pool(dbConfig);

module.exports = { dbConfig, pool };
