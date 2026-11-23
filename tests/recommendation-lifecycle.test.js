const { test } = require('node:test')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { runInNewContext } = require('node:vm')
const base = resolve(__dirname, '..')
const { database } = require('./helpers/chatDatabase.js')

function load(file, mocks, globals) {
    const path = resolve(base, file)
    const requireFrom = createRequire(path)
    const module = { exports: {} }
    runInNewContext(readFileSync(path, 'utf8'), {
        ...globals, module, AbortSignal,
        require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : requireFrom(name),
    }, { filename: path })
    return module.exports
}

test('posição sem alteração de quantidade gera um único alerta e migra para histórico em 12h', async () => {
    const { db, sqlite } = database()
    sqlite.exec(`
        CREATE TABLE tbl_conexao_open_finance (id INTEGER PRIMARY KEY, id_usuario INTEGER, status INTEGER, provedor TEXT, external_connection_id TEXT);
        INSERT INTO tbl_conexao_open_finance VALUES(1,3,1,'pluggy','item'),(2,4,1,'pluggy','outro');
        CREATE TABLE tbl_alerta_gasto_ia (id INTEGER PRIMARY KEY, id_usuario INTEGER, chave TEXT, mes TEXT, categoria TEXT, titulo TEXT,
            mensagem TEXT, acao TEXT, dispensada_em TEXT, area TEXT, expira_ms INTEGER, UNIQUE(id_usuario,chave));
        CREATE TABLE tbl_posicao_recomendacao_ia (id_usuario INTEGER, posicao TEXT, quantidade REAL,
            valor_centavos INTEGER, referencia_ms INTEGER, PRIMARY KEY(id_usuario,posicao));
    `)
    const connection = await db.client.acquireConnection()
    const query = connection.query
    connection.query = (statement, values, callback) => query({
        ...statement, sql: statement.sql.replace(/^insert ignore into/i, 'INSERT OR IGNORE INTO'),
    }, values, callback)
    let clock = Date.parse('2026-11-20T12:00:00Z')
    class TestDate extends Date { static now() { return clock } }
    const asset = { id: 'posicao', codigo: 'TEST3', tipo: 'SECURITY', moeda: 'BRL', quantidade: 10, valor: 1000 }
    const second = { ...asset, id: 'posicao-2', codigo: 'TEST4' }
    let aiCalls = 0
    const service = load('src/services/investmentRecommendationService.js', {
        '../../model/Database_config_knex/connection.js': db,
        './pluggyService.js': {
            validarItemDoUsuario: async () => ({ atualizadoEm: new Date(clock).toISOString() }),
            listarInvestimentos: async () => ({ investimentos: [asset, second] }),
        },
    }, { Date: TestDate, fetch: async (_url, options) => {
        aiCalls++
        const body = JSON.parse(options.body)
        assert.equal(body.tipo, 'queda_posicao')
        assert.equal(body.simbolo, 'TEST3')
        assert.equal(body.anteriorCentavos, 100000)
        assert.equal(body.atualCentavos, 90000)
        assert.equal(body.comparacao.anterior.quantidade, body.comparacao.atual.quantidade)
        return Response.json({ versao: 1, recomendacao: { acao: 'revisar_investimento', mensagem: 'A posição caiu 10%.' } })
    } })
    const scan = () => service.analyzeInvestments(3, ['item'], new Date(clock), 'https://worker.test', 'test')
    await scan()
    clock += 3600000
    asset.valor = 900
    second.valor = 1100
    await scan()
    await scan()
    assert.equal(aiCalls, 1)
    const router = load('src/routes/financialRecommendationsRoutes.js', {
        '../../model/Database_config_knex/connection.js': db,
        '../services/financialRecommendationsService.js': {
            table: 'tbl_alerta_gasto_ia',
            connections: 'tbl_conexao_open_finance',
            active: (builder) => builder.where({ status: 1, provedor: 'pluggy' }),
        },
    }, { Date: TestDate })
    async function get(path, user, area) {
        const handler = router.stack.find(layer => layer.route?.path === path).route.stack[0].handle
        let status = 200
        let result
        const res = { status(code) { status = code; return this }, json(body) { result = body } }
        await handler({ usuario: { id: user }, query: area ? { area } : {} }, res)
        assert.equal(status, 200, JSON.stringify(result))
        return result.recomendacoes
    }
    assert.equal((await get('/pendente', 3, 'investimentos')).length, 1)
    assert.equal((await get('/pendente', 3, 'nucleo')).length, 0)
    assert.equal((await get('/pendente', 4, 'investimentos')).length, 0)
    sqlite.prepare(`INSERT INTO tbl_alerta_gasto_ia (id_usuario, chave, titulo, area, expira_ms) VALUES (?, ?, ?, ?, ?)`)
        .run(3, 'nucleo', 'Outro destaque', 'nucleo', clock + 24 * 3600000)
    assert.equal((await get('/pendente', 3, 'nucleo'))[0].titulo, 'Outro destaque')
    assert.equal((await get('/pendente', 3, 'investimentos')).length, 1)
    assert.equal((await get('/historico', 3)).length, 0)
    clock += 12 * 3600000 - 1
    assert.equal((await get('/pendente', 3, 'investimentos')).length, 1)
    clock++
    assert.equal((await get('/pendente', 3, 'investimentos')).length, 0)
    assert.equal((await get('/historico', 3))[0].titulo, 'Queda na posição de TEST3')
    assert.equal((await get('/historico', 4)).length, 0)
    sqlite.close()
})
