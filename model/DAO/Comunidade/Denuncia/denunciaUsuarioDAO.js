const knex = require('knex')

const knexConfig = require('../../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development) // TODO: troque 'development' se usar outro ambiente

async function CreateDenunciaUsuario({ titulo, descricao, id_usuario_denunciante, id_usuario_denunciado, id_categoria }) {
    const [id] = await knexConex('tbl_denuncia_usuario').insert({
        titulo,
        descricao,
        id_usuario_denunciante,
        id_usuario_denunciado,
        id_categoria,
    })

    return id
}

module.exports = { CreateDenunciaUsuario }
