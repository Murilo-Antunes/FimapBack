const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

async function GetPostSalvo(id_usuario, id_post) {
    const [rows] = await knexConex.execute(
        `SELECT id FROM tbl_post_salvo WHERE id_usuario = ? AND id_post = ?`,
        [id_usuario, id_post],
    )
    return rows[0] ?? null
}

async function CreatePostSalvo({ id_usuario, id_post }) {
    const [resultado] = await knexConex.execute(
        `INSERT INTO tbl_post_salvo (id_usuario, id_post) VALUES (?, ?)`,
        [id_usuario, id_post],
    )
    return resultado.insertId
}

async function DeletePostSalvo(id_usuario, id_post) {
    const [resultado] = await knexConex.execute(
        `DELETE FROM tbl_post_salvo WHERE id_usuario = ? AND id_post = ?`,
        [id_usuario, id_post],
    )
    return resultado.affectedRows > 0
}

// Devolve os posts salvos já no mesmo formato da vw_feed_comunidade, pra dar
// pra reaproveitar o mesmo tipo "Post" / PostCard.vue no front.
async function GetAllPostsSalvosByIdUsuario(id_usuario) {
    const [rows] = await knexConex.execute(
        `SELECT
            p.id AS id_post,
            p.conteudo,
            p.data_criacao,
            p.data_atualizacao,
            u.id AS id_autor,
            COALESCE(u.nome_exibicao, u.nome) AS autor_nome,
            u.username_social,
            u.foto_perfil,
            u.nivel_total,
            ps.data_salvo,
            (SELECT COUNT(*) FROM tbl_curtida_post cp WHERE cp.id_post = p.id) AS total_curtidas,
            (SELECT COUNT(*) FROM tbl_comentario c WHERE c.id_post = p.id) AS total_comentarios
         FROM tbl_post_salvo ps
         INNER JOIN tbl_post p ON p.id = ps.id_post
         INNER JOIN tbl_usuario u ON u.id = p.id_usuario
         WHERE ps.id_usuario = ? AND p.status = 1
         ORDER BY ps.data_salvo DESC`,
        [id_usuario],
    )
    return rows
}

module.exports = { GetPostSalvo, CreatePostSalvo, DeletePostSalvo, GetAllPostsSalvosByIdUsuario }
