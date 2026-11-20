const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

// Convenção deste arquivo: erros de banco são relançados (throw);
// quem trata é o controller.
//
// ATENÇÃO: assume a tabela tbl_badge_usuario(id_usuario, id_badge, destaque).
// Ajuste o nome se o seu schema for outro.

// Quantos dos ids informados pertencem ao usuário
const ContarBadgesDoUsuario = async (idUsuario, idsBadge) => {
    if (idsBadge.length === 0) return 0

    try {
        const [rows] = await knexConex.raw(
            `select count(distinct id_badge) as total
             from tbl_badge_usuario
             where id_usuario = ? and id_badge in (${idsBadge.map(() => '?').join(',')})`,
            [idUsuario, ...idsBadge]
        )

        return Number(rows[0].total)
    } catch (error) {
        console.error('Erro ao contar badges do usuário:', error)
        throw error
    }
}

// Substitui os destaques do usuário (lista vazia limpa todos), em transação
const DefinirDestaques = async (idUsuario, idsBadge) => {
    try {
        await knexConex.transaction(async (trx) => {
            await trx.raw('update tbl_badge_usuario set destaque = 0 where id_usuario = ?', [idUsuario])

            if (idsBadge.length > 0) {
                await trx.raw(
                    `update tbl_badge_usuario set destaque = 1
                     where id_usuario = ? and id_badge in (${idsBadge.map(() => '?').join(',')})`,
                    [idUsuario, ...idsBadge]
                )
            }
        })

        return true
    } catch (error) {
        console.error('Erro ao definir badges em destaque:', error)
        throw error
    }
}

// NOVA: devolve os ids de badge marcados como destaque pelo usuário.
async function BuscarIdsDestaque(id_usuario) {
    const [rows] = await knexConex.execute(
        `SELECT id_badge FROM tbl_badge_usuario WHERE id_usuario = ? AND em_destaque = 1`,
        [id_usuario],
    )

    return rows.map((r) => r.id_badge)
}

module.exports = {
    ContarBadgesDoUsuario,
    DefinirDestaques,
    BuscarIdsDestaque
}
