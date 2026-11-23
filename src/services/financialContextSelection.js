const DIA_MS = 86_400_000
const MESES = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ')
const MES_NOME = new RegExp(`\\b(${MESES.join('|')})(?: de (20\\d{2}))?\\b`)

const normalizarTexto = (texto) => texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
const diaISO = (data) => data.toISOString().slice(0, 10)
const somarDias = (data, dias) => new Date(data.getTime() + dias * DIA_MS)
const inicioMes = (ano, mes) => new Date(Date.UTC(ano, mes, 1))

function selecionarPeriodo(texto, agora) {
    const dia = new Date(agora.getTime() - 3 * 60 * 60 * 1000)
    dia.setUTCHours(0, 0, 0, 0)
    const ano = dia.getUTCFullYear()
    const mes = dia.getUTCMonth()
    const intervalo = texto.match(/\b(20\d{2}-\d{2}-\d{2})\s+(?:a|ate)\s+(20\d{2}-\d{2}-\d{2})\b/)
    if (intervalo) {
        const inicio = new Date(`${intervalo[1]}T00:00:00Z`)
        const fim = new Date(`${intervalo[2]}T00:00:00Z`)
        if (inicio <= fim && diaISO(inicio) === intervalo[1] && diaISO(fim) === intervalo[2] &&
            fim - inicio < 366 * DIA_MS) return [inicio, somarDias(fim, 1)]
    }
    const dataMes = texto.match(/\b(20\d{2})-(0[1-9]|1[0-2])(?!-\d)\b/)
    if (dataMes) return [inicioMes(+dataMes[1], +dataMes[2] - 1), inicioMes(+dataMes[1], +dataMes[2])]
    const mesNome = texto.match(MES_NOME)
    if (mesNome) {
        const indice = MESES.indexOf(mesNome[1])
        const anoReferencia = Number(mesNome[2] ?? (indice > mes ? ano - 1 : ano))
        return [inicioMes(anoReferencia, indice), inicioMes(anoReferencia, indice + 1)]
    }
    if (/\b(?:mes passado|mes anterior|ultimo mes)\b/.test(texto)) return [inicioMes(ano, mes - 1), inicioMes(ano, mes)]
    if (/\bproximo mes\b/.test(texto)) return [inicioMes(ano, mes + 1), inicioMes(ano, mes + 2)]
    if (/\b(?:este mes|neste mes|des[st]e mes|mes atual|mes corrente)\b/.test(texto))
        return [inicioMes(ano, mes), inicioMes(ano, mes + 1)]
    const meses = texto.match(/\bultimos ([1-6]) meses\b/)
    if (meses) return [inicioMes(ano, mes - Number(meses[1]) + 1), inicioMes(ano, mes + 1)]
    if (/\b(?:ano passado|ano anterior)\b/.test(texto)) return [inicioMes(ano - 1, 0), inicioMes(ano, 0)]
    if (/\b(?:este ano|neste ano|des[st]e ano|ano atual)\b/.test(texto)) return [inicioMes(ano, 0), inicioMes(ano + 1, 0)]
    const dias = texto.match(/\bultimos ([1-9]\d?) dias\b/)
    if (dias) return [somarDias(dia, 1 - Number(dias[1])), somarDias(dia, 1)]
    if (/\bsemana (?:passada|anterior)\b/.test(texto)) {
        const segunda = somarDias(dia, -((dia.getUTCDay() + 6) % 7))
        return [somarDias(segunda, -7), segunda]
    }
    if (/\b(?:esta semana|nesta semana|ultima semana)\b/.test(texto))
        return [somarDias(dia, -6), somarDias(dia, 1)]
    if (/\bontem\b/.test(texto)) return [somarDias(dia, -1), dia]
    if (/\bhoje\b/.test(texto)) return [dia, somarDias(dia, 1)]
    return null
}

function selecionarModulos(texto) {
    const modulos = []
    if (/\b(?:patrimonio|riqueza liquida|balanco patrimonial)\b/.test(texto)) modulos.push('patrimonio')
    if (/\b(?:receitas?|despesas?|entradas?|saidas?|salario\w*|rend[ai]s?|fluxo de caixa|gastei|recebi|ganhei|gastos?)\b/.test(texto))
        modulos.push('movimentacao')
    if (/\b(?:contas?|saldos? bancarios?|extratos?|movimenta\w*)\b/.test(texto))
        modulos.push('contas')
    if (/\b(?:cartao|cartoes|limite)\b/.test(texto)) modulos.push('cartoes')
    if (/\bfaturas?\b/.test(texto) || (modulos.includes('cartoes') && /\b(?:gastos?|gastei|compras?|extrato|parcelas?)\b/.test(texto)))
        modulos.push('faturas')
    if (/\b(?:investiment\w*|carteira|ativos?|rendimentos?|aplica\w*)\b/.test(texto)) modulos.push('investimentos')
    if (/\b(?:metas?|objetivos?|reserva de emergencia)\b/.test(texto)) modulos.push('metas')
    if (/\b(?:emprestim\w*|financiam\w*|dividas?|devedor|amortiza\w*)\b/.test(texto) ||
        (!modulos.includes('faturas') && /\bparcelas?\b/.test(texto))) modulos.push('emprestimos')
    if (/\bcompromet\w*\b/.test(texto) && (modulos.includes('movimentacao') || /\borcamento\b/.test(texto)))
        modulos.push('comprometimento', 'movimentacao', 'faturas', 'emprestimos')
    if (!modulos.length && /\bsaldos?\b/.test(texto)) modulos.push('contas')
    if (/\b(?:minha|meu|minhas|meus)\s+(?:situacao|panorama|resumo) financeir[oa]\b/.test(texto))
        modulos.push('patrimonio', 'movimentacao', 'faturas', 'metas', 'emprestimos')
    return [...new Set(modulos)]
}

function selecionarContexto(mensagens, agora) {
    const perguntas = mensagens.filter(({ role }) => role === 'user').map(({ content }) => normalizarTexto(content))
    const pergunta = perguntas.pop()
    if (!pergunta) return null
    if (/^(?:o que (?:e|sao)|como (?:funciona|calcular|funcionam)|qual a diferenca|explique)\b/.test(pergunta) &&
        !/\b(?:meu|minha|meus|minhas)\b/.test(pergunta)) return null

    const periodoAtual = selecionarPeriodo(pergunta, agora)
    let modulos = selecionarModulos(pergunta)
    let assunto = pergunta
    const acompanhamento = /^(?:e\b|quanto (?:foi|ficou)\b|qual foi\b)/.test(pergunta)
    const anteriores = [...perguntas].reverse()
    const indiceAnterior = acompanhamento || (!modulos.length && periodoAtual)
        ? anteriores.findIndex((texto) => selecionarModulos(texto).length)
        : -1
    const anterior = indiceAnterior >= 0 ? anteriores[indiceAnterior] : null
    const ultimoPeriodo = anterior && acompanhamento && !periodoAtual
        ? anteriores.slice(0, indiceAnterior + 1).map((texto) => selecionarPeriodo(texto, agora)).find(Boolean)
        : null
    if (!modulos.length && anterior) {
        modulos = selecionarModulos(anterior)
        assunto = anterior
    }
    if (!modulos.length) return null

    const periodo = periodoAtual || ultimoPeriodo || selecionarPeriodo('este mes', agora)
    return { modulos, assunto, inicio: periodo[0], fim: periodo[1] }
}

module.exports = { selecionarContexto, normalizarTexto, diaISO, somarDias }
