const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)// TODO: ajustar caminho

async function BuscarTodosNiveis() {
    const [rows] = await knexConex.execute(`SELECT nivel, titulo, xp_necessario FROM tbl_nivel ORDER BY nivel ASC`)
    return rows
}

module.exports = { BuscarTodosNiveis }
