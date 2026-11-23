// Coordena o planejamento entre o chat, os dados da conta e a IA.
const metas = require('../../model/DAO/Metas/MetasDAO.js')
const { normalizarTexto } = require('./financialContextSelection.js')
const { dataLocal } = require('./planningDates.js')
const { prepararPayload, interpretar, ocultarIdentificadores } = require('./planningWorker.js')
const { produzir } = require('./planningProposals.js')
const { textoValido } = require('./planningCatalog.js')

const falha = { texto: 'Não consegui montar a proposta neste momento. Os rascunhos anteriores continuam disponíveis. Você pode retomar o plano nesta conversa.', propostas: [] }

async function obterCategorias(usuario, sinal) {
    const prazo = AbortSignal.timeout(3000)
    const combinado = AbortSignal.any([sinal, prazo])
    return new Promise((resolve) => {
        const encerrar = (dados) => {
            combinado.removeEventListener('abort', cancelar)
            resolve(dados)
        }
        const cancelar = () => encerrar([])
        combinado.addEventListener('abort', cancelar, { once: true })
        if (combinado.aborted) return cancelar()
        metas.listarCategorias(usuario).then((categorias) => encerrar([...new Set(categorias
            .map(({ nome }) => nome).filter((nome) => textoValido(nome, 80) && ocultarIdentificadores(nome) === nome))]), cancelar)
    })
}

async function planejar({ usuario, mensagens, carregarRascunhos, buscarFinanceiro, config, sinal, agora = new Date() }) {
    const hoje = dataLocal(agora)
    const atual = normalizarTexto(mensagens.at(-1).content.trim())
    let classificado = false
    let rascunhos = []
    try {
        rascunhos = await carregarRascunhos()
        const inicial = prepararPayload(mensagens, hoje, rascunhos, [], null)
        const classificacao = await interpretar(config, inicial.payload, sinal)
        if (classificacao.intencao === 'orientacao') return null
        classificado = true
        const tipos = classificacao.propostas.map((p) => p?.tipo)
        const somenteCredito = tipos.length ? tipos.every((tipo) => tipo === 'amortizacao') :
            /\b(?:amortiz\w*|antecip\w*.{0,25}(?:contrato|parcelas?|divida|emprestimo|financiamento))\b/.test(atual) &&
            !/\b(?:meta|objetivo|investir|comprar)\b/.test(atual)
        const [categorias, financeiro] = await Promise.all([
            obterCategorias(usuario, sinal),
            buscarFinanceiro(usuario, { sinal, agora, mensagens, somenteCredito }).catch(() => ({ contexto: null }))
        ])
        sinal.throwIfAborted()
        const relevantes = [...new Set([...rascunhos.map((r) => r.valores.categoria).filter((nome) => categorias.includes(nome)), ...categorias])]
        const completo = prepararPayload(mensagens, hoje, rascunhos, relevantes, financeiro.contexto ?? null)
        const interpretacao = await interpretar(config, completo.payload, sinal)
        if (interpretacao.intencao !== 'planejamento') return falha
        const textos = [...mensagens].reverse().filter(({ role }) => role === 'user').map(({ content }) => normalizarTexto(content))
        return produzir(interpretacao, completo.referencias, {
            hoje, categorias: completo.payload.categorias, financeiro, atual, textos
        })
    } catch {
        sinal.throwIfAborted()
        if (classificado || (rascunhos.length && /^(?:sim|ok|pode ser|mude|altere|troque|ajuste)/.test(atual))) return falha
        return null
    }
}

module.exports = { planejar }
