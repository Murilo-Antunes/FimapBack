const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

async function BuscarTodosNiveis() {
    const rows = await knexConex('tbl_nivel')
        .select('nivel', 'titulo', 'xp_necessario')
        .orderBy('nivel', 'asc')

    return rows
}

module.exports = { BuscarTodosNiveis }
