const knexConex = require('../../Database_config_knex/connection.js')

// Bloquear também desfaz tudo que ligava os dois: follows nos dois sentidos
// e solicitações de acesso (inclusive as aceitas) nos dois sentidos.
async function Bloquear(id_bloqueador, id_bloqueado) {
    await knexConex.transaction(async (trx) => {
        await trx('tbl_bloqueio_usuario')
            .insert({ id_bloqueador, id_bloqueado })
            .onConflict(['id_bloqueador', 'id_bloqueado'])
            .ignore()

        await trx('tbl_seguidores')
            .where((q) => q.where({ id_seguidor: id_bloqueador, id_seguindo: id_bloqueado }))
            .orWhere((q) => q.where({ id_seguidor: id_bloqueado, id_seguindo: id_bloqueador }))
            .del()

        await trx('tbl_solicitacao_acesso')
            .where((q) => q.where({ id_solicitante: id_bloqueador, id_destinatario: id_bloqueado }))
            .orWhere((q) => q.where({ id_solicitante: id_bloqueado, id_destinatario: id_bloqueador }))
            .del()
    })
}

async function Desbloquear(id_bloqueador, id_bloqueado) {
    const apagados = await knexConex('tbl_bloqueio_usuario')
        .where({ id_bloqueador, id_bloqueado })
        .del()

    return apagados > 0
}

async function ListarBloqueados(id_bloqueador) {
    return knexConex({ b: 'tbl_bloqueio_usuario' })
        .innerJoin({ u: 'tbl_usuario' }, 'u.id', 'b.id_bloqueado')
        .where('b.id_bloqueador', id_bloqueador)
        .select(
            'u.id as id_usuario',
            knexConex.raw('COALESCE(u.nome_exibicao, u.nome) as nome_exibicao'),
            'u.username_social',
            'u.foto_perfil',
            'b.data_criacao',
        )
        .orderBy('b.data_criacao', 'desc')
}

module.exports = { Bloquear, Desbloquear, ListarBloqueados }
