const knexConex = require('../../Database_config_knex/connection.js')

// visibilidade mora em tbl_usuario; o resto em tbl_configuracoes.
// notif_topicos_ia é a coluna já existente "topicos".
async function BuscarConfiguracoes(id_usuario) {
    const row = await knexConex({ u: 'tbl_usuario' })
        .leftJoin({ c: 'tbl_configuracoes' }, 'c.id_usuario', 'u.id')
        .where('u.id', id_usuario)
        .select(
            'u.visibilidade',
            'c.quem_comenta',
            'c.notif_respostas_mencoes',
            'c.topicos as notif_topicos_ia',
            'c.notif_conquistas',
        )
        .first()

    return row ?? null
}

async function AtualizarConfiguracoes(id_usuario, alteracoes) {
    const { visibilidade, quem_comenta, notif_respostas_mencoes, notif_topicos_ia, notif_conquistas } = alteracoes

    await knexConex.transaction(async (trx) => {
        if (visibilidade !== undefined) {
            await trx('tbl_usuario').where({ id: id_usuario }).update({ visibilidade })
        }

        const cfg = {}
        if (quem_comenta !== undefined) cfg.quem_comenta = quem_comenta
        if (notif_respostas_mencoes !== undefined) cfg.notif_respostas_mencoes = notif_respostas_mencoes
        if (notif_topicos_ia !== undefined) cfg.topicos = notif_topicos_ia
        if (notif_conquistas !== undefined) cfg.notif_conquistas = notif_conquistas

        if (Object.keys(cfg).length) {
            // upsert: usuários antigos podem não ter linha em tbl_configuracoes
            await trx('tbl_configuracoes')
                .insert({ id_usuario, ...cfg })
                .onConflict('id_usuario')
                .merge(cfg)
        }
    })
}

async function DefinirPerfilSocialAtivo(id_usuario, ativo) {
    await knexConex('tbl_usuario')
        .where({ id: id_usuario })
        .update({ perfil_social_ativo: ativo ? 1 : 0 })
}

const contar = async (consulta) => Number((await consulta.count({ total: '*' }).first())?.total ?? 0)

async function BuscarResumo(id_usuario) {
    const dono = await knexConex('tbl_usuario').select('visibilidade').where({ id: id_usuario }).first()
    if (!dono) return null

    // Perfil público: todos os membros com perfil ativo podem ver.
    // Perfil privado: só quem teve solicitação aceita.
    const audiencia_visivel = Number(dono.visibilidade) === 1
        ? await contar(knexConex('tbl_usuario').where('perfil_social_ativo', 1).andWhereNot('id', id_usuario))
        : await contar(knexConex('tbl_solicitacao_acesso').where({ id_destinatario: id_usuario, status: 'aceita' }))

    // Todo XP vem de badge (trigger trg_apos_conquista_badge): soma das badges dos últimos 7 dias.
    const xp = await knexConex({ bu: 'tbl_badge_usuario' })
        .innerJoin({ b: 'tbl_badge' }, 'b.id', 'bu.id_badge')
        .where('bu.id_usuario', id_usuario)
        .andWhere('bu.data_conquista', '>=', knexConex.raw('DATE_SUB(NOW(), INTERVAL 7 DAY)'))
        .sum({ total: 'b.xp' })
        .first()

    // Percentil calculado na hora a partir de pontos_total (tbl_ranking.posicao não é recalculada).
    // Sem pontos, não mostra "Top x%" (todo mundo empatado em zero).
    let percentil_ranking = null
    const meu = await knexConex('tbl_ranking').select('pontos_total').where({ id_usuario }).first()
    if (meu && Number(meu.pontos_total) > 0) {
        const total = await contar(knexConex('tbl_ranking'))
        const acima = await contar(knexConex('tbl_ranking').where('pontos_total', '>', meu.pontos_total))
        percentil_ranking = Math.ceil(((acima + 1) / total) * 100)
    }

    const solicitacoes_pendentes = await contar(
        knexConex('tbl_solicitacao_acesso')
            .where({ id_destinatario: id_usuario, status: 'pendente' })
            .andWhere('data_criacao', '>=', knexConex.raw('DATE_SUB(NOW(), INTERVAL 30 DAY)')),
    )

    return {
        audiencia_visivel,
        xp_semana: Number(xp?.total ?? 0),
        percentil_ranking,
        solicitacoes_pendentes,
    }
}

module.exports = {
    BuscarConfiguracoes,
    AtualizarConfiguracoes,
    DefinirPerfilSocialAtivo,
    BuscarResumo,
}
