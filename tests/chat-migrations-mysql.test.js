// Testa a troca de tabelas do chat com bancos MySQL descartáveis.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { readdirSync } = require('node:fs')
const { resolve } = require('node:path')
const knex = require('knex')
const mysql = require('mysql2/promise')
const acoes = require('../model/DAO/MensagemChat/AcaoChatDAO.js')

const directory = resolve(__dirname, '../db/migrations')
const arquivos = readdirSync(directory).filter((nome) => nome.endsWith('.js')).sort()
const compat = '202611230000_chat_acoes_compat.js'
const v1 = '202611230002_chat_acoes.js'
const v2 = '202611230001_chat_acoes.js'
const base = arquivos.filter((nome) => nome < compat)

const headAntigo = `CREATE TABLE tbl_chat_acao (
    id VARCHAR(36) NOT NULL PRIMARY KEY, id_chat INT NOT NULL, tipo ENUM('meta','investimento','amortizacao') NOT NULL,
    versao INT NOT NULL, id_registro INT NULL
) ENGINE=InnoDB`
const versoesAntigas = `CREATE TABLE tbl_chat_acao_versao (
    id_acao VARCHAR(36) NOT NULL, versao INT NOT NULL, id_mensagem INT NOT NULL,
    payload JSON NOT NULL, PRIMARY KEY (id_acao, versao)
) ENGINE=InnoDB`
const legadoAntigo = `CREATE TABLE tbl_chat_acao (
    id_chat INT NOT NULL PRIMARY KEY, codigo VARCHAR(8) NOT NULL, proposta TEXT NOT NULL, expira_ms BIGINT NOT NULL
) ENGINE=InnoDB`
const historicoV1 = (db) => db.raw(legadoAntigo.replace(
    'expira_ms BIGINT NOT NULL', 'expira_ms BIGINT NOT NULL, FOREIGN KEY (id_chat) REFERENCES tbl_chat(id) ON DELETE CASCADE'
))
async function historicoV2(db) {
    await db.raw(headAntigo.replace('id_registro INT NULL', 'id_registro INT NULL, UNIQUE (tipo,id_registro), FOREIGN KEY (id_chat) REFERENCES tbl_chat(id) ON DELETE CASCADE'))
    await db.raw(versoesAntigas.replace('PRIMARY KEY (id_acao, versao)', `PRIMARY KEY (id_acao, versao),
        FOREIGN KEY (id_acao) REFERENCES tbl_chat_acao(id) ON DELETE CASCADE,
        FOREIGN KEY (id_mensagem) REFERENCES tbl_mensagem(id) ON DELETE CASCADE`))
}

function migracoesHistoricas(nomes) {
    return { migrationSource: {
        getMigrations: async () => nomes,
        getMigrationName: (nome) => nome,
        getMigration: (nome) => nome === v1 ? { up: historicoV1, down: (db) => db.schema.dropTable('tbl_chat_acao') } :
            nome === v2 ? { up: historicoV2, down: async (db) => {
                await db.schema.dropTable('tbl_chat_acao_versao')
                await db.schema.dropTable('tbl_chat_acao')
            } } :
            require(resolve(directory, nome))
    } }
}

async function montarBase(db) {
    await db.raw('CREATE TABLE tbl_usuario (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB')
    await db.raw('CREATE TABLE tbl_chat (id INT NOT NULL PRIMARY KEY, id_usuario INT NOT NULL, FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id)) ENGINE=InnoDB')
    await db.raw('CREATE TABLE tbl_mensagem (id INT NOT NULL PRIMARY KEY, papel INT NOT NULL, id_chat INT NOT NULL, FOREIGN KEY (id_chat) REFERENCES tbl_chat(id) ON DELETE CASCADE) ENGINE=InnoDB')
    await db.raw('CREATE TABLE tbl_conexao_open_finance (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB')
    await db.raw(`CREATE TABLE tbl_simulacao_investimento (
        id INT PRIMARY KEY AUTO_INCREMENT, id_usuario INT, nome VARCHAR(45), descricao TEXT, valor_inicial DECIMAL(15,2),
        aporte_mensal DECIMAL(15,2), prazo INT, rentabilidade DECIMAL(5,2), data_criacao DATETIME
    ) ENGINE=InnoDB`)
    await db('tbl_usuario').insert([{ id: 3 }, { id: 4 }])
    await db('tbl_chat').insert([{ id: 7, id_usuario: 3 }, { id: 8, id_usuario: 4 }])
    await db('tbl_mensagem').insert([701, 702, 703].map((id) => ({ id, id_chat: 7, papel: 2 })))
}

const rascunhoV1 = { id_chat: 7, codigo: 'a1b2c3d4', proposta: '{"tipo":"meta","dados":{"nome":"Rascunho anterior"}}',
    expira_ms: Date.UTC(2028, 0, 1) }

function proposta() {
    const dados = { valor_inicial: 800.05, aporte_mensal: 150, prazo: 12, rentabilidade: 0 }
    const nome = 'Simulação de teste'
    const cartao = { id: randomUUID(), tipo: 'investimento', versao: 1, status: 'pronta', nome, dados, premissas: [], pendencias: [] }
    return { cartao, valores: { nome, ...dados }, origens: {}, premissas: {}, hoje: '2026-11-23' }
}

test('MySQL: transição real do Knex com os históricos das duas branches e DDL interrompido', {
    skip: !process.env.CHAT_TEST_MYSQL_URL && 'Use uma instância MySQL descartável em CHAT_TEST_MYSQL_URL.'
}, async (t) => {
    const url = new URL(process.env.CHAT_TEST_MYSQL_URL)
    const connection = { host: url.hostname, port: Number(url.port || 3306),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
    const admin = await mysql.createConnection(connection)
    t.after(() => admin.end())
    for (const estado of ['limpo', 'V1 aplicado', 'V2 aplicado', 'V2 apenas cabeçalho',
        'V2 parcial sem restrições', 'V1 parcial sem histórico']) {
        await t.test(estado, async () => {
            const schema = 'fimap_chat_transition_' + randomUUID().replaceAll('-', '')
            await admin.query('CREATE DATABASE `' + schema + '` CHARACTER SET utf8mb4')
            const db = knex({ client: 'mysql2', connection: { ...connection, database: schema } })
            try {
                await montarBase(db)
                let preservada
                if (estado === 'V1 aplicado') {
                    await db.migrate.latest(migracoesHistoricas(arquivos.filter((nome) => nome !== compat && nome !== v2)))
                    await db('tbl_chat_acao').insert(rascunhoV1)
                }
                if (estado === 'V1 parcial sem histórico') {
                    await db.migrate.latest(migracoesHistoricas(base))
                    await db.raw(legadoAntigo)
                    await db('tbl_chat_acao').insert(rascunhoV1)
                }
                if (estado === 'V2 apenas cabeçalho') {
                    await db.migrate.latest(migracoesHistoricas(base))
                    await db.raw(headAntigo)
                }
                if (estado === 'V2 aplicado' || estado === 'V2 parcial sem restrições') {
                    await db.migrate.latest(migracoesHistoricas(estado === 'V2 aplicado' ? [...base, v2] : base))
                    if (estado !== 'V2 aplicado') {
                        await db.raw(headAntigo)
                        await db.raw(versoesAntigas)
                    }
                    preservada = proposta()
                    await db('tbl_simulacao_investimento').insert({ id: 40, id_usuario: 3, ...preservada.valores })
                    await db('tbl_chat_acao').insert({ id: preservada.cartao.id, id_chat: 7,
                        tipo: 'investimento', versao: 2, id_registro: 40 })
                    await db('tbl_chat_acao_versao').insert([1, 2].map((versao) => ({
                        id_acao: preservada.cartao.id, versao, id_mensagem: 700 + versao,
                        payload: JSON.stringify({ ...preservada, cartao: { ...preservada.cartao, versao } })
                    })))
                }
                const havia = await db.schema.hasTable('knex_migrations')
                    ? await db('knex_migrations').select('name', 'batch').orderBy('id') : []
                await db.migrate.latest({ directory })
                const registro = await db('knex_migrations').select('name', 'batch').orderBy('id')
                assert.deepEqual(registro.slice(0, havia.length), havia)
                assert.deepEqual(registro.map(({ name }) => name).sort(), arquivos)
                if (estado === 'limpo') assert.ok(registro.findIndex((r) => r.name === compat) < registro.findIndex((r) => r.name === v1))
                assert.deepEqual((await db.migrate.latest({ directory }))[1], [])
                assert.equal(await db.schema.hasTable('tbl_chat_acao_versao'), false)
                assert.equal((await db('tbl_chat')).length, 2)
                assert.equal((await db('tbl_mensagem')).length, 3)
                const legado = await db('tbl_chat_acao').first()
                assert.deepEqual(legado, estado.startsWith('V1') ? rascunhoV1 : undefined)
                assert.equal((await db('tbl_chat_acao_v2')).length, preservada ? 1 : 0)
                if (preservada) {
                    const mensagens = [{ id: 701, papel: 2 }, { id: 702, papel: 2 }]
                    await acoes.anexar(7, mensagens, db)
                    assert.deepEqual(mensagens[0].acoes_financeiras, [preservada.cartao])
                    assert.deepEqual(mensagens[1].acoes_financeiras, [{ ...preservada.cartao, versao: 2, status: 'salva', id_registro: 40 }])
                    assert.equal((await acoes.confirmar(3, 7, preservada.cartao.id, 2, db)).id_registro, 40)
                    assert.equal((await db('tbl_simulacao_investimento')).length, 1)
                }

                const nova = proposta()
                await db.transaction((trx) => acoes.registrar(trx, 7, 703, [nova]))
                const salvo = await acoes.confirmar(3, 7, nova.cartao.id, 1, db)
                assert.equal(salvo.status, 'salva')
                assert.deepEqual(await acoes.confirmar(3, 7, nova.cartao.id, 1, db), salvo)
                const mensagens = [{ id: 703, papel: 2 }]
                await acoes.anexar(7, mensagens, db)
                assert.deepEqual(mensagens[0].acoes_financeiras, [salvo])
                await assert.rejects(db('tbl_chat_acao_v2').insert({
                    id: randomUUID(), tipo: 'investimento', id_chat: 7, versao: 1, id_registro: salvo.id_registro
                }), { code: 'ER_DUP_ENTRY' })
                await db('tbl_chat').where('id', 7).del()
                assert.equal((await db('tbl_chat_acao_v2_versao')).length, 0)
                assert.equal((await db('tbl_chat_acao_v2')).length, 0)
                assert.equal((await db('tbl_chat_acao')).length, 0)
                assert.equal((await db('tbl_simulacao_investimento')).length, preservada ? 2 : 1)
            } finally {
                await db.destroy()
                await admin.query('DROP DATABASE `' + schema + '`')
            }
        })
    }
})
