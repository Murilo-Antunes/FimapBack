// Confere quais campos e valores cada proposta pode ter.
const { dataValida, prazoDaMeta } = require('./planningDates.js')

const perguntas = {
    nome: 'Qual nome você quer dar ao plano?',
    valor_inicio: 'Quanto você já separou para este objetivo? Pode informar zero.',
    valor_inicial: 'Quanto você já separou para esta simulação? Pode informar zero.',
    valor_desejado: 'Qual é o custo estimado ou orçamento total do objetivo?',
    aporte_mensal: 'Quanto você pode destinar por mês?',
    data_alvo: 'Qual é a data-alvo? Informe mês e ano ou uma data completa.',
    categoria: 'Qual categoria disponível você quer usar para a meta?',
    prazo: 'Qual é o prazo em meses?',
    rentabilidade: 'Qual taxa anual efetiva você quer simular?',
    saldo_devedor: 'Qual é o saldo devedor atual do contrato?',
    taxa: 'Qual é a taxa anual efetiva do contrato?',
    sistema_calculo: 'O sistema do contrato é SAC ou Price?',
    modalidade: 'Você quer reduzir o prazo ou o valor das parcelas?'
}

const catalogo = {
    meta: ['nome', 'descricao', 'valor_inicio', 'valor_desejado', 'aporte_mensal', 'data_alvo', 'categoria'],
    investimento: ['nome', 'descricao', 'valor_inicial', 'aporte_mensal', 'prazo', 'rentabilidade'],
    amortizacao: ['nome', 'descricao', 'saldo_devedor', 'aporte_mensal', 'prazo', 'taxa', 'sistema_calculo', 'modalidade']
}
const monetarios = ['valor_inicio', 'valor_desejado', 'valor_inicial', 'aporte_mensal', 'saldo_devedor']
const centavos = (valor) => Math.round(valor * 100)
const numeroValido = (valor, min, max) => typeof valor === 'number' && Number.isFinite(valor) &&
    valor >= min && valor <= max && valor === centavos(valor) / 100
const textoValido = (valor, max, min = 1) => typeof valor === 'string' &&
    [...valor.trim()].length >= min && [...valor].length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(valor)
const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)
const semChavesExtras = (obj, chaves) => objeto(obj) && Object.keys(obj).every((chave) => chaves.includes(chave))

function campoValido(tipo, campo, valor, categorias) {
    if (!Object.hasOwn(catalogo, tipo) || !catalogo[tipo].includes(campo)) return false
    if (monetarios.includes(campo))
        return numeroValido(valor, ['valor_desejado', 'saldo_devedor'].includes(campo) ? 0.01 : 0, 9999999999999.99)
    switch (campo) {
        case 'nome': return textoValido(valor, tipo === 'meta' ? 100 : 45, 2)
        case 'descricao': return textoValido(valor, tipo === 'meta' ? 2000 : 200, 0)
        case 'data_alvo': return dataValida(valor)
        case 'categoria': return categorias.includes(valor)
        case 'prazo': return Number.isInteger(valor) && valor >= 1 && valor <= 600
        case 'rentabilidade': return numeroValido(valor, -99.99, 999.99)
        case 'taxa': return numeroValido(valor, 0, 999.99)
        case 'sistema_calculo': return ['SAC', 'PRICE'].includes(valor)
        case 'modalidade': return ['REDUZIR_PRAZO', 'REDUZIR_PARCELA'].includes(valor)
        default: return false
    }
}

function checarDados(tipo, valores, categorias, hoje) {
    const pendencias = []
    for (const campo of catalogo[tipo]) {
        if (campo === 'descricao' && !Object.hasOwn(valores, campo)) continue
        if (!campoValido(tipo, campo, valores[campo], categorias)) pendencias.push(perguntas[campo])
    }
    const prazo = tipo === 'meta' ? prazoDaMeta(hoje, valores.data_alvo) : valores.prazo
    if (tipo === 'meta' && valores.data_alvo && !prazo)
        pendencias.push('Informe uma data que permita de 1 a 600 aportes no fim do mês, a partir do próximo mês.')
    if (tipo === 'meta' && valores.valor_desejado <= valores.valor_inicio)
        pendencias.push('Qual valor-alvo acima do montante já separado você deseja planejar?')
    return { pendencias, prazo }
}

module.exports = { catalogo, campoValido, checarDados, centavos, textoValido, semChavesExtras, objeto, perguntas }
