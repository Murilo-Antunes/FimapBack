const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const { stack } = require('./helpers/chatStack.js')
const { response } = require('./helpers/chatHarness.js')
const { criarErro } = require('../src/services/chatValidation.js')
const provider = () => ({ calls: 0, obterConfiguracaoPrivada() {}, async gerarResposta(messages, chunk) {
    this.calls++; this.messages = messages; await chunk('Resposta 🌎'); return 'Resposta 🌎'
} })
const req = (body = {}, params = {}) => ({ usuario: { id: 3 }, body, params, query: {} })
const send = (s, uuid = randomUUID(), chat = 7, user = 3, text = 'Olá') =>
    s.service.gerar(user, chat, uuid, text, async () => {})

// Os testes usam consultas SQL reais. Duas instâncias de serviço compartilham o mesmo banco.
test('histórico próprio, vazio, cronologia estável e ausência de limite silencioso', async () => {
    const s = stack()
    assert.deepEqual(Array.from(await s.dao.listarMensagensChat(7, 3)), [])
    for (let id = 1; id <= 105; id++) await s.db('tbl_mensagem').insert({ id, id_chat: 7, papel: id % 2 ? 1 : 2,
        conteudo: 'Mensagem ' + id, data_envio: id === 1 ? '2026-02-01' : '2026-01-01' })
    const res = response()
    await s.controller.listarMensagensChat(req({}, { id_chat: '7' }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.conteudo.length, 105)
    assert.equal(res.body.conteudo[0].id, 2)
    assert.equal(res.body.conteudo.at(-1).id, 1)
    assert.equal(res.body.conteudo[0].papel, 1)
    assert.equal(res.body.conteudo.at(-1).papel, 0)
})

test('banco indisponível não é interpretado como histórico vazio', async () => {
    const s = stack(), res = response()
    s.state.failRead = true
    await s.controller.listarMensagensChat(req({}, { id_chat: '7' }), res)
    assert.equal(res.statusCode, 500)
    assert.equal(res.body.codigo, 'CHAT_BANCO')
    assert.equal(res.body.conteudo, undefined)
})

test('isolamento de chats e mensagens, mutações e IDs de usuário enviados pelo cliente', async () => {
    const s = stack(provider())
    assert.equal(await s.chat.GetChatById(8, 3), null)
    assert.equal(await s.chat.UpdateChatName(8, 'Ataque', 3), false)
    assert.equal(await s.chat.apagarChat(8, 3), false)
    assert.equal(await s.dao.listarMensagensChat(8, 3), null)
    await assert.rejects(send(s, randomUUID(), 8), { statusCode: 404 })
    for (const method of ['ListaPorId', 'AtualizarNomeChat', 'ApagarChat']) {
        const res = response()
        await s.chatController[method](req({ nome: 'Ataque', id_usuario: 4 }, { id_chat: '8' }), res)
        assert.equal(res.statusCode, 404)
    }
    let res = response()
    await s.chatController.CriarChat(req({ nome: 'Nova', id_usuario: 4 }), res)
    assert.equal(res.statusCode, 201)
    const novo = s.state.chats.find((c) => c.id === res.body.id)
    assert.equal(novo.id_usuario, 3)
    res = response()
    await s.chatController.ListarChatsPorUsuario(req(), res)
    assert.ok(res.body.conteudo.every((c) => c.id_usuario === 3))
    res = response()
    await s.chatController.AtualizarNomeChat(req({ nome: 'Renomeado' }, { id_chat: String(novo.id) }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(s.state.chats.find((c) => c.id === novo.id).nome, 'Renomeado')
    res = response()
    await s.chatController.ApagarChat(req({}, { id_chat: String(novo.id) }), res)
    assert.equal(res.statusCode, 200)
})

test('idempotência durável recupera commit sem fim, sem inferir ou gravar novamente', async () => {
    const ia = provider(), s = stack(ia), uuid = randomUUID()
    const r = await send(s, uuid)
    const outraInstancia = stack(ia, s)
    const consulta = await outraInstancia.service.consultar(3, uuid)
    assert.equal(consulta.estado, 'concluida')
    assert.equal(consulta.resultado.mensagem_assistente.id, r.mensagem_assistente.id)
    const replay = await send(outraInstancia, uuid)
    assert.equal(replay.recuperada, true)
    assert.equal(ia.calls, 1)
    assert.equal(s.state.messages.length, 2)
    assert.equal(s.state.requests.length, 1)
    await assert.rejects(send(s, uuid, 7, 3, 'Outro texto'), { code: 'REQUISICAO_CONFLITO' })
    await assert.rejects(send(s, uuid, 9), { code: 'REQUISICAO_CONFLITO' })
    await assert.rejects(s.service.consultar(4, uuid), { statusCode: 404 })
    await assert.rejects(s.service.cancelar(4, uuid), { statusCode: 404 })
    await assert.rejects(s.service.consultar(3, randomUUID()), { statusCode: 404 })
    assert.equal((await s.service.cancelar(3, uuid)).estado, 'concluida')
})

test('duas instâncias reservam uma única geração por conversa e identificam repetição ativa', async () => {
    let release, ready
    const started = new Promise((r) => { ready = r })
    const ia = provider()
    ia.gerarResposta = async () => { ia.calls++; ready(); return new Promise((r) => { release = r }) }
    const s = stack(ia), uuid = randomUUID(), other = stack(ia, s)
    const first = send(s, uuid)
    await started
    await assert.rejects(send(other, uuid), { code: 'REQUISICAO_EM_ANDAMENTO' })
    await assert.rejects(send(other), { code: 'CHAT_EM_ANDAMENTO' })
    assert.equal((await other.service.consultar(3, uuid)).estado, 'gerando')
    release('Resposta')
    await first
    assert.equal(ia.calls, 1)
    s.state.now += 5001
    ia.gerarResposta = provider().gerarResposta
    await send(other)
    assert.equal(s.state.messages.length, 4)
})

test('pergunta e resposta são atômicas; falha na segunda gravação não envia fim', async () => {
    const s = stack(provider()), res = response(), uuid = randomUUID()
    s.state.failMessageInsert = 2
    await s.controller.enviarMensagemChat(req({ id_chat: 7, pergunta: 'Olá', requisicao_id: uuid }), res)
    assert.equal(res.events().at(-1).tipo, 'erro')
    assert.ok(!res.events().some((e) => e.tipo === 'fim'))
    assert.equal(s.state.messages.length, 0)
    assert.equal((await s.service.consultar(3, uuid)).estado, 'falhou')
    await assert.rejects(send(s, uuid), { code: 'CHAT_BANCO' })
})

test('fim é emitido depois do commit e contém IDs recuperáveis', async () => {
    const s = stack(provider()), res = response(), uuid = randomUUID()
    const write = res.write
    res.write = function (text) {
        if (text.includes('"tipo":"fim"')) {
            assert.equal(s.state.messages.length, 2)
            assert.equal(s.state.requests[0].estado, 'concluida')
            assert.ok(s.state.queries.includes('COMMIT;'))
        }
        return write.call(this, text)
    }
    await s.controller.enviarMensagemChat(req({ id_chat: 7, pergunta: 'Olá', requisicao_id: uuid }), res)
    const fim = res.events().at(-1)
    assert.equal(fim.tipo, 'fim')
    assert.equal(fim.requisicao_id, uuid)
    assert.equal(fim.id_chat, 7)
    assert.equal(res.listenerCount('close'), 0)
})

test('contexto usa até cinco pares completos, preserva legado e ignora perguntas órfãs', async () => {
    const ia = provider(), s = stack(ia)
    for (let id = 0; id < 7; id++) {
        await s.db('tbl_mensagem').insert({ id_chat: 7, papel: 1, conteudo: 'Pergunta ' + id, data_envio: '2026-01-01' })
        await s.db('tbl_mensagem').insert({ id_chat: 7, papel: 2, conteudo: 'Resposta ' + id, data_envio: '2026-01-01' })
    }
    await s.db('tbl_mensagem').insert({ id_chat: 7, papel: 1, conteudo: 'Órfã', data_envio: '2026-01-01' })
    await send(s)
    assert.equal(ia.messages.length, 11)
    assert.equal(ia.messages[0].content, 'Pergunta 2')
    assert.equal(ia.messages.at(-1).content, 'Olá')
    assert.ok(!ia.messages.some((m) => m.content === 'Órfã'))
})

test('contexto fora dos limites do Worker é rejeitado sem inferência', async () => {
    const ia = provider(), s = stack(ia)
    await s.db('tbl_mensagem').insert({ id_chat: 7, papel: 1, conteudo: 'Olá', data_envio: '2026-01-01' })
    await s.db('tbl_mensagem').insert({ id_chat: 7, papel: 2, conteudo: 'x'.repeat(16001), data_envio: '2026-01-01' })
    await assert.rejects(send(s), { code: 'IA_ENTRADA_INVALIDA' })
    assert.equal(ia.calls, 0)
})

test('erros antes/depois do primeiro trecho não concluem e liberam a reserva', async () => {
    for (const parcial of [false, true]) {
        const ia = provider(), s = stack(ia), res = response(), uuid = randomUUID()
        ia.gerarResposta = async (_messages, chunk) => {
            if (parcial) await chunk('Parcial')
            throw criarErro(502, 'Fluxo interrompido.', 'IA_FLUXO_INTERROMPIDO')
        }
        await s.controller.enviarMensagemChat(req({ id_chat: 7, pergunta: 'Olá', requisicao_id: uuid }), res)
        if (parcial) assert.equal(res.events().at(-1).codigo, 'IA_FLUXO_INTERROMPIDO')
        else { assert.equal(res.statusCode, 502); assert.equal(res.body.codigo, 'IA_FLUXO_INTERROMPIDO') }
        assert.equal(s.state.messages.length, 0)
        assert.equal(s.state.requests[0].chat_ativo, null)
        assert.equal(s.state.requests[0].estado, 'falhou')
    }
})

test('desconexão cancela Worker, não salva par incompleto e limpa listeners', async () => {
    const res = response(), ia = provider(), s = stack(ia)
    let received
    ia.gerarResposta = async (_m, chunk, signal) => {
        received = signal
        await chunk('Parcial')
        res.destroyed = true; res.emit('close'); signal.throwIfAborted()
    }
    await s.controller.enviarMensagemChat(req({ id_chat: 7, pergunta: 'Olá' }), res)
    assert.equal(received.aborted, true)
    assert.equal(s.state.requests[0].estado, 'cancelada')
    assert.equal(s.state.messages.length, 0)
    assert.equal(res.listenerCount('close'), 0)
})

test('cancelamento durável entre instâncias aborta o sinal e impede commit', async () => {
    const ia = provider(), s = stack(ia), other = stack(ia, s), uuid = randomUUID()
    let ready
    const started = new Promise((r) => { ready = r })
    ia.gerarResposta = async (_m, _chunk, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }); ready()
    })
    const generation = send(s, uuid)
    const rejection = assert.rejects(generation, { code: 'REQUISICAO_CANCELADA' })
    await started
    assert.equal((await other.service.cancelar(3, uuid)).estado, 'cancelada')
    await rejection
    assert.equal(s.state.messages.length, 0)
})

test('lease abandonado expira, não repete inferência e impede commit atrasado', async () => {
    const ia = provider(), s = stack(ia), uuid = randomUUID()
    const r = (await s.requests.reservar({ id_usuario: 3, id_chat: 7, requisicao_id: uuid,
        hash_pedido: createHash('sha256').update(JSON.stringify({ chat: 7, pergunta: 'Olá' })).digest('hex'),
        pergunta: 'Olá', dono_lease: randomUUID() })).requisicao
    s.state.now += 150001
    assert.equal((await s.service.consultar(3, uuid)).estado, 'expirada')
    await assert.rejects(s.requests.concluir(r, 'Resposta atrasada'), { statusCode: 409 })
    await assert.rejects(send(s, uuid), { code: 'REQUISICAO_EXPIRADA' })
    assert.equal(ia.calls, 0)
    assert.equal(s.state.messages.length, 0)
    await send(s)
    assert.equal(s.state.requests.length, 2)
})

test('timeout fica registrado e não autoriza repetição automática da solicitação', async () => {
    const s = stack(provider()), uuid = randomUUID()
    const timeout = AbortSignal.timeout
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException('Timeout', 'TimeoutError'))
    try { await assert.rejects(send(s, uuid), { code: 'IA_TIMEOUT', statusCode: 504 }) }
    finally { AbortSignal.timeout = timeout }
    assert.equal((await s.service.consultar(3, uuid)).estado, 'falhou')
    await assert.rejects(send(s, uuid), { code: 'IA_TIMEOUT' })
    assert.equal(s.state.messages.length, 0)
})

test('limites duráveis por usuário, por conversa e por concorrência entre conversas', async () => {
    const s = stack(provider())
    await send(s)
    await assert.rejects(send(s), { code: 'CHAT_LIMITE_CONVERSA', retryAfter: '5' })
    await send(s, randomUUID(), 8, 4)
    // Limite de 12/min: sem depender do IP nem de contadores em memória.
    for (let id = 20; id < 31; id++) {
        await s.db('tbl_chat').insert({ id, nome: 'Chat', id_usuario: 3, data_criacao: '2026-01-01' })
        await send(s, randomUUID(), id)
    }
    await assert.rejects(send(s, randomUUID(), 9), { code: 'CHAT_LIMITE_USUARIO', retryAfter: '60' })
    s.state.now += 60001
    for (const id of [7, 9]) await s.requests.reservar({ id_usuario: 3, id_chat: id, requisicao_id: randomUUID(),
        hash_pedido: 'hash', pergunta: 'Olá', dono_lease: randomUUID() })
    await assert.rejects(send(s, randomUUID(), 10), { code: 'CHAT_LIMITE_USUARIO' })
})

test('controller valida IDs e corpo antes de abrir SSE', async () => {
    const s = stack(provider())
    for (const [body, status] of [[{ id_chat: 7, pergunta: '' }, 400], [{ id_chat: true, pergunta: 'Olá' }, 400],
        [{ id_chat: 7, pergunta: 'x'.repeat(2001) }, 400], [{ id_chat: 999, pergunta: 'Olá' }, 404],
        [{ id_chat: 7, pergunta: 'Olá', requisicao_id: 'inválido' }, 400]]) {
        const res = response()
        await s.controller.enviarMensagemChat(req(body), res)
        assert.equal(res.statusCode, status)
        assert.equal(res.flushed, undefined)
    }
})

test('chat confirma criação e exclusão de simulações e metas com titularidade e idempotência', async (t) => {
    const s = stack()
    const ia = require('../src/services/aiChatService.js')
    s.sqlite.exec(`
        CREATE TABLE tbl_simulacao_investimento (id INTEGER PRIMARY KEY, id_usuario INTEGER, data_criacao TEXT,
            nome TEXT, descricao TEXT, valor_inicial REAL, aporte_mensal REAL, prazo INTEGER, rentabilidade REAL);
        CREATE TABLE tbl_simulacao_amortizacao (id INTEGER PRIMARY KEY, id_usuario INTEGER, data_criacao TEXT,
            nome TEXT, descricao TEXT, saldo_devedor REAL, aporte_mensal REAL, prazo INTEGER, taxa REAL, sistema_calculo TEXT, modalidade TEXT);
        CREATE TABLE tbl_meta_financeira (id INTEGER PRIMARY KEY, id_usuario INTEGER, nome TEXT, valor_inicio REAL,
            valor_desejado REAL, aporte_mensal REAL, data_alvo TEXT, id_categoria INTEGER, valor_total REAL, status INTEGER,
            descricao TEXT, id_conta_vinculada INTEGER);
        CREATE TABLE tbl_categoria_meta (id INTEGER PRIMARY KEY, id_usuario INTEGER, nome TEXT);
        INSERT INTO tbl_categoria_meta VALUES (1, NULL, 'Reserva'), (2, 4, 'Privada');
        INSERT INTO tbl_simulacao_investimento (id, id_usuario, nome) VALUES (100, 4, 'Outro titular');
    `)
    let proposta
    t.mock.method(ia, 'obterConfiguracaoPrivada', () => {})
    const inferencia = t.mock.method(ia, 'interpretarAcao', async () => ({
        versao: 1, intencao: proposta.acao, tipo: proposta.tipo,
        dados: Object.fromEntries(Object.entries(proposta.dados).map(([key, valor]) => [key, { valor, origem: 'usuario' }]))
    }))
    const conversar = async (texto, uuid = randomUUID(), chat = 7, usuario = 3) => {
        s.state.now += 6000
        const resposta = await send(s, uuid, chat, usuario, texto)
        return resposta.mensagem_assistente.conteudo
    }
    const confirmar = (texto) => texto.match(/confirmar ação [0-9a-f]{8}/)[0]

    proposta = { acao: 'excluir', tipo: 'investimento', dados: { id: 100 } }
    assert.match(await conversar('Excluir simulação de investimento 100'), /Não encontrei/)
    assert.equal(s.sqlite.prepare('SELECT id FROM tbl_simulacao_investimento WHERE id = 100').get().id, 100)

    for (const [tipo, tabela, dados] of [
        ['amortizacao', 'tbl_simulacao_amortizacao', { nome: 'SAC', saldo_devedor: 10000, prazo: 48,
            taxa: 12, aporte_mensal: 100, sistema_calculo: 'SAC', modalidade: 'REDUZIR_PRAZO' }],
        ['investimento', 'tbl_simulacao_investimento', { nome: 'Aporte', valor_inicial: 100,
            aporte_mensal: 50, prazo: 12, rentabilidade: 10 }],
        ['meta', 'tbl_meta_financeira', { nome: 'Reserva', valor_inicio: 100, valor_desejado: 1000,
            aporte_mensal: 50, data_alvo: '2040-11-10', categoria: 'Reserva' }]
    ]) {
        const pessoais = s.sqlite.prepare(`SELECT id FROM ${tabela} WHERE id_usuario = 3`)
        proposta = { acao: 'criar', tipo, dados }
        const resumo = await conversar(`Criar ${tipo} ${dados.nome}`)
        if (tipo === 'meta') assert.match(resumo, /Prazo.*longo/)
        const pendente = confirmar(resumo)
        assert.equal(pessoais.all().length, 0)
        if (tipo === 'amortizacao') {
            assert.match(await conversar(pendente, randomUUID(), 8, 4), /Não há um rascunho pronto/)
        }
        const uuid = randomUUID()
        assert.match(await conversar(pendente, uuid), /^Criei /)
        assert.match(await conversar(pendente, uuid), /^Criei /)
        const [registro] = pessoais.all()
        assert.ok(registro.id)
        assert.equal(pessoais.all().length, 1)
        if (tipo === 'meta') {
            const metas = require('./helpers/chatHarness.js').load('model/DAO/Metas/MetasDAO.js', { knex: () => s.db })
            assert.equal((await metas.GetAllMetasUsuario(3))[0].id, registro.id)
            assert.equal((await metas.GetAllMetasUsuario(4)).length, 0)
        } else if (tipo === 'amortizacao') {
            const amortizacoes = require('./helpers/chatHarness.js').load('model/DAO/Simulacoes/SimulacaoAmortizacaoDAO.js', { knex: () => s.db })
            const lista = await amortizacoes.listarSimulacoesAmortizacao(3, { pagina: 1, tamanho: 20 })
            assert.equal(lista[0].id, registro.id)
        }
        proposta = { acao: 'excluir', tipo, dados: { nome: dados.nome } }
        const excluir = confirmar(await conversar(`Excluir ${tipo} ${dados.nome}`))
        assert.equal(pessoais.all().length, 1)
        assert.match(await conversar(excluir), /^Excluí /)
        assert.equal(pessoais.all().length, 0)
        // Mantém o teste independente da janela de 12 solicitações/minuto.
        s.state.now += 60_000
    }
    assert.equal(inferencia.mock.callCount(), 7)
})

test('rascunho assistido preserva dados, aceita sugestões e edições, recupera falhas e salva nas fontes das abas', async (t) => {
    const s = stack(provider())
    const ia = require('../src/services/aiChatService.js')
    const { load } = require('./helpers/chatHarness.js')
    const usuario = 3
    t.after(() => s.sqlite.close())
    s.sqlite.exec(`
        CREATE TABLE tbl_simulacao_investimento (id INTEGER PRIMARY KEY, id_usuario INTEGER, data_criacao TEXT,
            nome TEXT, descricao TEXT, valor_inicial REAL, aporte_mensal REAL, prazo INTEGER, rentabilidade REAL);
        CREATE TABLE tbl_alerta_gasto_ia (id INTEGER PRIMARY KEY, id_usuario INTEGER, chave TEXT, mes TEXT, categoria TEXT,
            titulo TEXT, mensagem TEXT, acao TEXT, area TEXT, expira_ms INTEGER, UNIQUE (id_usuario, chave));
    `)
    const estruturar = (intencao, tipo, campos = {}, sugeridos = []) => ({
        versao: 1, intencao, tipo,
        dados: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor,
            origem: sugeridos.includes(k) ? 'ia' : 'usuario' }]))
    })
    const propostas = new Map([
        ['Como funciona uma simulação?', { versao: 1, intencao: 'orientacao' }],
        ['Simule um investimento mensal de R$ 150', estruturar('propor', 'investimento', { aporte_mensal: 150 })],
        ['Você pode sugerir os outros dados?', estruturar('editar', 'investimento',
            { nome: 'Cenário mensal', valor_inicial: 0, prazo: 24, rentabilidade: 8, aporte_mensal: 300 },
            ['nome', 'valor_inicial', 'prazo', 'rentabilidade', 'aporte_mensal'])],
        ['Mude para R$ 200 por mês', estruturar('editar', 'investimento', { aporte_mensal: 200 })],
        ['Troque o prazo para menos seis meses', estruturar('editar', 'investimento', { prazo: -6 })],
        ['Mantenha 24 meses', estruturar('editar', 'investimento', { prazo: 24 })],
        ['Me sugira um plano para reduzir gastos', estruturar('propor', 'recomendacao', {
            titulo: 'Revisar gastos recorrentes', mensagem: 'Revise suas assinaturas semanalmente.', area: 'nucleo'
        }, ['titulo', 'mensagem', 'area'])]
    ])
    t.mock.method(ia, 'interpretarAcao', async ({ mensagem, rascunho }) => {
        if (mensagem === 'Você pode sugerir os outros dados?') assert.equal(rascunho.dados.aporte_mensal, 150)
        if (mensagem === 'Tente outro prazo') throw new DOMException('timeout', 'TimeoutError')
        return propostas.get(mensagem) ?? { versao: 2, intencao: 'editar' }
    })
    const perguntar = async (texto, uuid = randomUUID(), chat = 7, user = usuario) => {
        s.state.now += 6001
        const resultado = await send(s, uuid, chat, user, texto)
        return resultado.mensagem_assistente.conteudo
    }
    const codigo = (texto) => texto.match(/confirmar ação [0-9a-f]{8}/)[0]
    const historico = load('model/DAO/Simulacoes/SimulacaoInvestimentoDAO.js', { knex: () => s.db })
    const listarInvestimentos = () => historico.listarSimulacoesInvestimento(usuario, { pagina: 1, tamanho: 20 })
    assert.equal(await perguntar('Como funciona uma simulação?'), 'Resposta 🌎')
    assert.match(await perguntar('Simule um investimento mensal de R$ 150'), /150,00/)
    assert.match(await perguntar('Tente outro prazo'), /preservados/)
    assert.match(await perguntar('Texto que gera resposta inválida'), /preservados/)
    const sugerido = await perguntar('Você pode sugerir os outros dados?')
    assert.match(sugerido, /150,00/)
    assert.doesNotMatch(sugerido, /300,00/)
    assert.match(sugerido, /sugerido pela IA/)
    const antes = codigo(sugerido)
    const editado = await perguntar('Mude para R$ 200 por mês')
    assert.match(editado, /200,00/)
    assert.match(await perguntar(antes), /Não há um rascunho pronto/)
    assert.match(await perguntar(codigo(editado), randomUUID(), 8, 4), /Não há um rascunho pronto/)
    assert.match(await perguntar('Troque o prazo para menos seis meses'), /precisa de revisão/)
    assert.match(await perguntar('confirmo'), /Não há um rascunho pronto/)
    const pronto = codigo(await perguntar('Mantenha 24 meses'))
    assert.equal((await listarInvestimentos()).length, 0)
    s.sqlite.exec(`CREATE TRIGGER falhar_acao BEFORE INSERT ON tbl_simulacao_investimento BEGIN SELECT RAISE(ABORT, 'falha'); END`)
    await assert.rejects(perguntar(pronto), { code: 'CHAT_ACAO_INDISPONIVEL' })
    assert.equal((await listarInvestimentos()).length, 0)
    s.sqlite.exec('DROP TRIGGER falhar_acao')
    s.state.now += 60_000
    const confirmacao = randomUUID()
    assert.match(await perguntar(pronto, confirmacao), /Simulações → Investimentos/)
    assert.match(await perguntar(pronto, confirmacao), /Simulações → Investimentos/)
    assert.match(await perguntar(pronto), /Não há um rascunho pronto/)
    assert.equal((await listarInvestimentos())[0].aporte_mensal, 200)
    assert.equal((await listarInvestimentos()).length, 1)

    assert.match(await perguntar('Me sugira um plano para reduzir gastos'), /sugerido pela IA/)
    assert.match(await perguntar('Cancelar rascunho'), /cancelado/)
    assert.match(await perguntar('pode salvar'), /Não há um rascunho pronto/)
    assert.match(await perguntar('Me sugira um plano para reduzir gastos'), /Revise suas assinaturas/)
    assert.match(await perguntar('pode salvar'), /Recomendações/)

    const rota = load('src/routes/financialRecommendationsRoutes.js', { '../../model/Database_config_knex/connection.js': s.db })
    const consultarHistorico = async (id) => {
        const handler = rota.stack.find((layer) => layer.route?.path === '/historico').route.stack[0].handle
        let corpo
        await handler({ query: {}, usuario: { id } }, { json: (dados) => { corpo = dados } })
        return corpo.recomendacoes
    }
    assert.equal((await consultarHistorico(usuario))[0].titulo, 'Revisar gastos recorrentes')
    assert.equal((await consultarHistorico(4)).length, 0)
})
