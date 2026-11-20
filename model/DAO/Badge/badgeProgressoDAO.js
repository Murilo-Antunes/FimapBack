const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

const CALCULADORAS = {
    async conexoes_open_finance(id_usuario) {
        const [rows] = await knexConex.execute(
            `SELECT COUNT(*) AS total FROM tbl_conexao_open_finance WHERE id_usuario = ? AND status = 1`,
            [id_usuario],
        )
        return rows[0]?.total ?? 0
    },

    async simulacoes(id_usuario) {
        const [investimento] = await knexConex.execute(
            `SELECT COUNT(*) AS total FROM tbl_simulacao_investimento WHERE id_usuario = ?`,
            [id_usuario],
        )
        const [amortizacao] = await knexConex.execute(
            `SELECT COUNT(*) AS total FROM tbl_simulacao_amortizacao WHERE id_usuario = ?`,
            [id_usuario],
        )
        return (investimento[0]?.total ?? 0) + (amortizacao[0]?.total ?? 0)
    },

    async respostas_validadas(id_usuario) {
        const [rows] = await knexConex.execute(
            `SELECT COUNT(*) AS total FROM tbl_comentario WHERE id_usuario = ? AND marcado_como_solucao = 1`,
            [id_usuario],
        )
        return rows[0]?.total ?? 0
    },
}

// Badges que o usuário ainda não conquistou e que têm um criterio_tipo
// conhecido (ou seja, dá pra calcular progresso).
async function BuscarBadgesBloqueadasComCriterio(id_usuario) {
    const [rows] = await knexConex.execute(
        `SELECT b.id, b.icone, b.nome, b.descricao, b.xp, b.id_categoria, b.criterio_tipo, b.criterio_meta
         FROM tbl_badge b
         WHERE b.criterio_tipo IS NOT NULL
           AND b.id NOT IN (SELECT id_badge FROM tbl_badge_usuario WHERE id_usuario = ?)`,
        [id_usuario],
    )

    return rows
}

// Junta as badges bloqueadas com criterio_tipo conhecido + o progresso atual
// de cada uma. Badges com criterio_tipo sem calculadora implementada são
// descartadas da lista (ficam como badge bloqueada "simples" no front).
async function CalcularProgresso(id_usuario) {
    const badges = await BuscarBadgesBloqueadasComCriterio(id_usuario)
    const resultado = []

    for (const badge of badges) {
        const calcular = CALCULADORAS[badge.criterio_tipo]
        if (!calcular) continue // criterio_tipo sem calculadora implementada ainda

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
