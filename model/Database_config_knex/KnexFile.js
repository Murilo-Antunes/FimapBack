const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

const config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME || 'db_fimap_2026',
        port: Number(process.env.DB_PORT || 3306),
        charset: 'utf8mb4',
        ...(process.env.DB_SSL === 'true' && {
            ssl: {
                rejectUnauthorized: true,
                ...(process.env.DB_SSL_CA && { ca: process.env.DB_SSL_CA })
            }
        })
    },
    migrations: {
        tableName: 'knex_migrations',
        directory: path.resolve(__dirname, '../../db/migrations')
    },
    seeds: {
        directory: './db/seeds'
    }
}

module.exports = { development: config, production: config }
