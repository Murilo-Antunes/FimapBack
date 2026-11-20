const knex = require('knex')

const knexConfig = require('../../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

async function CreateDenunciaUsuario({ titulo, descricao, id_usuario_denunciante, id_usuario_denunciado, id_categoria }) {
    const [resultado] = await knexConex.execute(
        `INSERT INTO tbl_denuncia_usuario
            (titulo, descricao, id_usuario_denunciante, id_usuario_denunciado, id_categoria)
         VALUES (?, ?, ?, ?, ?)`,
        [titulo, descricao, id_usuario_denunciante, id_usuario_denunciado, id_categoria],
    )
    return resultado.insertId
}

module.exports = { CreateDenunciaUsuario }
