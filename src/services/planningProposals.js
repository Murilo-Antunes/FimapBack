// Monta os cartões que mostram as propostas no chat.
const { randomUUID } = require('node:crypto')
const { normalizarTexto } = require('./financialContextSelection.js')
const { resolverData } = require('./planningDates.js')
const { catalogo, campoValido, checarDados, centavos, textoValido, semChavesExtras, objeto, perguntas } = require('./planningCatalog.js')
const { ocultarIdentificadores } = require('./planningWorker.js')

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const inteiro = new Intl.NumberFormat('pt-BR')
const formatarCentavos = (valor) => 'R$ ' + inteiro.format(valor / 100n) + ',' + String(valor % 100n).padStart(2, '0')
const limitar = (texto, max) => [...ocultarIdentificadores(texto)].slice(0, max).join('')
const listar = (itens) => [...new Set(itens)].slice(0, 8).map((texto) => limitar(texto, 220))
const comparacao = (texto) => /\b(?:compar(?:e|ar|acao)|e se|por exemplo|hipotetic[oa]mente|hipotese)\b/.test(texto)
const alteracao = (texto) => /\b(?:alter\w*|mud\w*|corrig\w*|troc\w*|ajust\w*|atualiz\w*|substitu\w*|aument\w*|reduz\w*|adi\w*|prefiro|quero|posso|separei|tenho|custa|ficou|agora|em vez|novo|nova|use|considere|para|ate)\b/.test(texto)
const aprovacao = (texto) => /^(?:sim|ok|certo|concordo|confirmo|pode ser|esta bom|esta certo)[.! ]*$/.test(texto)
const semInvestimento = (texto) => /\b(?:sem simulacao|sem investimento|so (?:a )?meta|apenas (?:a )?meta|nao (?:quero|preciso de) (?:investir|simulacao|investimento))\b/.test(texto)

function numerosNoTexto(texto) {
    return [...texto.matchAll(/(?<!\d)(?<!\d[.,])(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:[,.]\d{1,2})?)(?:\s+(milhoes|milhao|mil)\b)?(?!\d|[.,]\d)/g)]
        .map((ocorrencia) => {
            const [trecho, cifra, escala] = ocorrencia
            const normalizada = cifra.replace(/\.(?=\d{3}(?:\.|,|$))/g, '').replace(',', '.')
            return { valor: Number(normalizada) * (escala === 'mil' ? 1000 : escala ? 1000000 : 1),
                antes: texto.slice(Math.max(0, ocorrencia.index - 45), ocorrencia.index),
                depois: texto.slice(ocorrencia.index + trecho.length, ocorrencia.index + trecho.length + 35) }
        })
}

const termosMonetarios = {
    valor_inicio: /(?:separei|separad[oa]|reservei|reservad[oa]|juntei|guard\w*|entrada|ja tenho)/,
    valor_inicial: /(?:separei|separad[oa]|reservei|reservad[oa]|juntei|guard\w*|entrada|ja tenho|inicial)/,
    valor_desejado: /(?:cust\w*|prec[oa]|orcamento|valor total|valor desejado|vale)/,
    aporte_mensal: /(?:aport\w*|por mes|mensal|disponh\w*|destin\w*|coloc\w*|posso|extra)/,
    saldo_devedor: /(?:saldo|devo|devedor|divida)/
}

function evidencia(campo, valor, texto, hoje) {
    if (campo === 'data_alvo') return resolverData(texto, hoje).data === valor
    if (campo === 'modalidade') return valor === 'REDUZIR_PRAZO'
        ? /(?:reduz|menor|diminu|encurt).{0,32}\bprazo\b/.test(texto)
        : /(?:reduz|menor|diminu).{0,32}\bparcela/.test(texto)
    if (typeof valor === 'string') return texto.includes(normalizarTexto(valor))
    const numeros = numerosNoTexto(texto)
    const respostaCurta = numeros.length === 1 && /^(?:(?:r\$\s*)?-?\d[\d.,]*(?:\s+(?:mil|milha[oo]|milhoes|reais|meses?))?\s*%?[.! ]*)$/.test(texto.trim())
    if (campo === 'prazo') return numeros.some((n) =>
        n.valor === valor && (respostaCurta || /^\s*-?\s*mes(?:es)?\b/.test(n.depois)) ||
        n.valor * 12 === valor && /^\s+anos?\b/.test(n.depois))
    if (campo === 'taxa' || campo === 'rentabilidade') {
        if (valor === 0 && /\bsem (?:rendimento|rentabilidade|juros)\b/.test(texto)) return true
        return numeros.some((n) => {
            if (!/^\s*%/.test(n.depois)) return false
            if (/\b(?:ao mes|mensal)\b|a\.?\s*m\./.test(n.depois))
                return Math.round(10000 * ((1 + n.valor / 100) ** 12 - 1)) / 100 === valor
            return n.valor === valor
        })
    }
    if (valor === 0 && (campo === 'valor_inicio' || campo === 'valor_inicial') &&
        /\b(?:zero|nada|nao (?:tenho|separei|reservei)|sem (?:reserva|entrada|saldo))\b/.test(texto)) return true
    return numeros.some((n) => n.valor === valor &&
        !/^\s*%|\s+(?:meses|anos)\b/.test(n.depois) &&
        (respostaCurta || /r\$\s*$/.test(n.antes) || /^\s+reais\b/.test(n.depois) ||
            termosMonetarios[campo]?.test(n.antes + n.depois)))
}

function validarProposta(proposta, referencias, categorias) {
    if (!semChavesExtras(proposta, ['tipo', 'modo', 'referencia', 'campos', 'pendencias', 'justificativa']) ||
        !Object.hasOwn(catalogo, proposta.tipo) || !['nova', 'revisar'].includes(proposta.modo) ||
        !objeto(proposta.campos) || !Array.isArray(proposta.pendencias) || proposta.pendencias.length > 8 ||
        !proposta.pendencias.every((texto) => textoValido(texto, 220)) ||
        (proposta.justificativa !== undefined && !textoValido(proposta.justificativa, 420))) return false
    if (proposta.modo === 'revisar' && referencias.get(proposta.referencia)?.cartao.tipo !== proposta.tipo) return false
    if (proposta.modo === 'nova' && Object.hasOwn(proposta, 'referencia')) return false
    return Object.entries(proposta.campos).every(([campo, dado]) =>
        semChavesExtras(dado, ['valor', 'origem', 'premissa']) &&
        ['usuario', 'ia'].includes(dado.origem) && campoValido(proposta.tipo, campo, dado.valor, categorias) &&
        (dado.premissa === undefined || textoValido(dado.premissa, 160)))
}

function podeUsar(tipo, campo, dado, estado) {
    const { hoje, atual, textos, capacidade, anterior, categorias } = estado
    const { valor, origem } = dado
    const antes = anterior?.valores[campo]
    if (antes === valor) return false
    if (campo === 'categoria' && antes !== undefined && !categorias.includes(antes))
        return origem === 'usuario' && evidencia(campo, valor, atual, hoje)
    if (antes !== undefined && (comparacao(atual) || !alteracao(atual) || !evidencia(campo, valor, atual, hoje))) return false
    if (campo === 'nome' || campo === 'descricao') return true
    if (origem === 'usuario') return (anterior ? [atual] : textos)
        .some((texto) => !comparacao(texto) && evidencia(campo, valor, texto, hoje))
    if (campo === 'categoria') return true
    if (campo === 'aporte_mensal') return tipo !== 'amortizacao' && capacidade !== undefined && valor === capacidade
    return false
}

function montar(proposta, anterior, parametros) {
    const { tipo } = proposta
    const { hoje, atual, textos, financeiro, categorias } = parametros
    const capacidade = financeiro.contexto?.capacidade_aporte_mensal
    const valores = { ...anterior?.valores }
    const origens = { ...anterior?.origens }
    const premissas = { ...anterior?.premissas }
    const definir = (campo, valor, origem, premissa) => {
        if (typeof valor === 'string') valor = limitar(valor.trim(), campo === 'descricao' ? (tipo === 'meta' ? 2000 : 200) :
            campo === 'nome' ? (tipo === 'meta' ? 100 : 45) : 100)
        valores[campo] = valor
        origens[campo] = origem
        delete premissas[campo]
        if (premissa) premissas[campo] = premissa
    }
    for (const [campo, dado] of Object.entries(proposta.campos)) {
        if (podeUsar(tipo, campo, dado, { hoje, atual, textos, capacidade, anterior, categorias }))
            definir(campo, dado.valor, dado.origem, dado.premissa)
    }
    const anteriorAmbiguo = Boolean(anterior?.dataAmbigua)
    const dataAtual = resolverData(atual, hoje)
    const dataConversa = textos.filter((texto) => !comparacao(texto)).map((texto) => resolverData(texto, hoje))
        .find((data) => data.ambigua || data.data)
    const deveRevisarData = !comparacao(atual) && (!anterior || !anterior.valores.data_alvo || alteracao(atual))
    const dataAmbigua = tipo === 'meta' && (deveRevisarData && (anterior ? dataAtual : dataConversa)?.ambigua ||
        anteriorAmbiguo && !dataAtual.data)
    if (tipo === 'meta' && deveRevisarData && !dataAmbigua) {
        const alvo = (anterior ? dataAtual : dataConversa)?.data
        if (alvo) definir('data_alvo', alvo, 'usuario')
    }
    if (tipo === 'amortizacao') {
        for (const [campo, valor] of Object.entries(financeiro.contrato ?? {})) {
            if (valores[campo] === undefined) definir(campo, valor, 'contrato', 'Dado do contrato identificado e autorizado.')
        }
    } else if (valores.aporte_mensal === undefined && capacidade !== undefined) {
        definir('aporte_mensal', capacidade, 'ia', 'Aporte sugerido com base na capacidade mensal estimada.')
    }
    if (aprovacao(atual)) {
        for (const campo of Object.keys(origens)) {
            if (origens[campo] === 'ia') origens[campo] = 'usuario'
        }
    }
    return { id: anterior?.cartao.id ?? randomUUID(), versao: anterior ? anterior.cartao.versao + 1 : 1,
        tipo, valores, origens, premissas, dataAmbigua, pendencias: proposta.pendencias,
        justificativa: proposta.justificativa, cenario: anterior?.cenario }
}

function diferenca(valores, prazo, capacidade) {
    if (!prazo || !['valor_inicio', 'valor_desejado', 'aporte_mensal'].every((campo) => typeof valores[campo] === 'number') ||
        valores.valor_desejado <= valores.valor_inicio) return []
    const inicio = BigInt(centavos(valores.valor_inicio))
    const alvo = BigInt(centavos(valores.valor_desejado))
    const meses = BigInt(prazo)
    const total = inicio + BigInt(centavos(valores.aporte_mensal)) * meses
    const aporteMinimo = (alvo - inicio + meses - 1n) / meses
    const frases = ['Em ' + prazo + ' aportes, o total sem rendimento será de ' + formatarCentavos(total) +
        '. Aporte mínimo para a meta de ' + formatarCentavos(alvo) + ': ' + formatarCentavos(aporteMinimo) + ' por mês.']
    if (total < alvo) frases.push('Faltam ' + formatarCentavos(alvo - total) +
        '. Você pode aumentar a entrada, estender o prazo, escolher uma versão mais barata ou dividir o objetivo em fases.')
    if (capacidade !== undefined) {
        const sustentavel = BigInt(centavos(capacidade))
        if (aporteMinimo > sustentavel)
            frases.push('O aporte mínimo supera a capacidade mensal estimada de ' + moeda.format(capacidade) + '.')
        if (capacidade !== valores.aporte_mensal) {
            const totalSustentavel = inicio + sustentavel * meses
            frases.push('Com o aporte sustentável, o total sem rendimento seria ' + formatarCentavos(totalSustentavel) +
                (totalSustentavel < alvo ? ', com diferença de ' + formatarCentavos(alvo - totalSustentavel) + '.' : '.'))
        }
    }
    return frases
}

function cartao(rascunho, parametros) {
    const { tipo, valores, origens, premissas, cenario, dataAmbigua, id, versao } = rascunho
    const { categorias, hoje, financeiro } = parametros
    const capacidade = financeiro.contexto?.capacidade_aporte_mensal
    const { prazo, pendencias } = checarDados(tipo, valores, categorias, hoje)
    if (dataAmbigua) pendencias.unshift('Qual mês e dia você tem em mente para o próximo ano?')
    const { nome, descricao, ...dados } = valores
    if (tipo === 'meta') {
        if (prazo && !dataAmbigua) dados.prazo = prazo
        if (dataAmbigua) delete dados.data_alvo
        if (!categorias.includes(dados.categoria)) delete dados.categoria
    }
    const dadosFinanceiros = tipo === 'amortizacao' ? [] : [
        ...(financeiro.metodo ? [financeiro.metodo] : []),
        ...(capacidade !== undefined && valores.aporte_mensal > capacidade ? [
            'Cenário hipotético: o aporte de ' + moeda.format(valores.aporte_mensal) +
            ' excede a capacidade estimada de ' + moeda.format(capacidade) + ' em ' +
            moeda.format((centavos(valores.aporte_mensal) - centavos(capacidade)) / 100) + ' por mês.'
        ] : [])
    ]
    const calculos = tipo === 'meta' && !dataAmbigua ? diferenca(valores, dados.prazo, capacidade) : []
    const simulacao = tipo === 'investimento' ? ['Simulação bruta. A taxa é uma premissa, pode variar e não garante rendimento.'] : []
    const base = financeiro.base || 'Cobertura indisponível para esta resposta. Referência ' + hoje + '.'
    const pendentes = pendencias.length ? listar([...pendencias, ...rascunho.pendencias]) : []
    const justificativa = limitar([base, rascunho.justificativa].filter(Boolean).join(' '), 420)
    return { hoje, valores, origens, premissas, cenario, dataAmbigua, cartao: {
        id, versao, tipo, status: pendentes.length ? 'rascunho' : 'pronta',
        ...(nome !== undefined && { nome }), ...(descricao !== undefined && { descricao }), justificativa,
        premissas: listar([...calculos, ...dadosFinanceiros, ...simulacao, ...Object.values(premissas)]),
        pendencias: pendentes, dados
    }, calculos: [...calculos, ...dadosFinanceiros.filter((texto) => texto.startsWith('Cenário hipotético'))] }
}

function complementar(estados, anteriores, parametros) {
    const metas = estados.filter((r) => r.tipo === 'meta')
    if (metas.length !== 1 || semInvestimento(parametros.atual)) return
    const [meta] = metas
    const comparacaoIndependente = /\b(?:outro|outra|separad[oa]|independente)\b/.test(parametros.atual)
    const { prazo } = checarDados('meta', meta.valores, parametros.categorias, parametros.hoje)
    const temCenario = prazo && !meta.dataAmbigua && meta.valores.nome &&
        meta.valores.valor_desejado > meta.valores.valor_inicio && meta.valores.aporte_mensal !== undefined
    if (!temCenario || comparacaoIndependente) return
    const nome = [...meta.valores.nome].slice(0, 45).join('')
    const investimentos = estados.filter((r) => r.tipo === 'investimento')
    const relacionados = investimentos.filter((r) => (meta.cenario && r.cenario === meta.cenario) ||
        normalizarTexto(r.valores.nome ?? '').includes(normalizarTexto(nome)))
    let investimento = relacionados.length === 1 ? relacionados[0] : null
    if (!investimento && investimentos.length === 1 && !meta.cenario && !investimentos[0].cenario)
        investimento = investimentos[0]
    if (!investimento && !investimentos.length && estados.length < 3) {
        const anterior = meta.cenario && anteriores.find((r) => r.cartao.tipo === 'investimento' && r.cenario === meta.cenario)
        if (meta.cenario && !anterior) return
        investimento = montar({ tipo: 'investimento', campos: {}, pendencias: [] }, anterior, parametros)
        if (!anterior) {
            investimento.valores.nome = nome
            investimento.origens.nome = meta.origens.nome
            if (meta.valores.descricao) {
                investimento.valores.descricao = [...meta.valores.descricao].slice(0, 200).join('')
                investimento.origens.descricao = meta.origens.descricao
            }
        }
        estados.push(investimento)
    }
    if (!investimento) return
    meta.cenario ??= randomUUID()
    investimento.cenario = meta.cenario
    Object.assign(investimento.valores, { valor_inicial: meta.valores.valor_inicio, aporte_mensal: meta.valores.aporte_mensal, prazo })
    Object.assign(investimento.origens, { valor_inicial: meta.origens.valor_inicio, aporte_mensal: meta.origens.aporte_mensal, prazo: meta.origens.data_alvo })
    delete investimento.premissas.valor_inicial
    delete investimento.premissas.aporte_mensal
    delete investimento.premissas.prazo
    if (investimento.valores.rentabilidade === undefined) {
        investimento.valores.rentabilidade = 0
        investimento.origens.rentabilidade = 'ia'
        investimento.premissas.rentabilidade = 'Referência de 0% a.a. para comparar somente a trajetória de aportes.'
    }
    investimento.premissas.cenario = 'Mesmo objetivo, valor inicial, aporte e prazo da meta. Salvamento independente.'
}

function produzir(resposta, referencias, parametros) {
    const { categorias } = parametros
    const estados = []
    const revisoes = new Set()
    let rejeitadas = 0
    for (const proposta of resposta.propostas) {
        if (!validarProposta(proposta, referencias, categorias) || revisoes.has(proposta.referencia)) {
            rejeitadas++
            continue
        }
        if (proposta.referencia) revisoes.add(proposta.referencia)
        if (proposta.modo === 'revisar' && comparacao(parametros.atual)) continue
        estados.push(montar(proposta, referencias.get(proposta.referencia), parametros))
    }
    if (estados.length) complementar(estados, [...referencias.values()], parametros)
    const processadas = estados.map((rascunho) => cartao(rascunho, parametros))
    const calculos = [...new Set(processadas.flatMap(({ calculos }) => calculos))]
    const textoWorker = resposta.mensagem.trim()
    const afirmaGravacao = /\b(?:salvei|gravei|cadastrei|registrei|(?:ja )?foi (?:salv[oa]|gravad[oa]|cadastrad[oa]|registrad[oa])|salv[oa] com sucesso)\b/
        .test(normalizarTexto(textoWorker))
    const mensagem = limitar(rejeitadas ? 'Parte da proposta não pôde ser validada. Revise os dados ou reformule o pedido.'
        : afirmaGravacao ? 'Revise os dados da sua proposta.' : textoWorker, 6000)
    const prontas = processadas.filter((item) => item.cartao.status === 'pronta').map((item) => item.cartao.tipo)
    const instrucoes = prontas.includes('meta') && prontas.includes('investimento')
        ? 'Você pode salvar a meta e a simulação de investimento separadamente pelos botões dos cartões.'
        : prontas.length ? 'Você pode salvar a proposta pelo botão do cartão.' : ''
    const perguntasPendentes = processadas.flatMap((p) => p.cartao.pendencias).filter((texto) => !mensagem.includes(texto))
    return { texto: [mensagem, ...calculos, instrucoes, ...new Set(perguntasPendentes)].filter(Boolean).join('\n\n'),
        propostas: processadas.map(({ calculos: _, ...item }) => item) }
}

module.exports = { produzir, diferenca }
