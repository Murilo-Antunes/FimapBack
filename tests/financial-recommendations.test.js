const { test } = require('node:test')
const assert = require('node:assert/strict')
const { database } = require('./helpers/chatDatabase.js')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { resolve } = require('node:path')
const { runInNewContext } = require('node:vm')
function load(file, mocks, { fetch }) {
    const path = resolve(__dirname, '..', file)
    const localRequire = createRequire(path)
    const module = { exports: {} }
    runInNewContext(readFileSync(path, 'utf8'), {
        module, fetch, AbortSignal, Date,
        require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    }, { filename: path })
    return module.exports
}

test('analisa totais comparáveis da Pluggy, grava uma vez e omite histórico parcial', async () => {
    const { db, sqlite } = database()
    sqlite.exec(`
        CREATE TABLE tbl_conexao_open_finance (id INTEGER PRIMARY KEY, id_usuario INTEGER, status INTEGER, provedor TEXT, external_connection_id TEXT);
        INSERT INTO tbl_conexao_open_finance VALUES(1,3,1,'pluggy','item');
        CREATE TABLE tbl_alerta_gasto_ia (id INTEGER PRIMARY KEY, id_usuario INTEGER, chave TEXT, mes TEXT, categoria TEXT, titulo TEXT,
            mensagem TEXT, acao TEXT, dispensada_em TEXT, area TEXT, expira_ms INTEGER, UNIQUE(id_usuario,chave));
    `)
    const acquire = db.client.acquireConnection
    const connection = await acquire.call(db.client)
    const query = connection.query
    connection.query = (statement, values, callback) => query({
        ...statement, sql: statement.sql.replace(/^insert ignore into/i, 'INSERT OR IGNORE INTO'),
    }, values, callback)
    const tx = (id, data, valor, status = 'POSTED') => ({
        id, contaId: 'conta', data, valor, categoria: 'Delivery', status, moeda: 'BRL',
    })
    let parcial = true
    let calls = 0
    const fetch = async (_url, options) => {
        calls++
        const { categorias, diasObservados } = JSON.parse(options.body)
        assert.equal(diasObservados, 15)
        assert.equal(categorias.length, 1)
        const [category] = categorias
        assert.equal(category.atualCentavos, 50_000)
        assert.deepEqual(category.historicoCentavos, [40_000, 40_000, null])
        assert.equal(JSON.stringify(options.body).includes('Delivery'), false)
        return Response.json({ versao: 1, recomendacao: {
            chave: `aumento-gastos:2026-11:${category.id}`, categoriaId: category.id,
            acao: 'revisar_gastos', mensagem: 'Mudança nos gastos.',
        } })
    }
    try {
        const service = load('src/services/financialRecommendationsService.js', {
            '../../model/Database_config_knex/connection.js': db,
            './pluggyService.js': {
                validarItemDoUsuario: async (_item, user) => {
                    assert.equal(user, 3)
                    return { atualizadoEm: '2026-11-16T12:00:00Z' }
                },
                listarContas: async () => ({ contas: [{ id: 'conta', tipo: 'BANK' }] }),
                listarTransacoes: async () => ({ parcial, transacoes: [
                    tx('a', '2026-09-01', -400), tx('b', '2026-10-08', -400),
                    tx('c', '2026-11-15', -500), tx('c', '2026-11-15', -500),
                    tx('d', '2026-11-16', -700), tx('e', '2026-11-15', -900, 'PENDING'),
                ] }),
            },
        }, { fetch })
        const now = new Date('2026-11-16T15:00:00Z')
        const run = () => service.analyze(3, service.period(now), now, 'https://worker.test', 'test')
        await run()
        assert.equal(calls, 0)
        parcial = false
        await run()
        await run()
        assert.equal(calls, 1)
        const records = sqlite.prepare('SELECT id_usuario, titulo, acao FROM tbl_alerta_gasto_ia').all()
        assert.deepEqual(records.map((row) => ({ ...row })), [
            { id_usuario: 3, titulo: 'Aumento de gastos: Delivery', acao: 'revisar_gastos' },
        ])
    } finally {
        sqlite.close()
    }
})

test('reconhece reajuste mensal de academia de madrugada e rejeita cobranças duplicadas', () => {
    const { recurringCharges, period } = require('../src/services/financialRecommendationsService.js')
    const window = period(new Date('2026-11-08T04:00:00Z'))
    const payment = (id, data, valor, status = 'POSTED') => ({
        id, contaId: 'conta', data, valor, status, moeda: 'BRL', descricao: 'Academia do Bairro',
    })
    const samples = [
        payment('1', '2026-09-08', -100),
        payment('2', '2026-10-08', -100),
        payment('3', '2026-11-08', -94),
        payment('3', '2026-11-08', -94),
        payment('4', '2026-11-08', -80, 'PENDING'),
    ]
    const [change] = recurringCharges(samples, window)
    assert.equal(change.servico, 'academia')
    assert.equal(change.anteriorCentavos, 10000)
    assert.equal(change.atualCentavos, 9400)
    assert.equal(change.referenciaAtualEm, '2026-11-08T00:00:00.000Z')
    assert.equal(Object.values(change).includes('Academia do Bairro'), false)
    assert.deepEqual(recurringCharges([...samples, payment('5', '2026-11-08', -80)], window), [])
})
