const { test } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { randomUUID } = require('node:crypto')
const jwt = require('jsonwebtoken')
const { database } = require('./helpers/chatDatabase.js')
const { load, sse } = require('./helpers/chatHarness.js')
const financeiro = require('../src/services/financialContextService.js')
const conexoesDAO = require('../model/DAO/OpenFinance/conexaoOpenFinanceDAO.js')
const metasDAO = require('../model/DAO/Metas/MetasDAO.js')
const pluggy = require('../src/services/pluggyService.js')
const extrato = require('../src/services/extratoCartaoService.js')
const ia = require('../src/services/aiChatService.js')
const { LIMITE_CONTEXTO_FINANCEIRO_BYTES } = require('../src/services/chatValidation.js')

const agora = new Date('2026-11-21T15:00:00Z')
const urlWorker = 'https://ia.test/v1/ia/chat'
const atualizadoEm = '2026-11-20T10:00:00.000Z'
const pergunta = 'Quanto da minha receita deste mês já está comprometida?'
const ids = { a: 'item-bancario-A-privado', b: 'item-bancario-B-privado', c: 'item-bancario-C-privado' }

function configurarWorker(t) {
    const configuracao = {
        JWT_SECRET: 'segredo-jwt-apenas-teste',
        CLOUDFLARE_WORKER_URL: urlWorker,
        CLOUDFLARE_CHAT_TOKEN: 'bearer-worker-apenas-teste',
        CLOUDFLARE_FINANCIAL_CONTEXT_VERSION: '1'
    }
    const anteriores = Object.fromEntries(Object.keys(configuracao).map((chave) => [chave, process.env[chave]]))
    Object.assign(process.env, configuracao)
    t.after(() => {
        for (const [chave, valor] of Object.entries(anteriores)) {
            if (valor === undefined) delete process.env[chave]
            else process.env[chave] = valor
        }
    })
}

function simularFontes(t, db, sqlite) {
    sqlite.exec(`
        CREATE TABLE tbl_conexao_open_finance (
            id INTEGER PRIMARY KEY, external_connection_id TEXT, id_usuario INTEGER, status INTEGER,
            provedor TEXT, ultima_sincronizacao TEXT
        );
        CREATE TABLE tbl_meta_financeira (
            id INTEGER PRIMARY KEY, id_usuario INTEGER, nome TEXT, descricao TEXT, valor_inicio REAL, valor_desejado REAL,
            valor_total REAL, aporte_mensal REAL, data_alvo TEXT, status INTEGER, id_categoria INTEGER, id_conta_vinculada INTEGER
        );
    `)
    const inserir = sqlite.prepare('INSERT INTO tbl_conexao_open_finance VALUES (?, ?, ?, ?, ?, NULL)')
    inserir.run(1, ids.a, 3, 1, 'pluggy')
    inserir.run(2, ids.b, 3, 1, 'pluggy')
    inserir.run(3, ids.c, 4, 1, 'pluggy')
    inserir.run(4, 'conexao-desativada', 3, 0, 'pluggy')
    inserir.run(5, 'outro-provedor', 3, 1, 'outro')
    sqlite.exec(`
        INSERT INTO tbl_meta_financeira VALUES
            (1, 3, 'Reserva', 'segredo-na-descricao', 0, 100, 25, 10, '2027-03-01', 1, 2, 1),
            (2, 4, 'Meta de outro usuário', '', 0, 5000, 4321, 250, '2028-01-01', 1, 2, 3),
            (3, 5, 'Curso', '', 0, 50, 0, 10, '2027-03-01', 1, 2, NULL);
    `)
    const conexoes = load('model/DAO/OpenFinance/conexaoOpenFinanceDAO.js', { knex: () => db })
    const metas = load('model/DAO/Metas/MetasDAO.js', { knex: () => db })
    t.mock.method(conexoesDAO, 'listarConexoesAtivasPorUsuario', conexoes.listarConexoesAtivasPorUsuario)
    t.mock.method(metasDAO, 'GetAllMetasUsuario', metas.GetAllMetasUsuario)

    const donos = { [ids.a]: '3', [ids.b]: '3', [ids.c]: '4' }
    const checagens = []
    const pluggyComDono = load('src/services/pluggyService.js', {
        '../config/pluggy': { async fetchItem(id) {
            checagens.push(id)
            return { id, clientUserId: donos[id], status: 'UPDATED', lastUpdatedAt: atualizadoEm,
                parameter: { password: 'credencial-privada-do-banco' } }
        } }
    })
    t.mock.method(pluggy, 'validarItemDoUsuario', pluggyComDono.validarItemDoUsuario)

    const renda = { [ids.a]: [1000, 600], [ids.b]: [500, 400], [ids.c]: [90000, 80000] }
    const faturas = { [ids.a]: [150, 80], [ids.b]: [100, 70], [ids.c]: [7654, 4321] }
    const saldoContas = { [ids.a]: 1200, [ids.b]: 0, [ids.c]: 99999 }
    const saldoDevedor = { [ids.a]: 600, [ids.b]: 400, [ids.c]: 1234 }
    const saldoInvestimentos = { [ids.a]: 2000, [ids.b]: 3000, [ids.c]: 16000 }
    const leituras = []
    const falhas = new Set()
    t.mock.method(pluggy, 'listarContas', async (item) => {
        leituras.push(item)
        assert.ok(donos[item])
        return { contas: [
            { id: `conta-${item}`, saldo: saldoContas[item], tipo: 'BANK', moeda: 'BRL', nome: 'numero-da-conta-123456789' },
            { id: `cartao-${item}`, saldo: faturas[item][0], tipo: 'CREDIT', limite: 1000, limiteDisponivel: 550, moeda: 'BRL', number: '9999888877776666' }
        ] }
    })
    t.mock.method(pluggy, 'listarTransacoes', async (item, { dateFrom, dateTo }) => {
        assert.ok(dateFrom < dateTo)
        return { transacoes: [
            { contaId: `conta-${item}`, valor: renda[item][0], data: '2026-11-10T12:00:00Z', descricao: 'transacao-privada' },
            { contaId: `conta-${item}`, valor: renda[item][1], data: '2026-10-10T12:00:00Z' },
            { contaId: `conta-${item}`, valor: -50, data: '2026-11-12T12:00:00Z' },
            { contaId: `cartao-${item}`, valor: 900, data: '2026-11-10T12:00:00Z' },
            { contaId: `conta-${item}`, valor: -5, data: '2026-11-01T02:00:00Z' }
        ] }
    })
    t.mock.method(extrato, 'obterExtratoCartao', async (item, cartao, mes) => {
        assert.equal(cartao, `cartao-${item}`)
        if (falhas.has(item)) throw new Error(`Falha ao consultar ${cartao} com token confidencial`)
        return {
            cartao: { id: cartao, finalNumero: '6666' },
            fatura: { valorTotal: faturas[item][Number(mes === '2026-10')], vencimento: mes + '-20', status: 'fechada' },
            lancamentos: [{ tipo: 'compra', valor: 20 }, { tipo: 'estorno', valor: 5 }, { tipo: 'pagamento', valor: 10 }]
        }
    })
    t.mock.method(pluggy, 'listarInvestimentos', async (item) => ({ investimentos: [
        { id: `investimento-${item}`, tipo: 'FIXED_INCOME', moeda: 'BRL', valor: saldoInvestimentos[item], dataSaldo: '2026-11-20' },
        ...(item === ids.a ? [{ tipo: 'EQUITY', moeda: 'USD', valor: 10 }] : [])
    ] }))
    t.mock.method(pluggy, 'listarEmprestimos', async (item, opcoes) => {
        assert.equal(opcoes.incluirParcelas, true)
        const valor = item === ids.a ? 100 : item === ids.b ? 50 : 5000
        return { emprestimos: [{ id: `emprestimo-${item}`, saldoDevedor: saldoDevedor[item], parcelaMensal: valor, moeda: 'BRL', parcelas: [
            { vencimento: '2026-11-20', valor, status: 'PENDENTE' },
            { vencimento: '2026-10-20', valor, status: 'PAGA' },
            { vencimento: '2026-11-12', valor: 20, status: 'AMORTIZADA' }
        ] }] }
    })
    return { checagens, leituras, falhas, inserir }
}

test('chat autenticado monta e envia contexto v1, isola usuários, consolida bancos e mantém SSE', async (t) => {
    configurarWorker(t)
    const { db, state, sqlite } = database()
    const connectionPath = require.resolve('../model/Database_config_knex/connection.js')
    require.cache[connectionPath] = { id: connectionPath, filename: connectionPath, loaded: true, exports: db }
    sqlite.exec(`INSERT INTO tbl_usuario VALUES (5); INSERT INTO tbl_chat VALUES (11, 'Sem banco', '2026-11-01', 5);`)
    const fontes = simularFontes(t, db, sqlite)
    const construir = financeiro.construirContextoFinanceiro
    t.mock.method(financeiro, 'construirContextoFinanceiro', (usuario, history, opcoes) => construir(usuario, history, { ...opcoes, agora }))

    const app = require('../src/app.js')
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        sqlite.close()
    })
    const base = 'http://127.0.0.1:' + server.address().port
    const requisicoesWorker = []
    const nativeFetch = global.fetch
    t.mock.method(global, 'fetch', (url, options) => {
        if (url !== urlWorker) return nativeFetch(url, options)
        assert.equal(options.headers.Authorization, 'Bearer bearer-worker-apenas-teste')
        const payload = JSON.parse(options.body)
        assert.deepEqual(Object.keys(payload), payload.contextoFinanceiro ? ['messages', 'contextoFinanceiro'] : ['messages'])
        assert.deepEqual(Object.keys(payload.messages.at(-1)), ['role', 'content'])
        requisicoesWorker.push(payload)
        return Promise.resolve(sse('data: {"tipo":"trecho","conteudo":"Resposta simulada"}\n\ndata: {"tipo":"fim"}\n\n'))
    })
    const enviar = (usuario, chat, texto, uuid = randomUUID()) => nativeFetch(base + '/v1/ia/chat/mensagens', {
        method: 'POST', headers: {
            'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ sub: String(usuario) }, process.env.JWT_SECRET)
        },
        body: JSON.stringify({ id_chat: chat, pergunta: texto, requisicao_id: uuid, id_usuario: 4, itemId: ids.c,
            contextoFinanceiro: { dados: 'valor falsificado' } })
    })
    const lerEventos = async (resposta) => {
        assert.equal(resposta.status, 200)
        assert.match(resposta.headers.get('Content-Type'), /^text\/event-stream/)
        const eventos = (await resposta.text()).trim().split('\n\n').map((evento) => JSON.parse(evento.slice(6)))
        assert.deepEqual(eventos.map((evento) => evento.tipo), ['trecho', 'fim'])
        return eventos
    }
    const enviarNova = async (usuario, chat, texto) => {
        state.now += 6000
        await lerEventos(await enviar(usuario, chat, texto))
        return requisicoesWorker.at(-1).contextoFinanceiro
    }

    const proibida = await enviar(4, 7, pergunta)
    assert.equal(proibida.status, 404)
    assert.equal(requisicoesWorker.length, 0)
    assert.deepEqual(fontes.checagens, [])

    const uuid = randomUUID()
    await lerEventos(await enviar(3, 7, pergunta, uuid))
    const primeiro = requisicoesWorker[0].contextoFinanceiro
    assert.equal(primeiro.versao, 1)
    assert.equal(primeiro.periodo.inicio, '2026-11-01')
    assert.deepEqual(fontes.checagens, [ids.a, ids.b])
    assert.deepEqual(Object.keys(primeiro.modulos), ['movimentacao', 'faturas', 'emprestimos', 'comprometimento'])
    assert.deepEqual(primeiro.modulos.comprometimento.dados.porMoeda[0], {
        moeda: 'BRL', receita: 1500, faturas: 250, parcelasPagas: 0, parcelasPendentesEstimadas: 150,
        totalComprometido: 400, percentualDaReceita: 26.67
    })
    const texto = JSON.stringify(primeiro)
    for (const privado of [...Object.values(ids), 'numero-da-conta', 'transacao-privada', 'credencial-privada', '9999888877776666', 'valor falsificado']) {
        assert.equal(texto.includes(privado), false, privado)
    }
    assert.equal(state.messages.length, 2)
    assert.equal(state.messages.some(({ conteudo }) => conteudo.includes('contextoFinanceiro')), false)

    const replay = await lerEventos(await enviar(3, 7, pergunta, uuid))
    assert.equal(replay.at(-1).recuperada, true)
    assert.equal(requisicoesWorker.length, 1)
    assert.equal(fontes.checagens.length, 2)

    const anterior = await enviarNova(3, 7, 'E no mês passado?')
    assert.deepEqual(anterior.periodo, { inicio: '2026-10-01', fimExclusivo: '2026-11-01', fuso: 'America/Sao_Paulo' })
    assert.deepEqual(anterior.modulos.comprometimento.dados.porMoeda[0], {
        moeda: 'BRL', receita: 1000, faturas: 150, parcelasPagas: 150, parcelasPendentesEstimadas: 0,
        totalComprometido: 300, percentualDaReceita: 30
    })
    assert.equal(anterior.modulos.movimentacao.dados.porMoeda[0].despesas, 10)
    assert.equal(requisicoesWorker.at(-1).messages.length, 3)

    const panorama = await enviarNova(3, 9, 'Qual meu patrimônio, extrato das contas, limites dos cartões, investimentos e progresso da meta Reserva?')
    assert.equal(panorama.modulos.patrimonio.dados.porMoeda[0].patrimonioLiquido, 4950)
    assert.equal(panorama.modulos.patrimonio.dados.porMoeda[1].patrimonioLiquido, 10)
    assert.equal(panorama.modulos.contas.dados.detalhes[1].saldo, 0)
    assert.equal(panorama.modulos.contas.dados.movimentacaoBancaria[0].despesas, 100)
    assert.equal(panorama.modulos.investimentos.dados.porMoeda[0].valorAtual, 5000)
    assert.equal(panorama.modulos.cartoes.dados.porMoeda[0].limiteTotal, 2000)
    assert.equal(panorama.modulos.metas.dados.detalhes[0].progressoPercentual, 25)
    assert.equal(panorama.modulos.metas.dados.selecionadasPorNome, true)
    assert.equal(JSON.stringify(panorama).includes('segredo-na-descricao'), false)

    const outro = await enviarNova(4, 8, 'Qual meu saldo bancário e minhas metas?')
    assert.equal(outro.modulos.contas.dados.porMoeda[0].saldo, 99999)
    assert.equal(outro.modulos.metas.dados.acumulado, 4321)
    assert.equal(fontes.checagens.at(-1), ids.c)

    fontes.inserir.run(6, ids.c, 3, 1, 'pluggy')
    fontes.falhas.add(ids.b)
    const inicioLeituras = fontes.leituras.length
    const parcial = await enviarNova(3, 10, pergunta)
    assert.equal(parcial.modulos.faturas.estado, 'parcial')
    assert.equal(parcial.modulos.faturas.dados.porMoeda[0].comprasLiquidas, 15)
    assert.equal(parcial.modulos.faturas.dados.porMoeda[0].valorTotal, 150)
    assert.equal(parcial.modulos.faturas.atualizadoEm, atualizadoEm)
    assert.equal(parcial.modulos.comprometimento.dados.porMoeda[0].percentualDaReceita, null)
    assert.deepEqual(fontes.leituras.slice(inicioLeituras), [ids.a, ids.b])

    const semBanco = await enviarNova(5, 11, 'Qual o meu patrimônio e o progresso das minhas metas?')
    assert.equal(semBanco.conexoes, 'sem_conexao')
    assert.equal(semBanco.modulos.patrimonio.estado, 'sem_dados')
    assert.equal(semBanco.modulos.patrimonio.dados, null)
    assert.equal(semBanco.modulos.metas.dados.detalhes[0].progressoPercentual, 0)

    const consultas = fontes.checagens.length
    assert.equal(await enviarNova(5, 11, 'O que é patrimônio líquido?'), undefined)
    assert.equal(fontes.checagens.length, consultas)
    process.env.CLOUDFLARE_FINANCIAL_CONTEXT_VERSION = ''
    assert.equal(await enviarNova(3, 7, pergunta), undefined)
    assert.equal(fontes.checagens.length, consultas)
})

test('adaptador bloqueia contexto na rota pública, na rota legada, em HTTP e fora do limite', async (t) => {
    configurarWorker(t)
    const corpos = []
    t.mock.method(global, 'fetch', async (_url, options) => {
        corpos.push(JSON.parse(options.body))
        return sse('data: {"tipo":"trecho","conteudo":"Resposta"}\n\ndata: {"tipo":"fim"}\n\n')
    })
    const messages = [{ role: 'user', content: 'Qual meu saldo?' }]
    const contexto = { versao: 1, modulos: {} }
    for (const url of ['https://ia.test/v1/ia/chat-publico', 'https://ia.test/chat', 'http://ia.test/v1/ia/chat']) {
        process.env.CLOUDFLARE_WORKER_URL = url
        await ia.gerarResposta(messages, undefined, undefined, contexto)
        assert.deepEqual(corpos.at(-1), { messages })
    }
    process.env.CLOUDFLARE_WORKER_URL = urlWorker
    await ia.gerarResposta(messages, undefined, undefined, { ...contexto, campo: 'á'.repeat(10_000) })
    assert.deepEqual(corpos.at(-1), { messages })
})

test('cancela a coleta financeira antes de consultar os produtos do Pluggy', async (t) => {
    let consultou
    const iniciou = new Promise((resolve) => { consultou = resolve })
    t.mock.method(conexoesDAO, 'listarConexoesAtivasPorUsuario', () => {
        consultou()
        return new Promise(() => {})
    })
    const validarItem = t.mock.method(pluggy, 'validarItemDoUsuario', () => assert.fail('Não deve iniciar outra leitura'))
    const controle = new AbortController()
    const consulta = financeiro.construirContextoFinanceiro(3, [{ role: 'user', content: pergunta }], { sinal: controle.signal, agora })
    await iniciou
    controle.abort(new Error('cancelou'))
    await assert.rejects(consulta, { message: 'cancelou' })
    assert.equal(validarItem.mock.callCount(), 0)
})

test('consulta financeira distingue falha de conexões e saldo ou progresso zero', async (t) => {
    t.mock.method(conexoesDAO, 'listarConexoesAtivasPorUsuario', async () => { throw new Error('MySQL indisponível') })
    t.mock.method(metasDAO, 'GetAllMetasUsuario', async () => [{ nome: 'Viagem', valor_total: '0.00', valor_desejado: 5000 }])
    const mensagens = [{ role: 'user', content: 'Qual meu saldo bancário e o progresso das minhas metas?' }]
    const resultado = await financeiro.construirContextoFinanceiro(3, mensagens, { agora })
    assert.equal(resultado.conexoes, 'indisponiveis')
    assert.equal(resultado.modulos.contas.estado, 'indisponivel')
    assert.equal(resultado.modulos.contas.dados, null)
    assert.equal(resultado.modulos.metas.estado, 'ok')
    assert.equal(resultado.modulos.metas.dados.acumulado, 0)
})

test('o teto de contexto preserva o agregado principal antes de omitir detalhes', async (t) => {
    t.mock.method(conexoesDAO, 'listarConexoesAtivasPorUsuario', async () => [{ external_connection_id: ids.a }])
    t.mock.method(pluggy, 'validarItemDoUsuario', async () => ({ atualizadoEm }))
    const moedas = ['BRL', ...Array.from({ length: 400 }, (_valor, indice) =>
        `X${String.fromCharCode(65 + Math.floor(indice / 26), 65 + (indice % 26))}`)]
    t.mock.method(pluggy, 'listarContas', async () => ({ contas: moedas.map((moeda) => ({ tipo: 'BANK', saldo: 100, moeda })) }))
    const resultado = await financeiro.construirContextoFinanceiro(3, [{ role: 'user', content: 'Qual meu saldo?' }], { agora })
    assert.ok(Buffer.byteLength(JSON.stringify(resultado), 'utf8') <= LIMITE_CONTEXTO_FINANCEIRO_BYTES)
    assert.equal(resultado.truncado, true)
    const contas = resultado.modulos.contas
    assert.equal(contas.estado, 'parcial')
    assert.equal(contas.dados.moedasTruncadas, true)
    assert.equal(contas.dados.detalhesTruncados, true)
    assert.deepEqual(contas.dados.porMoeda[0], { moeda: 'BRL', quantidade: 1, saldo: 100 })
})

test('o serviço Pluggy rejeita consentimento vencido e produtos de item ou conta divergentes', async () => {
    let consentExpiresAt = '2026-11-01T00:00:00Z'
    const consultas = []
    const cliente = load('src/services/pluggyService.js', {
        '../config/pluggy': {
            async fetchItem(id) { return { id, status: 'UPDATED', clientUserId: '3', consentExpiresAt } },
            async fetchAccounts() { return [{ id: 'conta-alheia', itemId: ids.c }] },
            async fetchInvestments() { return [{ itemId: ids.c }] },
            async fetchLoans() { return [{ itemId: ids.c }] },
            async fetchAllTransactions(id) {
                consultas.push(id)
                return [{ accountId: 'conta-alheia', amount: 90000 }]
            }
        }
    })
    assert.equal(await cliente.validarItemDoUsuario(ids.a, 3, agora), null)
    consentExpiresAt = '2027-01-01T00:00:00Z'
    assert.ok(await cliente.validarItemDoUsuario(ids.a, 3, agora))
    assert.equal(await cliente.validarItemDoUsuario(ids.a, 4, agora), null)
    for (const buscar of [cliente.listarContas, cliente.listarInvestimentos, cliente.listarEmprestimos]) {
        await assert.rejects(buscar(ids.a, { validarVinculo: true }), { message: 'VINCULO_PRODUTO_INVALIDO' })
    }
    await assert.rejects(cliente.listarTransacoes(ids.a, {
        resultadoContas: { contas: [{ id: 'conta-autorizada' }] }, validarVinculo: true, permitirParcial: true
    }), { message: 'TRANSACOES_INDISPONIVEIS' })
    assert.deepEqual(consultas, ['conta-autorizada'])
})
