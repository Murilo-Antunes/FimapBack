// Testa as gravações do chat em um MySQL de teste.
// Opt-in: usa SOMENTE um schema temporário criado pelo próprio teste.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const knex = require('knex')
const { load } = require('./helpers/chatHarness.js')
const migration = require('../db/migrations/202611170001_chat_requisicoes.js')
const migrationAcoes = require('../db/migrations/202611230001_chat_acoes.js')

test('MySQL/InnoDB: migração, duas conexões, constraints, fencing e rollback real', {
    skip: !process.env.CHAT_TEST_MYSQL_URL && 'Defina CHAT_TEST_MYSQL_URL para um servidor MySQL descartável.'
}, async () => {
    const mysql = require('mysql2/promise')
    const url = new URL(process.env.CHAT_TEST_MYSQL_URL)
    const connection = { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
    const admin = await mysql.createConnection(connection)
    const schema = 'fimap_chat_test_' + randomUUID().replaceAll('-', '')
    let db, other
    try {
        await admin.query('CREATE DATABASE `' + schema + '` CHARACTER SET utf8mb4')
        db = knex({ client: 'mysql2', connection: { ...connection, database: schema } })
        other = knex({ client: 'mysql2', connection: { ...connection, database: schema } })
        await db.raw('CREATE TABLE tbl_usuario(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB')
        await db.raw('CREATE TABLE tbl_chat(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL, FOREIGN KEY(id_usuario) REFERENCES tbl_usuario(id)) ENGINE=InnoDB')
        await db.raw('CREATE TABLE tbl_mensagem(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, id_chat INT, conteudo TEXT, papel INT, data_envio DATETIME) ENGINE=InnoDB')
        await migration.up(db)
        await migrationAcoes.up(db)
        await db('tbl_usuario').insert([{ id: 3 }, { id: 4 }])
        await db('tbl_chat').insert([{ id: 7, id_usuario: 3 }, { id: 8, id_usuario: 4 }])
        const dao = (pool) => load('model/DAO/MensagemChat/RequisicaoChatDAO.js', { '../../Database_config_knex/connection.js': pool })
        const a = dao(db), b = dao(other)
        const pedido = { id_usuario: 3, id_chat: 7, requisicao_id: randomUUID(), hash_pedido: 'hash', pergunta: 'Olá', dono_lease: randomUUID() }
        const [r1, r2] = await Promise.all([a.reservar(pedido), b.reservar({ ...pedido, dono_lease: randomUUID() })])
        assert.equal([r1, r2].filter((r) => r.nova).length, 1)
        const r = (r1.nova ? r1 : r2).requisicao
        await assert.rejects(b.reservar({ ...pedido, requisicao_id: randomUUID() }), { code: 'CHAT_EM_ANDAMENTO' })
        await assert.rejects(db('tbl_chat_requisicao').insert({ ...pedido, requisicao_id: randomUUID(), estado: 'gerando', chat_ativo: 7, lease_ate_ms: Date.now() + 150000, criada_ms: Date.now() }), { code: 'ER_DUP_ENTRY' })
        await assert.rejects(db('tbl_chat_requisicao').insert({ ...pedido, estado: 'falhou', lease_ate_ms: Date.now(), criada_ms: Date.now() }), { code: 'ER_DUP_ENTRY' })
        await db.raw("CREATE TRIGGER falhar_resposta BEFORE INSERT ON tbl_mensagem FOR EACH ROW BEGIN IF NEW.papel = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha controlada'; END IF; END")
        await assert.rejects(a.concluir(r, 'Resposta'))
        assert.equal(Number((await db('tbl_mensagem').count('* as total'))[0].total), 0)
        assert.equal((await a.consultar(3, pedido.requisicao_id)).estado, 'gerando')
        await db.raw('DROP TRIGGER falhar_resposta')
        const concluida = await b.concluir(r, 'Resposta')
        assert.equal(concluida.estado, 'concluida')
        assert.equal((await a.resultado(concluida)).mensagem_assistente.conteudo, 'Resposta')
        assert.equal((await a.reservar(pedido)).nova, false)
        await assert.rejects(a.consultar(4, pedido.requisicao_id), { statusCode: 404 })
        // Processo abandonado e lease vencido; nunca autoriza o dono antigo a confirmar.
        await db('tbl_chat_requisicao').where('id', r.id).update({ criada_ms: Date.now() - 10000 })
        const abandonada = (await b.reservar({ ...pedido, requisicao_id: randomUUID() })).requisicao
        await db('tbl_chat_requisicao').where('id', abandonada.id).update({ lease_ate_ms: 0 })
        assert.equal((await a.consultar(3, abandonada.requisicao_id)).estado, 'expirada')
        await assert.rejects(b.concluir(abandonada, 'Tardia'), { statusCode: 409 })

        await db.raw('CREATE TABLE tbl_simulacao_investimento(id INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT, nome VARCHAR(45), descricao TEXT, valor_inicial DECIMAL(15,2), aporte_mensal DECIMAL(15,2), prazo INT, rentabilidade DECIMAL(5,2), data_criacao DATETIME) ENGINE=InnoDB')
        const acao = randomUUID()
        const dados = { valor_inicial: 123.45, aporte_mensal: 22, prazo: 12, rentabilidade: 0 }
        const valores = { nome: 'Investimento', ...dados }
        const cartao = { id: acao, versao: 1, tipo: 'investimento', status: 'pronta', nome: valores.nome,
            dados, premissas: [], pendencias: [] }
        await db('tbl_chat_requisicao').where('id', abandonada.id).update({ criada_ms: Date.now() - 10000 })
        const pedidoAcao = (await a.reservar({ ...pedido, requisicao_id: randomUUID() })).requisicao
        await a.concluir(pedidoAcao, 'Proposta', [{ valores, cartao, hoje: '2026-11-23', origens: {}, premissas: {} }])
        const acoes = require('../model/DAO/MensagemChat/AcaoChatDAO.js')
        await db.raw("CREATE TRIGGER falhar_confirmacao BEFORE UPDATE ON tbl_chat_acao_v2 FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha controlada'")
        await assert.rejects(acoes.confirmar(3, 7, acao, 1, db))
        assert.equal((await db('tbl_simulacao_investimento')).length, 0)
        await db.raw('DROP TRIGGER falhar_confirmacao')
        const confirmacoes = await Promise.all([
            acoes.confirmar(3, 7, acao, 1, db), acoes.confirmar(3, 7, acao, 1, other)
        ])
        assert.deepEqual(confirmacoes[0], confirmacoes[1])
        assert.equal(confirmacoes[0].status, 'salva')
        assert.equal(confirmacoes[0].dados.valor_inicial, 123.45)
        assert.equal((await db('tbl_simulacao_investimento')).length, 1)
        assert.equal((await b.resultado(await b.consultar(3, pedidoAcao.requisicao_id))).mensagem_assistente.acoes_financeiras[0].status, 'salva')

        await db('tbl_chat_requisicao').where('id', pedidoAcao.id).update({ criada_ms: Date.now() - 10000 })
        const concorrente = { valores, cartao: { ...cartao, id: randomUUID() }, hoje: '2026-11-23', origens: {}, premissas: {} }
        const pedidoConcorrente = (await a.reservar({ ...pedido, requisicao_id: randomUUID() })).requisicao
        await a.concluir(pedidoConcorrente, 'Proposta inicial', [concorrente])
        await db('tbl_chat_requisicao').where('id', pedidoConcorrente.id).update({ criada_ms: Date.now() - 10000 })
        const pedidoRevisao = (await a.reservar({ ...pedido, requisicao_id: randomUUID() })).requisicao
        const revisada = { ...concorrente, cartao: { ...concorrente.cartao, versao: 2 } }
        const [confirmacao, conclusao] = await Promise.allSettled([
            acoes.confirmar(3, 7, concorrente.cartao.id, 1, db),
            b.concluir(pedidoRevisao, 'Revisão concorrente', [revisada])
        ])
        assert.equal(conclusao.status, 'fulfilled')
        const final = (await b.resultado(conclusao.value)).mensagem_assistente.acoes_financeiras
        if (confirmacao.status === 'fulfilled') assert.equal(final, undefined)
        else {
            assert.equal(confirmacao.reason.code, 'ACAO_VERSAO_DESATUALIZADA')
            assert.equal(final[0].versao, 2)
            await acoes.confirmar(3, 7, concorrente.cartao.id, 2, other)
        }
        assert.equal((await db('tbl_simulacao_investimento')).length, 2)
    } finally {
        if (db) await db.destroy()
        if (other) await other.destroy()
        await admin.query('DROP DATABASE IF EXISTS `' + schema + '`')
        await admin.end()
    }
})
