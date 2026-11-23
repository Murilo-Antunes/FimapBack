// Envia o pedido de planejamento ao Worker e lê a resposta.
const { randomUUID } = require('node:crypto')
const { textoValido, semChavesExtras } = require('./planningCatalog.js')

const LIMITE_PEDIDO = 16 * 1024
const LIMITE_RESPOSTA = 32 * 1024
const CAMINHO = '/v1/ia/chat/acoes/interpretar'

function ocultarIdentificadores(texto) {
    return texto
        .replace(/\bcontrato\s+(?:(?:n(?:[uú]mero)?[º°.]?|id)\s*[:#]?\s*)?(?:["“][^"”]+["”]|[a-z0-9./-]*\d[a-z0-9./-]*)/gi, 'contrato informado')
        .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[identificador omitido]')
        .replace(/\b(?:\d[ -]?){13,19}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[identificador omitido]')
        .replace(/\b(?:CPF|CNPJ|RG|senha|token|bearer|conta|ag[eê]ncia|cart[aã]o)\s*(?:n[º°]\s*)?[:#=]\s*\S+/gi, '[identificador omitido]')
        .replace(/\b(?:cpf|cnpj|rg|conta|ag[eê]ncia|cart[aã]o)\s+(?:n[º°]\s*)?\d(?:[\d./-]*\d)?\b/gi, '[identificador omitido]')
        .replace(/\bBearer\s+[\w.=+/-]+/gi, '[identificador omitido]')
}

function prepararPayload(mensagens, hoje, rascunhos, categorias, contextoPlanejamento) {
    const limitarTexto = (texto, limite) => [...ocultarIdentificadores(texto)].slice(0, limite).join('')
    const referencias = new Map()
    const resumo = rascunhos.slice(0, 3).map((rascunho) => {
        const referencia = randomUUID()
        referencias.set(referencia, rascunho)
        const dados = Object.fromEntries(Object.entries(rascunho.valores)
            .filter(([campo]) => rascunho.origens[campo] !== 'contrato')
            .map(([campo, valor]) => [campo, typeof valor === 'string' ? limitarTexto(valor, 500) : valor]))
        return { referencia, tipo: rascunho.cartao.tipo, dados,
            sugeridos: Object.keys(dados).filter((campo) => rascunho.origens[campo] === 'ia') }
    })
    const payload = { versao: 2, mensagem: limitarTexto(mensagens.at(-1).content, 2000), hoje,
        historico: mensagens.slice(-9, -1).map(({ role, content }) => ({ role, content: limitarTexto(content, 1200) })),
        rascunhos: resumo, categorias: categorias.slice(0, 20), contextoPlanejamento }
    const excede = () => Buffer.byteLength(JSON.stringify(payload), 'utf8') > LIMITE_PEDIDO
    while (payload.historico.length && excede()) payload.historico.shift()
    if (excede()) throw new Error('Pedido de planejamento excedeu o limite.')
    return { payload, referencias }
}

async function lerJson(response) {
    const leitor = response.body?.getReader()
    if (!leitor) throw new Error('Interpretação sem corpo.')
    let tamanho = 0
    const partes = []
    try {
        while (true) {
            const { value, done } = await leitor.read()
            if (done) break
            tamanho += value.byteLength
            if (tamanho > LIMITE_RESPOSTA) throw new Error('Interpretação excedeu o limite.')
            partes.push(value)
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(partes, tamanho)))
    } finally {
        await leitor.cancel().catch(() => {})
        leitor.releaseLock()
    }
}

async function interpretar(config, payload, sinal) {
    const url = new URL(CAMINHO, config.url)
    const response = await fetch(url, {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.any([sinal, AbortSignal.timeout(8000)])
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel()
        throw new Error('Interpretação indisponível.')
    }
    const dados = await lerJson(response)
    if (!semChavesExtras(dados, ['versao', 'intencao', 'mensagem', 'propostas']) || dados.versao !== 2 ||
        !Array.isArray(dados.propostas) || dados.propostas.length > 3 ||
        (dados.intencao === 'orientacao' ? dados.propostas.length !== 0 :
            dados.intencao !== 'planejamento' || !textoValido(dados.mensagem, 6000)))
        throw new Error('Interpretação fora do contrato v2.')
    return dados
}

module.exports = { prepararPayload, interpretar, ocultarIdentificadores }
