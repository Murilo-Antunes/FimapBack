/*
 * Monta o contexto financeiro do usuário autenticado para o chat.
 * Consulta as metas no banco e os dados das conexões Open Finance autorizadas,
 * conforme os módulos e o período identificados na conversa.
 */

const { addAbortListener } = require('node:events')
const conexoesDAO = require('../../model/DAO/OpenFinance/conexaoOpenFinanceDAO.js')
const metasDAO = require('../../model/DAO/Metas/MetasDAO.js')
const pluggy = require('./pluggyService.js')
const extrato = require('./extratoCartaoService.js')
const painel = require('./dashboardService.js')
const projetar = require('./financialContextProjection.js')
const { selecionarContexto, diaISO, somarDias } = require('./financialContextSelection.js')
const { VERSAO_CONTEXTO_FINANCEIRO, LIMITE_CONTEXTO_FINANCEIRO_BYTES } = require('./chatValidation.js')

const PRAZO_CONSULTA_MS = 8_000
const LIMITE_CONEXOES = 12
const LIMITE_CARTOES_POR_CONEXAO = 6
const LIMITE_MESES_FATURA = 6
const DEPENDENCIAS_PATRIMONIO = ['contas', 'cartoes', 'investimentos', 'emprestimos']

// As leituras não registram os erros brutos de SDK ou banco. Podem conter URLs, dados e credenciais.
async function ler(sinal, buscar) {
    if (sinal.aborted) return null
    let listener
    try {
        const cancelada = new Promise((resolve) => { listener = addAbortListener(sinal, () => resolve(null)) })
        return await Promise.race([cancelada, buscar()])
    } catch {
        return null
    } finally {
        listener?.[Symbol.dispose]()
    }
}

async function mapearEmLotes(itens, tamanho, executar) {
    const resultados = []
    for (let indice = 0; indice < itens.length; indice += tamanho) {
        resultados.push(...await Promise.all(itens.slice(indice, indice + tamanho).map((item, posicao) => executar(item, indice + posicao))))
    }
    return resultados
}

function mesesDoPeriodo({ inicio, fim }) {
    const meses = []
    const mes = new Date(inicio)
    mes.setUTCDate(1)
    while (mes < fim) {
        meses.push(diaISO(mes).slice(0, 7))
        mes.setUTCMonth(mes.getUTCMonth() + 1)
    }
    return meses
}

async function lerFaturas(cartoes, itemId, periodo, sinal) {
    if (!cartoes.length) return { dados: [], parcial: false }
    const meses = mesesDoPeriodo(periodo)
    const consultas = cartoes.slice(0, LIMITE_CARTOES_POR_CONEXAO).flatMap((cartao) =>
        meses.slice(-LIMITE_MESES_FATURA).map((mes) => ({ cartao, mes })))
    const respostas = await mapearEmLotes(consultas, 3, ({ cartao, mes }) => ler(sinal, async () => {
        try {
            const resultado = await extrato.obterExtratoCartao(itemId, cartao.id, mes, sinal)
            return resultado?.atualizando ? null : projetar.faturaDoPeriodo(resultado, cartao, periodo)
        } catch (erro) {
            if (['FATURA_INDISPONIVEL', 'PERIODO_NAO_ENCONTRADO'].includes(erro.codigo)) return { semFatura: true }
            throw erro
        }
    }))
    return {
        dados: respostas.every((resposta) => resposta === null) ? null : respostas.filter((resposta) => resposta && !resposta.semFatura),
        parcial: respostas.some((resposta) => resposta === null || resposta?.semFatura) ||
            meses.length > LIMITE_MESES_FATURA || cartoes.length > LIMITE_CARTOES_POR_CONEXAO
    }
}

function dataAtualizacao(valor) {
    if (!valor) return null
    const data = new Date(valor)
    return Number.isFinite(data.getTime()) ? data.toISOString() : null
}

async function lerInstituicao(conexao, ordem, usuario, origens, periodo, agora, sinal) {
    const itemId = conexao.external_connection_id
    if (typeof itemId !== 'string' || !itemId) return {}
    const item = await ler(sinal, () => pluggy.validarItemDoUsuario(itemId, usuario, agora))
    if (!item || item.atualizando) return {}

    const atualizadoEm = dataAtualizacao(item.atualizadoEm)
    const registrar = (dados, parcial = false) => Array.isArray(dados)
        ? { dados: dados.map((dado) => ({ ...dado, instituicaoOrdem: ordem })), parcial: parcial || item.parcial, atualizadoEm }
        : null
    const selecionar = (resposta, prop) => resposta && !resposta.atualizando && Array.isArray(resposta[prop]) ? resposta[prop] : null
    const tarefas = {}

    if (['contas', 'cartoes', 'faturas', 'movimentacao'].some((origem) => origens.has(origem))) {
        const contas = ler(sinal, () => pluggy.listarContas(itemId, { preservarAusencia: true, validarVinculo: true, sinal }))
        if (origens.has('contas')) {
            tarefas.contas = contas.then((resposta) => {
                const dados = selecionar(resposta, 'contas')?.filter((conta) => conta.tipo === 'BANK')
                return registrar(dados, dados?.some((conta) => conta.saldo == null))
            })
        }
        if (origens.has('movimentacao')) {
            tarefas.movimentacao = contas.then(async (resposta) => {
                const dadosContas = selecionar(resposta, 'contas')
                if (!dadosContas) return null
                const bancoIds = new Set(dadosContas.filter(({ tipo }) => tipo === 'BANK').map(({ id }) => id))
                const transacoes = await ler(sinal, () => pluggy.listarTransacoes(itemId, {
                    resultadoContas: resposta,
                    dateFrom: diaISO(somarDias(periodo.inicio, -1)),
                    dateTo: diaISO(periodo.fim),
                    permitirParcial: true,
                    validarVinculo: true,
                    sinal
                }))
                if (!selecionar(transacoes, 'transacoes')) return null
                const doPeriodo = painel.filtrarTransacoesPorPeriodo(transacoes.transacoes, periodo.inicio, periodo.fim)
                return registrar(doPeriodo.map((tx) => ({ ...tx, bancaria: bancoIds.has(tx.contaId) })),
                    transacoes.parcial || doPeriodo.some(({ valor }) => valor == null))
            })
        }
        if (origens.has('cartoes') || origens.has('faturas')) {
            const cartoes = contas.then(async (resposta) => {
                if (!selecionar(resposta, 'contas')) return null
                return ler(sinal, () => pluggy.listarCartoes(itemId, { resultadoContas: resposta }))
            })
            if (origens.has('cartoes')) {
                tarefas.cartoes = cartoes.then((resposta) => {
                    const dados = selecionar(resposta, 'cartoes')
                    return registrar(dados, dados?.some((cartao) => cartao.faturaAberta == null))
                })
            }
            if (origens.has('faturas')) {
                tarefas.faturas = cartoes.then(async (resposta) => {
                    const dados = selecionar(resposta, 'cartoes')
                    if (!dados) return null
                    const faturas = await lerFaturas(dados, itemId, periodo, sinal)
                    return registrar(faturas.dados, faturas.parcial)
                })
            }
        }
    }

    if (origens.has('investimentos')) {
        tarefas.investimentos = ler(sinal, () => pluggy.listarInvestimentos(itemId, { preservarAusencia: true, validarVinculo: true, sinal })).then((resposta) => {
            const dados = selecionar(resposta, 'investimentos')
            return registrar(dados, dados?.some((item) => item.valor == null))
        })
    }
    if (origens.has('emprestimos')) {
        tarefas.emprestimos = ler(sinal, () => pluggy.listarEmprestimos(itemId, { incluirParcelas: true, validarVinculo: true, sinal })).then((resposta) => {
            const dados = selecionar(resposta, 'emprestimos')
            return registrar(dados, dados?.some((item) => item.saldoDevedor == null || item.cronogramaParcial || !Array.isArray(item.parcelas) ||
                item.parcelas.some((parcela) => !parcela.vencimento || parcela.valor == null)))
        })
    }

    return Object.fromEntries(await Promise.all(Object.entries(tarefas).map(async ([origem, tarefa]) => [origem, await tarefa])))
}

function combinar(instituicoes, fonte, listaDisponivel, excedeuLimite) {
    const leituras = instituicoes.map((instituicao) => instituicao[fonte]).filter(Boolean)
    return {
        dados: leituras.flatMap((leitura) => leitura.dados),
        disponivel: listaDisponivel && (!instituicoes.length || leituras.length > 0),
        parcial: excedeuLimite || leituras.length < instituicoes.length || leituras.some((leitura) => leitura.parcial),
        atualizadoEm: leituras.map((leitura) => leitura.atualizadoEm).filter(Boolean).sort()[0] ?? null
    }
}

function modulo(leitura, dados, fonte, referencia) {
    const estado = !leitura.disponivel ? 'indisponivel' : leitura.parcial ? 'parcial' : dados ? 'ok' : 'sem_dados'
    return { estado, fonte, referencia, atualizadoEm: leitura.atualizadoEm ?? null, dados }
}

function limitar(contexto) {
    const excedeu = () => Buffer.byteLength(JSON.stringify(contexto), 'utf8') > LIMITE_CONTEXTO_FINANCEIRO_BYTES
    if (!excedeu()) return contexto
    contexto.truncado = true
    for (const modulo of Object.values(contexto.modulos)) {
        if (modulo.dados?.detalhes) {
            delete modulo.dados.detalhes
            modulo.dados.detalhesTruncados = true
        }
    }
    if (!excedeu()) return contexto
    for (const modulo of Object.values(contexto.modulos)) {
        for (const campo of ['porMoeda', 'porMoedaContasBancarias', 'movimentacaoBancaria']) {
            if (!(modulo.dados?.[campo]?.length > 8)) continue
            modulo.dados[campo] = modulo.dados[campo].slice(0, 8)
            modulo.dados.moedasTruncadas = true
            if (modulo.estado === 'ok') modulo.estado = 'parcial'
        }
    }
    if (!excedeu()) return contexto
    contexto.modulosOmitidos = []
    const menosRelevantes = Object.keys(contexto.modulos).reverse().filter((nome) => nome !== 'comprometimento')
    for (const nome of [...menosRelevantes, 'comprometimento']) {
        if (!excedeu()) break
        if (!Object.hasOwn(contexto.modulos, nome)) continue
        delete contexto.modulos[nome]
        contexto.modulosOmitidos.push(nome)
    }
    return contexto
}

async function construirContextoFinanceiro(usuario, mensagens, { sinal: sinalExterno, agora = new Date() } = {}) {
    sinalExterno?.throwIfAborted()
    const selecao = selecionarContexto(mensagens, agora)
    if (!selecao) return null
    const { modulos, assunto, inicio, fim } = selecao
    const periodo = { inicio, fim }
    const sinalPrazo = AbortSignal.timeout(PRAZO_CONSULTA_MS)
    const sinal = sinalExterno ? AbortSignal.any([sinalExterno, sinalPrazo]) : sinalPrazo
    const origens = new Set(modulos.filter((nome) => !['patrimonio', 'metas', 'comprometimento'].includes(nome)))
    if (modulos.includes('patrimonio')) DEPENDENCIAS_PATRIMONIO.forEach((origem) => origens.add(origem))
    const movimentacaoBancaria = modulos.includes('contas') && /\b(?:movimenta\w*|extratos?|receitas?|despesas?|gastei|gastos?)\b/.test(assunto)
    if (movimentacaoBancaria) origens.add('movimentacao')

    const promessaMetas = modulos.includes('metas') ? ler(sinal, () => metasDAO.GetAllMetasUsuario(usuario, { propagarErro: true })) : null
    const conexoes = origens.size ? await ler(sinal, () => conexoesDAO.listarConexoesAtivasPorUsuario(usuario, LIMITE_CONEXOES + 1)) : []
    const listaDisponivel = Array.isArray(conexoes)
    const excedeuLimite = listaDisponivel && conexoes.length > LIMITE_CONEXOES
    const instituicoes = listaDisponivel ? await mapearEmLotes(conexoes.slice(0, LIMITE_CONEXOES), 3,
        (conexao, indice) => lerInstituicao(conexao, indice + 1, usuario, origens, periodo, agora, sinal)) : []
    const metas = await promessaMetas
    sinalExterno?.throwIfAborted()

    const documentos = Object.fromEntries([...origens].map((origem) => [origem, combinar(instituicoes, origem, listaDisponivel, excedeuLimite)]))
    const dados = {}
    for (const nome of modulos) {
        if (nome === 'comprometimento') continue
        if (nome === 'metas') {
            dados.metas = modulo({ disponivel: Array.isArray(metas) }, metas?.length ? projetar.metas(metas, assunto) : null, 'fimap_metas', 'posicao_atual')
            continue
        }
        if (nome === 'patrimonio') {
            const componentes = DEPENDENCIAS_PATRIMONIO.map((origem) => documentos[origem])
            const leitura = {
                disponivel: componentes.some((origem) => origem.disponivel),
                parcial: componentes.some((origem) => !origem.disponivel || origem.parcial),
                atualizadoEm: componentes.map((origem) => origem.atualizadoEm).filter(Boolean).sort()[0]
            }
            const resultado = projetar.patrimonio(documentos)
            dados.patrimonio = modulo(leitura, resultado.porMoeda.length ? resultado : null, 'open_finance', 'posicao_atual')
            continue
        }
        const leitura = documentos[nome]
        const transacoes = movimentacaoBancaria && documentos.movimentacao
        const itens = leitura.dados
        const resultado = nome === 'contas'
            ? projetar.contas(itens, transacoes?.disponivel ? transacoes.dados.filter((tx) => tx.bancaria) : null)
            : projetar[nome](itens, periodo)
        const referencia = ['movimentacao', 'faturas'].includes(nome) ? 'periodo' :
            nome === 'emprestimos' || (nome === 'contas' && movimentacaoBancaria) ? 'posicao_atual_e_periodo' : 'posicao_atual'
        if (nome === 'contas' && transacoes && (!transacoes.disponivel || transacoes.parcial)) leitura.parcial = true
        dados[nome] = modulo(leitura, itens.length ? resultado : null, 'open_finance', referencia)
    }

    if (modulos.includes('comprometimento')) {
        const componentes = [dados.movimentacao, dados.faturas, dados.emprestimos]
        const consolidado = projetar.comprometimento(...componentes)
        const leitura = {
            disponivel: componentes.some(({ estado }) => estado !== 'indisponivel'),
            parcial: componentes.some(({ estado }) => !['ok', 'sem_dados'].includes(estado)),
            atualizadoEm: componentes.map(({ atualizadoEm }) => atualizadoEm).filter(Boolean).sort()[0]
        }
        dados.comprometimento = modulo(leitura, consolidado.porMoeda.length ? consolidado : null, 'open_finance', 'periodo')
    }

    return limitar({
        versao: VERSAO_CONTEXTO_FINANCEIRO,
        consultadoEm: agora.toISOString(),
        periodo: { inicio: diaISO(inicio), fimExclusivo: diaISO(fim), fuso: 'America/Sao_Paulo' },
        moeda: 'BRL',
        conexoes: !origens.size ? 'nao_consultadas' : !listaDisponivel ? 'indisponiveis' : conexoes.length ? 'cadastradas' : 'sem_conexao',
        modulos: dados
    })
}

module.exports = { construirContextoFinanceiro }
