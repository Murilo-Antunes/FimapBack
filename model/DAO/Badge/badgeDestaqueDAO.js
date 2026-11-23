const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development) // TODO: troque 'development' se usar outro ambiente

// Quantas das badges em "ids" pertencem de fato ao usuário.
async function ContarBadgesDoUsuario(id_usuario, ids) {
    if (!ids.length) return 0

    const resultado = await knexConex('tbl_badge_usuario')
        .where({ id_usuario })
        .whereIn('id_badge', ids)
        .count({ total: '*' })
        .first()

    return Number(resultado?.total ?? 0)
}

// Zera os destaques atuais do usuário e marca só os ids informados.
// Usa transação pra não ficar "sem nenhum destaque" se o 2º UPDATE falhar.
async function DefinirDestaques(id_usuario, ids) {
    await knexConex.transaction(async (trx) => {
        await trx('tbl_badge_usuario').where({ id_usuario }).update({ em_destaque: 0 })

        if (ids.length) {
            await trx('tbl_badge_usuario')
                .where({ id_usuario })
                .whereIn('id_badge', ids)
                .update({ em_destaque: 1 })
        }
    })
}

// Devolve os ids de badge marcados como destaque pelo usuário.
async function BuscarIdsDestaque(id_usuario) {
    const rows = await knexConex('tbl_badge_usuario')
        .select('id_badge')
        .where({ id_usuario, em_destaque: 1 })

    return rows.map((r) => r.id_badge)
}

module.exports = { ContarBadgesDoUsuario, DefinirDestaques, BuscarIdsDestaque }
