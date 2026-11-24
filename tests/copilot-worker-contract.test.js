// Compara os pedidos do backend com o Worker real, usando respostas simuladas.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { join, resolve, posix } = require('node:path')
const { createRequire } = require('node:module')
const { randomUUID } = require('node:crypto')
const { prepararPayload } = require('../src/services/planningWorker.js')

const repositorio = process.env.CHAT_TEST_WORKER_REPO
const commit = '789b2c33ec44e554df17d5f952166746f0c1e641'

test('Worker 789b2c3 aceita ambas as chamadas V2 para uma revisão de categoria', {
    skip: !repositorio && 'Informe CHAT_TEST_WORKER_REPO com um clone de IA-Fimap e o esbuild instalado.'
}, async () => {
    const repo = resolve(repositorio).replaceAll('\\', '/')
    const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + repo, '-C', repo, ...args], { encoding: 'utf8' })
    const arquivos = new Set(git('ls-tree', '-r', '--name-only', commit, 'src', 'shared').trim().split(/\r?\n/))
    const { build } = createRequire(join(repo, 'package.json'))('esbuild')
    const { outputFiles } = await build({
        entryPoints: ['src/worker.ts'], bundle: true, write: false, platform: 'neutral', format: 'cjs',
        plugins: [{
            name: 'worker-do-commit',
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, ({ importer, path }) => {
                    const base = importer ? posix.join(posix.dirname(importer), path) : path
                    const arquivo = [base, base.replace(/\.js$/, '.ts'), base + '.ts', base + '.js']
                        .find((nome) => arquivos.has(nome))
                    if (arquivo) return { path: arquivo, namespace: 'worker-do-commit' }
                    return { errors: [{ text: 'Import ausente no commit do Worker: ' + base }] }
                })
                builder.onLoad({ filter: /.*/, namespace: 'worker-do-commit' }, ({ path }) => ({
                    contents: git('show', commit + ':' + path),
                    loader: path.endsWith('.ts') ? 'ts' : 'js'
                }))
            }
        }]
    })
    const module = { exports: {} }
    new Function('module', outputFiles[0].text)(module)
    const worker = module.exports.default

    const hoje = '2026-11-23'
    const mensagens = [{ role: 'user', content: 'Mude o aporte mensal para R$ 1.500' }]
    const rascunhos = [{ cartao: { id: randomUUID(), tipo: 'meta', versao: 1 },
        valores: { nome: 'Comprar carro', valor_inicio: 1000, categoria: 'Veículos' },
        origens: { categoria: 'ia' } }]
    let inferencias = 0
    const configuracao = {
        CHAT_API_TOKEN: 'token-de-contrato-teste',
        CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) },
        FINANCIAL_TOOLS_ENABLED: 'false',
        AI: { run: async (_modelo, entrada) => {
            inferencias++
            const pedido = JSON.parse(entrada.messages[1].content)
            return { response: JSON.stringify({ versao: 2, intencao: 'planejamento',
                mensagem: 'Vamos ajustar o aporte.', propostas: [{
                    tipo: 'meta', modo: 'revisar', referencia: pedido.rascunhos[0].referencia,
                    campos: { aporte_mensal: { valor: 1500, origem: 'usuario', evidencia: mensagens[0].content } },
                    pendencias: []
                }]
            }) }
        } }
    }
    const enviar = (payload) => worker.fetch(new Request('https://worker.test/v1/ia/chat/acoes/interpretar', {
        method: 'POST', body: JSON.stringify(payload),
        headers: { Authorization: 'Bearer token-de-contrato-teste', 'Content-Type': 'application/json' }
    }), configuracao)
    const inicial = prepararPayload(mensagens, hoje, rascunhos, [], null).payload
    const propositoInvalido = structuredClone(inicial)
    propositoInvalido.rascunhos[0].dados.categoria = 'Veículos'
    const invalido = await enviar(propositoInvalido)
    assert.equal(invalido.status, 400)
    assert.equal((await invalido.json()).codigo, 'ACAO_PEDIDO_INVALIDO')
    assert.equal(inferencias, 0)

    for (const categorias of [[], ['Veículos'], ['Viagem']]) {
        const { payload } = prepararPayload(mensagens, hoje, rascunhos, categorias, null)
        const resultado = await enviar(payload)
        const corpo = await resultado.json()
        assert.equal(resultado.status, 200, JSON.stringify(corpo))
        assert.equal(corpo.propostas[0].referencia, payload.rascunhos[0].referencia)
        assert.equal(corpo.propostas[0].campos.aporte_mensal.valor, 1500)
    }
    assert.equal(inferencias, 3)
    configuracao.AI.run = async () => ({ response: '{"versao":1,"intencao":"orientacao"}' })
    const legado = await enviar({ versao: 1, mensagem: 'O que é uma meta financeira?', hoje, rascunho: null })
    assert.equal(legado.status, 200)
    assert.deepEqual(await legado.json(), { versao: 1, intencao: 'orientacao' })
})
