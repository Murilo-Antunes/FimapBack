const { randomBytes } = require('node:crypto')
const ia = require('./aiChatService.js')
const { normalizarTexto } = require('./financialContextSelection.js')
const { validarId } = require('./chatValidation.js')
const { catalogo, categorias, seguro, texto, classeMeta } = require('./chatActionCatalog.js')

const tabela = 'tbl_chat_acao'
const PRAZO_MS = 24 * 60 * 60_000
const INDISPONIVEL = 'Não consegui interpretar essa mensagem agora. Seus dados anteriores estão preservados. Tente reformular ou envie a mensagem novamente.'
const candidato = (mensagem) =>
    /\b(?:meta\w*|invest\w*|amortiz\w*|simul\w*|recomend\w*|plano|gastos?|juntar|economizar|guardar|poupar|viaj\w*)\b/.test(mensagem) &&
    /\b(?:mont\w*|cri[aeo]\w*|cadastr\w*|salv\w*|simul\w*|sugir\w*|suger\w*|recomende|planej\w*|faz\w*|faca|adicion\w*|exclu\w*|remov\w*|apag\w*|delet\w*|quero|queria|gostaria|preciso|ajud\w*|pensando)\b/.test(mensagem)

const ler = async (db, r, agora = Date.now()) => {
    const registro = await db(tabela).where('id_chat', r.id_chat).where('expira_ms', '>', agora).first()
    return registro ? { ...registro, proposta: JSON.parse(registro.proposta) } : null
}

const pendente = (trx, r) => trx(tabela).where('id_chat', r.id_chat)
const doUsuario = (trx, tipo, r) => trx(catalogo[tipo].tabela).where('id_usuario', r.id_usuario)

function resumo(tipo, dados, sugeridos, now) {
    const item = catalogo[tipo]
    const linhas = Object.entries(item.campos).flatMap(([chave, campo]) => Object.hasOwn(dados, chave)
        ? [`- **${campo.label}** \u2002${campo.formatar(dados[chave])}${sugeridos.includes(chave) ? ' · sugerido pela IA' : ''}`] : [])
    if (tipo === 'meta' && dados.data_alvo) linhas.push(`- **Prazo** \u2002${classeMeta(dados.data_alvo, now)}`)
    return [`**Rascunho de ${item.label}**`, ...linhas].join('\n')
}

async function guardar(trx, r, now, proposta, pronto) {
    const codigo = pronto ? randomBytes(4).toString('hex') : ''
    await pendente(trx, r).del()
    await trx(tabela).insert({ id_chat: r.id_chat, codigo, proposta: JSON.stringify(proposta), expira_ms: now + PRAZO_MS })
    return codigo
}
const instrucoes = (codigo) =>
    `Para salvar, envie **confirmar ação ${codigo}**. Você também pode descrever uma mudança ou enviar **cancelar rascunho**.`

async function confirmar(trx, r, now, codigo) {
    const registro = await ler(trx, r, now)
    if (!registro?.codigo || (codigo && registro.codigo !== codigo))
        return 'Não há um rascunho pronto com essa confirmação. Confira a última proposta deste chat.'
    const { acao, tipo, dados } = registro.proposta
    const item = catalogo[tipo]
    if (acao === 'excluir') {
        if (!codigo) return 'Use o código do resumo para confirmar a exclusão.'
        const removidos = await doUsuario(trx, tipo, r).where({ id: dados.id, nome: dados.nome }).del()
        await pendente(trx, r).del()
        return removidos ? `Excluí a ${item.label} “${seguro(dados.nome)}”.` :
            'O registro foi alterado ou excluído. Peça uma nova proposta para conferir a versão atual.'
    }
    const faltando = Object.entries(item.campos).find(([key, campo]) => !campo.validar(dados[key]))
    if (faltando) return faltando[1].pergunta
    const aviso = await item.pronto?.(trx, r, dados)
    if (aviso) return aviso
    const id = await item.gravar(trx, r, dados, now)
    if (id === null) return 'O rascunho continua neste chat. Revise a categoria e tente salvar novamente.'
    if (!validarId(id)) throw new Error('Registro salvo sem identificador válido')
    await pendente(trx, r).del()
    return `Criei a ${item.label} “${seguro(dados.nome ?? dados.titulo)}” (ID ${id}). Você encontra o registro em **${item.destino}**.`
}

async function excluir(trx, r, now, tipo, dados) {
    const id = validarId(dados.id)
    if (!id && !texto(100)(dados.nome)) return 'Qual é o nome exato ou o ID do registro que você quer excluir?'
    const alvo = doUsuario(trx, tipo, r).select('id', 'nome')
    const encontrados = await (id ? alvo.where('id', id) : alvo.where('nome', dados.nome)).limit(2)
    if (!encontrados.length) return 'Não encontrei esse registro na sua conta.'
    if (encontrados.length > 1) return 'Há mais de um registro com esse nome. Qual é o ID do registro que você quer excluir?'
    const registro = encontrados[0]
    const codigo = await guardar(trx, r, now, { acao: 'excluir', tipo, dados: registro }, true)
    return `Excluir a ${catalogo[tipo].label} “${seguro(registro.nome)}” (ID ${registro.id}).\n\nEnvie **confirmar ação ${codigo}** para excluir ou **cancelar rascunho** para cancelar.`
}

async function editar(trx, r, now, atual, interpretacao) {
    const { tipo } = interpretacao
    const anterior = atual?.tipo === tipo && atual.acao === 'criar' ? atual : null
    const dados = { ...anterior?.dados }
    const sugeridos = new Set(anterior?.sugeridos ?? [])
    const invalidos = []
    const item = catalogo[tipo]
    for (const [chave, campo] of Object.entries(item.campos)) {
        if (!Object.hasOwn(interpretacao.dados, chave)) continue
        const entrada = interpretacao.dados[chave]
        if (!campo.validar(entrada.valor)) {
            invalidos.push(campo)
            continue
        }
        if (entrada.origem === 'ia' && Object.hasOwn(dados, chave) && !sugeridos.has(chave)) continue
        dados[chave] = typeof entrada.valor === 'string' ? entrada.valor.trim() : entrada.valor
        if (entrada.origem === 'ia') sugeridos.add(chave)
        else sugeridos.delete(chave)
    }
    const faltando = Object.entries(item.campos).find(([chave]) => !Object.hasOwn(dados, chave))
    let pergunta = invalidos[0] ? `O valor de ${invalidos[0].label.toLowerCase()} precisa de revisão. ${invalidos[0].pergunta}` :
        faltando?.[1].pergunta
    if (!pergunta) pergunta = await item.pronto?.(trx, r, dados)
    if (tipo === 'meta' && pergunta?.includes('categoria')) {
        const nomes = await categorias(trx, r.id_usuario).orderBy('nome').limit(8).pluck('nome')
        if (nomes.length) pergunta += ' Opções: ' + nomes.map(seguro).join(', ') + '.'
    }
    const lista = [...sugeridos]
    const codigo = await guardar(trx, r, now, { acao: 'criar', tipo, dados, sugeridos: lista }, !pergunta)
    return resumo(tipo, dados, lista, now) + '\n\n' + (pergunta || instrucoes(codigo))
}

function interpretarResposta(resposta) {
    if (resposta?.versao !== 1 || !['orientacao', 'criar', 'propor', 'editar', 'excluir'].includes(resposta.intencao)) return null
    if (resposta.intencao === 'orientacao') return resposta
    if (!Object.hasOwn(catalogo, resposta.tipo) || !resposta.dados ||
        typeof resposta.dados !== 'object' || Array.isArray(resposta.dados)) return null
    for (const [chave, entrada] of Object.entries(resposta.dados)) {
        const permitidos = resposta.intencao === 'excluir' ? ['id', 'nome'] : Object.keys(catalogo[resposta.tipo].campos)
        if (!permitidos.includes(chave) || !entrada || !['usuario', 'ia'].includes(entrada.origem) ||
            !['string', 'number'].includes(typeof entrada.valor)) return null
    }
    return resposta
}

async function prepararAcao(r, { consultarRascunho, consultarCategorias }, signal, planejamentoHabilitado = false) {
    const pergunta = r.pergunta
    const mensagem = normalizarTexto(pergunta).replace(/[.!?]+$/, '').trim()
    const confirmacao = mensagem.match(/^(?:confirmar acao ([0-9a-f]{8})|confirmar|confirmo|confirmo que quero salvar|(?:sim,? )?pode salvar|confirmo o salvamento)$/)
    const rascunhoV1 = planejamentoHabilitado && !confirmacao?.[1] ? await consultarRascunho(r) : null
    if (planejamentoHabilitado && !confirmacao?.[1] && !rascunhoV1) return null
    if (confirmacao) return (trx, pedido, now) => confirmar(trx, pedido, now, confirmacao[1])
    if (/^(?:cancelar (?:rascunho|acao)|cancele o rascunho|cancela(?: o rascunho)?|cancelar|descarte o rascunho|desisti|nao quero mais)$/.test(mensagem)) {
        return async (trx, pedido) => await pendente(trx, pedido).del()
            ? 'Rascunho cancelado.' : 'Este chat está sem rascunho ativo.'
    }
    const registro = rascunhoV1 ?? await consultarRascunho(r)
    const atual = registro?.proposta
    if (!atual && (/^(?:qual|quais|quanto|onde)\b/.test(mensagem) || !candidato(mensagem))) return null
    let resposta
    try {
        const categoriasDisponiveis = atual?.tipo === 'meta' || /\bmetas?\b/.test(mensagem)
            ? await consultarCategorias(r.id_usuario) : undefined
        resposta = interpretarResposta(await ia.interpretarAcao({
            versao: 1, mensagem: pergunta, hoje: new Date(Number(r.criada_ms) - 10_800_000).toISOString().slice(0, 10),
            categorias: categoriasDisponiveis,
            rascunho: atual ? { tipo: atual.tipo, acao: atual.acao, dados: atual.dados } : null
        }, signal))
    } catch {
        signal?.throwIfAborted()
        return () => INDISPONIVEL
    }
    if (!resposta) return () => INDISPONIVEL
    if (resposta.intencao === 'orientacao') return null
    if (atual && (atual.tipo !== resposta.tipo ||
        (resposta.intencao === 'excluir') !== (atual.acao === 'excluir'))) {
        return () => 'Este chat tem outro rascunho ativo. Termine o rascunho atual ou envie **cancelar rascunho** antes de começar outro.'
    }
    if (resposta.intencao === 'excluir') {
        if (catalogo[resposta.tipo].excluir === false) return () => 'Você pode consultar o plano salvo em Recomendações.'
        const dados = Object.fromEntries(Object.entries(resposta.dados).filter(([, entrada]) => entrada.origem === 'usuario')
            .map(([chave, entrada]) => [chave, entrada.valor]))
        return (trx, pedido, now) => excluir(trx, pedido, now, resposta.tipo, dados)
    }
    if (resposta.intencao === 'editar' && (!atual || atual.tipo !== resposta.tipo || atual.acao !== 'criar')) return () => INDISPONIVEL
    return (trx, pedido, now) => editar(trx, pedido, now, atual, resposta)
}

module.exports = { prepararAcao, ler }
