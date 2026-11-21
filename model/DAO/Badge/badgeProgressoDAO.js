const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development) 

const CALCULADORAS = {
    async conexoes_open_finance(id_usuario) {
        const resultado = await knexConex('tbl_conexao_open_finance')
            .where({ id_usuario, status: 1 })
            .count({ total: '*' })
            .first()
        return Number(resultado?.total ?? 0)
    },

    async simulacoes(id_usuario) {
        const investimento = await knexConex('tbl_simulacao_investimento')
            .where({ id_usuario })
            .count({ total: '*' })
            .first()
        const amortizacao = await knexConex('tbl_simulacao_amortizacao')
            .where({ id_usuario })
            .count({ total: '*' })
            .first()
        return Number(investimento?.total ?? 0) + Number(amortizacao?.total ?? 0)
    },

    async respostas_validadas(id_usuario) {
        const resultado = await knexConex('tbl_comentario')
            .where({ id_usuario, marcado_como_solucao: 1 })
            .count({ total: '*' })
            .first()
        return Number(resultado?.total ?? 0)
    },
}

// Badges que o usuário ainda não conquistou e que têm criterio_tipo definido.
async function BuscarBadgesBloqueadasComCriterio(id_usuario) {
    const idsConquistadas = knexConex('tbl_badge_usuario').select('id_badge').where({ id_usuario })

    const badges = await knexConex('tbl_badge')
        .select('id', 'icone', 'nome', 'descricao', 'xp', 'id_categoria', 'criterio_tipo', 'criterio_meta')
        .whereNotNull('criterio_tipo')
        .whereNotIn('id', idsConquistadas)

    return badges
}

// Junta as badges bloqueadas com criterio_tipo conhecido + progresso atual.
// Badges com criterio_tipo sem calculadora implementada são descartadas.
async function CalcularProgresso(id_usuario) {
    const badges = await BuscarBadgesBloqueadasComCriterio(id_usuario)
    const resultado = []

    for (const badge of badges) {
        const calcular = CALCULADORAS[badge.criterio_tipo]
        if (!calcular) continue

        const progresso_atual = await calcular(id_usuario)

        resultado.push({
            id: badge.id,
            icone: badge.icone,
            nome: badge.nome,
            descricao: badge.descricao,
            xp: badge.xp,
            id_categoria: badge.id_categoria,
            progresso_atual,
            progresso_total: badge.criterio_meta,
        })
    }

    return resultado
}

module.exports = { BuscarBadgesBloqueadasComCriterio, CalcularProgresso }
