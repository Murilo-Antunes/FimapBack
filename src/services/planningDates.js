// Entende as datas do plano e conta quantos aportes cabem no prazo.
const { normalizarTexto, diaISO } = require('./financialContextSelection.js')

const fuso = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' })
const meses = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ')
const mesTexto = new RegExp('\\b(?:(\\d{1,2}) de )?(' + meses.join('|') + ')(?: de (\\d{4})| do (proximo ano|ano que vem))?\\b', 'g')

const dataLocal = (agora) => fuso.format(agora)
const fimMes = (ano, mes) => diaISO(new Date(Date.UTC(ano, mes, 0)))
function dataValida(valor) {
    if (typeof valor !== 'string' || !/^[2-9]\d{3}-\d{2}-\d{2}$/.test(valor)) return false
    const data = new Date(valor + 'T00:00:00Z')
    return Number.isFinite(data.getTime()) && diaISO(data) === valor
}

function prazoDaMeta(hoje, alvo) {
    if (!dataValida(alvo)) return null
    const [anoAtual, mesAtual] = hoje.split('-').map(Number)
    const [ano, mes] = alvo.split('-').map(Number)
    const prazo = (ano - anoAtual) * 12 + mes - mesAtual - Number(alvo !== fimMes(ano, mes))
    return prazo >= 1 && prazo <= 600 ? prazo : null
}

function resolverData(mensagem, hoje) {
    const texto = normalizarTexto(mensagem)
    const [ano, mes, diaHoje] = hoje.split('-').map(Number)
    const resultados = new Set()
    const incluir = (data) => { if (dataValida(data)) resultados.add(data) }
    for (const [data] of texto.matchAll(/\b[2-9]\d{3}-\d{2}-\d{2}\b/g)) incluir(data)
    for (const [, d, m, a] of texto.matchAll(/\b(\d{1,2})\/(\d{1,2})\/([2-9]\d{3})\b/g))
        incluir(a + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0'))
    for (const [, dia, nome, anoTexto, proximo] of texto.matchAll(mesTexto)) {
        const m = meses.indexOf(nome) + 1
        const a = proximo ? ano + 1 : Number(anoTexto) || ano + Number(m < mes)
        incluir(dia ? a + '-' + String(m).padStart(2, '0') + '-' + dia.padStart(2, '0') : fimMes(a, m))
    }
    const relativo = texto.match(/\b(?:em|daqui a|dentro de)\s+(\d{1,3})\s+(mes(?:es)?|anos?)\b/)
    if (relativo) {
        const ultimoDia = fimMes(ano, mes + Number(relativo[1]) * (relativo[2].startsWith('ano') ? 12 : 1))
        incluir(ultimoDia.slice(0, 8) + String(Math.min(diaHoje, Number(ultimoDia.slice(8)))).padStart(2, '0'))
    }
    if (/\b(?:final|fim) d[oe] (?:proximo ano|ano que vem)\b/.test(texto)) incluir(fimMes(ano + 1, 12))
    else if (/\b(?:final|fim) d[oe] (?:deste ano|este ano|ano)\b/.test(texto)) incluir(fimMes(ano, 12))
    if (/\bproximo mes\b/.test(texto)) incluir(fimMes(ano, mes + 1))
    const ambigua = resultados.size > 1 || (!resultados.size && /\b(?:proximo ano|ano que vem|ate \d{4})\b/.test(texto))
    return { data: resultados.size === 1 ? [...resultados][0] : null, ambigua }
}

module.exports = { dataLocal, dataValida, prazoDaMeta, resolverData }
