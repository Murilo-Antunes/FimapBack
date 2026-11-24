const knex = require('knex')

const knexConfig = require('../../Database_config_knex/KnexFile.js')
const knexConex = knex(knexConfig.development)

const VALIDADE_DIAS = 30
const VALIDADE_MS = VALIDADE_DIAS * 24 * 60 * 60 * 1000

// Pendente só vale por 30 dias (sem cron: é calculado na leitura).
const aindaValida = (solicitacao) =>
    Boolean(solicitacao) && Date.now() - new Date(solicitacao.data_criacao).getTime() < VALIDADE_MS

async function BuscarPorPar(id_solicitante, id_destinatario) {
    const row = await knexConex('tbl_solicitacao_acesso')
        .where({ id_solicitante, id_destinatario })
        .first()

    return row ?? null
}

// Cria a solicitação (ou renova a linha existente) e avisa o destinatário.
async function CriarOuRenovar({ id_solicitante, id_destinatario, tipo }) {
    return knexConex.transaction(async (trx) => {
        await trx('tbl_solicitacao_acesso')
            .insert({ id_solicitante, id_destinatario, tipo, status: 'pendente' })
            .onConflict(['id_solicitante', 'id_destinatario'])
            .merge({ tipo, status: 'pendente', data_criacao: trx.fn.now(), data_resposta: null })

        const solicitacao = await trx('tbl_solicitacao_acesso')
            .where({ id_solicitante, id_destinatario })
            .first()

        const solicitante = await trx('tbl_usuario')
            .select(trx.raw('COALESCE(nome_exibicao, nome) as nome'))
            .where({ id: id_solicitante })
            .first()

        await trx('tbl_notificacao').insert({
            icone: '🤝',
            nome: 'Nova solicitação de acesso',
            conteudo: `${solicitante?.nome ?? 'Um usuário'} quer ver seu perfil.`,
            data_criacao: trx.fn.now(),
            lida: 0,
            id_usuario: id_destinatario,
            tipo_referencia: 'solicitacao_acesso',
            id_referencia: solicitacao.id,
        })

        return solicitacao
    })
}

async function Cancelar(id_solicitante, id_destinatario) {
    const apagadas = await knexConex('tbl_solicitacao_acesso')
        .where({ id_solicitante, id_destinatario, status: 'pendente' })
        .del()

    return apagadas > 0
}

async function ListarRecebidas(id_destinatario) {
    return knexConex({ s: 'tbl_solicitacao_acesso' })
        .innerJoin({ u: 'tbl_usuario' }, 'u.id', 's.id_solicitante')
        .where('s.id_destinatario', id_destinatario)
        .andWhere('s.status', 'pendente')
        .andWhere('s.data_criacao', '>=', knexConex.raw('DATE_SUB(NOW(), INTERVAL 30 DAY)'))
        .select(
            's.id',
            's.tipo',
            's.data_criacao',
            'u.id as id_usuario',
            knexConex.raw('COALESCE(u.nome_exibicao, u.nome) as nome_exibicao'),
            'u.username_social',
            'u.foto_perfil',
            'u.nivel_total',
        )
        .orderBy('s.data_criacao', 'desc')
}

// Aceita ou recusa. Aceitar do tipo 'seguir' também cria o vínculo em tbl_seguidores.
// Devolve null se a solicitação não existe, não é desse destinatário, já foi respondida ou expirou.
async function Responder({ id_solicitacao, id_destinatario, decisao }) {
    return knexConex.transaction(async (trx) => {
        const solicitacao = await trx('tbl_solicitacao_acesso')
            .where({ id: id_solicitacao, id_destinatario, status: 'pendente' })
            .andWhere('data_criacao', '>=', trx.raw('DATE_SUB(NOW(), INTERVAL 30 DAY)'))
            .forUpdate()
            .first()

        if (!solicitacao) return null

        const status = decisao === 'aceitar' ? 'aceita' : 'recusada'

        await trx('tbl_solicitacao_acesso')
            .where({ id: solicitacao.id })
            .update({ status, data_resposta: trx.fn.now() })

        if (status === 'aceita') {
            if (solicitacao.tipo === 'seguir') {
                await trx('tbl_seguidores')
                    .insert({ id_seguidor: solicitacao.id_solicitante, id_seguindo: id_destinatario })
                    .onConflict(['id_seguidor', 'id_seguindo'])
                    .ignore()
            }

            const dono = await trx('tbl_usuario')
                .select(trx.raw('COALESCE(nome_exibicao, nome) as nome'))
                .where({ id: id_destinatario })
                .first()

            await trx('tbl_notificacao').insert({
                icone: '✅',
                nome: 'Solicitação aceita',
                conteudo: `${dono?.nome ?? 'Um usuário'} aceitou sua solicitação.`,
                data_criacao: trx.fn.now(),
                lida: 0,
                id_usuario: solicitacao.id_solicitante,
                tipo_referencia: 'solicitacao_acesso',
                id_referencia: solicitacao.id,
            })
        }

        return { ...solicitacao, status }
    })
}

module.exports = {
    VALIDADE_DIAS,
    aindaValida,
    BuscarPorPar,
    CriarOuRenovar,
    Cancelar,
    ListarRecebidas,
    Responder,
}
