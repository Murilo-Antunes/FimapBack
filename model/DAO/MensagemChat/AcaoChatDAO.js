// Guarda as propostas do chat e salva a escolhida quando o usuário confirma.
const db = require('../../Database_config_knex/connection.js')
const metas = require('../Metas/MetasDAO.js')
const investimento = require('../Simulacoes/SimulacaoInvestimentoDAO.js')
const amortizacao = require('../Simulacoes/SimulacaoAmortizacaoDAO.js')
const { checarDados } = require('../../../src/services/planningCatalog.js')
const { criarErro, validarId } = require('../../../src/services/chatValidation.js')

const { acoes, versoes } = require('../../../db/chatActionSchema.js')
const lerPayload = (payload) => typeof payload === 'string' ? JSON.parse(payload) : payload
const inexistente = () => criarErro(404, 'Ação não encontrada nesta conversa.', 'ACAO_NAO_ENCONTRADA')
const incompleta = () => criarErro(422, 'Revise os dados da proposta antes de salvar.', 'ACAO_INCOMPLETA')

function serializar(linha) {
    const { cartao } = lerPayload(linha.payload)
    return linha.id_registro && Number(linha.versao) === Number(linha.versao_atual)
        ? { ...cartao, status: 'salva', id_registro: Number(linha.id_registro) }
        : cartao
}

const selecionar = (conexao) => conexao(versoes + ' as v').join(acoes + ' as a', 'v.id_acao', 'a.id')
    .select('v.id_mensagem', 'v.versao', 'v.payload', 'a.versao as versao_atual', 'a.id_registro')

async function anexar(chat, linhas, conexao = db) {
    const ids = linhas.filter((m) => Number(m.papel) === 2).map((m) => m.id)
    if (!ids.length) return
    const registros = await selecionar(conexao).where('a.id_chat', chat).whereIn('v.id_mensagem', ids)
        .orderBy('v.id_mensagem').orderBy('v.id_acao')
    const porMensagem = new Map()
    for (const linha of registros) {
        if (!porMensagem.has(linha.id_mensagem)) porMensagem.set(linha.id_mensagem, [])
        porMensagem.get(linha.id_mensagem).push(linha)
    }
    for (const mensagem of linhas) {
        const propostas = porMensagem.get(mensagem.id)
        if (propostas) mensagem.acoes_financeiras = propostas
            .sort((x, y) => lerPayload(x.payload).ordem - lerPayload(y.payload).ordem).map(serializar)
    }
}

async function rascunhos(chat, usuario, conexao = db) {
    const registros = await selecionar(conexao).join('tbl_chat as c', 'a.id_chat', 'c.id')
        .where({ 'c.id': chat, 'c.id_usuario': usuario }).whereNull('a.id_registro')
        .whereColumn('a.versao', 'v.versao').orderBy('v.id_mensagem', 'desc').orderBy('a.id').limit(3)
    return registros.map(({ payload }) => lerPayload(payload))
}

async function registrar(trx, chat, mensagem, propostas) {
    for (const [ordem, proposta] of propostas.entries()) {
        const { id, tipo, versao } = proposta.cartao
        if (versao === 1) {
            await trx(acoes).insert({ id, id_chat: chat, tipo, versao })
        } else {
            const mudou = await trx(acoes).where({ id, id_chat: chat, tipo, versao: versao - 1 })
                .whereNull('id_registro').update({ versao })
            // Uma confirmação pode vencer a revisão durante a chamada ao Worker.
            if (!mudou) continue
        }
        await trx(versoes).insert({ id_acao: id, versao, id_mensagem: mensagem,
            payload: JSON.stringify({ ...proposta, ordem }) })
    }
}

async function confirmar(usuario, chat, id, versao, conexao = db) {
    return conexao.transaction(async (trx) => {
        // Mesma ordem de locks da conclusão do chat.
        if (!await trx('tbl_usuario').where({ id: usuario }).forUpdate().first('id')) throw inexistente()
        if (!await trx('tbl_chat').where({ id: chat, id_usuario: usuario }).forUpdate().first('id')) throw inexistente()
        const atual = await trx(acoes).where({ id, id_chat: chat }).forUpdate().first()
        if (!atual) throw inexistente()
        if (Number(atual.versao) !== versao)
            throw criarErro(409, 'A proposta foi atualizada. Reabra a conversa para revisar a versão atual.', 'ACAO_VERSAO_DESATUALIZADA')
        const snapshot = await trx(versoes).where({ id_acao: id, versao }).first()
        if (!snapshot) throw inexistente()
        const linha = { ...snapshot, versao_atual: atual.versao, id_registro: atual.id_registro }
        if (atual.id_registro) return serializar(linha)
        const { cartao, hoje, valores } = lerPayload(snapshot.payload)
        if (cartao.status !== 'pronta') throw incompleta()

        const { categoria, data_alvo, ...dados } = valores
        let idCategoria
        if (atual.tipo === 'meta') {
            const categorias = await metas.listarCategorias(usuario, trx)
            const encontradas = categorias.filter(({ nome }) => nome === categoria)
            idCategoria = encontradas.find((c) => Number(c.id_usuario) === usuario)?.id ?? encontradas[0]?.id
        }
        if (checarDados(atual.tipo, valores, idCategoria ? [categoria] : [], hoje).pendencias.length)
            throw incompleta()

        const dadosCadastro = { ...dados, descricao: dados.descricao ?? null }
        const registro = atual.tipo === 'meta' ? await metas.inserirMeta({
            ...dadosCadastro, dataCivil: data_alvo + ' 00:00:00', valor_total: dados.valor_inicio,
            id_categoria: idCategoria, id_conta_vinculada: null, id_usuario: usuario, status: 1
        }, trx) : await (atual.tipo === 'investimento' ? investimento : amortizacao).inserirSimulacao(usuario, dadosCadastro, trx)
        if (!validarId(registro)) throw new Error('Cadastro sem identificador.')
        await trx(acoes).where({ id, versao }).update({ id_registro: registro })
        return serializar({ ...linha, id_registro: registro })
    })
}

module.exports = { anexar, rascunhos, registrar, confirmar }
