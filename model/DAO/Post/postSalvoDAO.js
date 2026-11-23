const knex = require('knex')

const knexConfig = require('../../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development) // TODO: troque 'development' se usar outro ambiente

async function GetPostSalvo(id_usuario, id_post) {
    const row = await knexConex('tbl_post_salvo')
        .select('id')
        .where({ id_usuario, id_post })
        .first()

    return row ?? null
}

async function CreatePostSalvo({ id_usuario, id_post }) {
    const [id] = await knexConex('tbl_post_salvo').insert({ id_usuario, id_post })
    return id
}

async function DeletePostSalvo(id_usuario, id_post) {
    const linhasApagadas = await knexConex('tbl_post_salvo')
        .where({ id_usuario, id_post })
        .del()

    return linhasApagadas > 0
}

// Devolve os posts salvos no mesmo "formato cru" de antes — o mapeamento pro
// formato que o PostCard.vue espera já foi tratado no front (profile.service.ts).
async function GetAllPostsSalvosByIdUsuario(id_usuario) {
    const rows = await knexConex({ ps: 'tbl_post_salvo' })
        .innerJoin({ p: 'tbl_post' }, 'p.id', 'ps.id_post')
        .innerJoin({ u: 'tbl_usuario' }, 'u.id', 'p.id_usuario')
        .where('ps.id_usuario', id_usuario)
        .andWhere('p.status', 1)
        .select(
            'p.id as id_post',
            'p.conteudo',
            'p.data_criacao',
            'p.data_atualizacao',
            'u.id as id_autor',
            knexConex.raw('COALESCE(u.nome_exibicao, u.nome) as autor_nome'),
            'u.username_social',
            'u.foto_perfil',
            'u.nivel_total',
            'ps.data_salvo',
            knexConex.raw('(SELECT COUNT(*) FROM tbl_curtida_post cp WHERE cp.id_post = p.id) as total_curtidas'),
            knexConex.raw('(SELECT COUNT(*) FROM tbl_comentario c WHERE c.id_post = p.id) as total_comentarios'),
        )
        .orderBy('ps.data_salvo', 'desc')

    return rows
}

module.exports = { GetPostSalvo, CreatePostSalvo, DeletePostSalvo, GetAllPostsSalvosByIdUsuario }
