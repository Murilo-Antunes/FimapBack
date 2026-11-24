// Usa os dados da conta para estimar quanto sobra por mês.
const { diaISO, normalizarTexto } = require('./financialContextSelection.js')
const { obterDataBrasilia } = require('./dashboardService.js')
const { campoValido, centavos } = require('./planningCatalog.js')

const brl = (item) => item.moeda === 'BRL'
const conhecido = (valor) => typeof valor === 'number' && Number.isFinite(valor)
const completo = (fonte) => fonte.disponivel && !fonte.parcial
const reais = (valor) => valor / 100
const somar = (itens, campo) => itens.reduce((soma, item) => soma + centavos(item[campo]), 0)
const nomes = { contas: 'contas', movimentacao: 'movimentação', cartoes: 'cartões', faturas: 'faturas',
    investimentos: 'investimentos', emprestimos: 'créditos', metas: 'metas FIMAP' }
const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

function classificar(tx) {
    const categoria = normalizarTexto(String(tx.categoria ?? ''))
    const operacao = normalizarTexto(String(tx.operacao ?? '')).replaceAll('_', ' ')
    if (/\b(?:entre contas proprias|transferencia propria|own account transfer)\b/.test(categoria + ' ' + operacao))
        return 'propria'
    if (tx.valor > 0 && /\b(?:salario|salarios|salary|payroll|pro labore|aposentadoria|pension)\b/.test(categoria))
        return 'renda'
    if (tx.valor < 0 && /\b(?:pagamento (?:de )?(?:fatura|cartao)|credit card payment)\b/.test(categoria + ' ' + operacao))
        return 'fatura'
    if (tx.valor < 0 && /\b(?:prestacao|parcela|pagamento) (?:de )?(?:emprestimo|financiamento)|loan payment\b/.test(categoria + ' ' + operacao))
        return 'credito'
    return tx.valor < 0 ? 'despesa' : 'entrada_avulsa'
}

function mesesDoPeriodo(periodo) {
    const data = new Date(periodo.inicio)
    const meses = new Map()
    while (data < periodo.fim) {
        meses.set(diaISO(data).slice(0, 7), { renda: 0, despesa: 0, evidencia: false })
        data.setUTCMonth(data.getUTCMonth() + 1)
    }
    return meses
}

function estimarFluxo(fontes, periodo) {
    const meses = mesesDoPeriodo(periodo)
    const faturas = fontes.faturas.dados.filter(brl)
    const emprestimos = fontes.emprestimos.dados.filter(brl)
    const ativos = emprestimos.filter((item) => item.status !== 'QUITADO')
    const parcelasPagas = emprestimos.flatMap((item) => (item.parcelas ?? [])
        .filter((p) => p.status === 'PAGA' && conhecido(p.valor) && (p.dataPagamento || p.vencimento))
        .map((p) => ({ valorTotal: p.valor, vencimento: String(p.dataPagamento ?? p.vencimento).slice(0, 10) })))
    const temDebitoCorrespondente = (candidatos, valor, data) => {
        const indice = candidatos.findIndex((item) => centavos(item.valorTotal) === -centavos(valor) &&
            Math.abs(Date.parse(item.vencimento) - Date.parse(data)) <= 7 * 86400000)
        if (indice < 0) return false
        candidatos.splice(indice, 1)
        return true
    }
    let conciliado = true
    const faturasNaoConciliadas = [...faturas]
    const vistas = new Set()
    for (const tx of fontes.movimentacao.dados) {
        if (!tx.bancaria || !brl(tx) || !conhecido(tx.valor)) continue
        if (tx.id && vistas.has(tx.id)) continue
        if (tx.id) vistas.add(tx.id)
        const data = obterDataBrasilia(tx)
        const dia = data && diaISO(data)
        const mes = dia && meses.get(dia.slice(0, 7))
        if (!mes) continue
        mes.evidencia = true
        const tipo = classificar(tx)
        if (tipo === 'renda') mes.renda += centavos(tx.valor)
        if (tipo === 'despesa' || tipo === 'fatura' || tipo === 'credito') {
            const possivelFatura = tipo === 'fatura' && temDebitoCorrespondente(faturasNaoConciliadas, tx.valor, dia)
            const possivelParcela = tipo === 'credito' && temDebitoCorrespondente(parcelasPagas, tx.valor, dia)
            if ((tipo === 'fatura' && !possivelFatura) || (tipo === 'credito' && !possivelParcela)) conciliado = false
            if (!possivelFatura && !possivelParcela) mes.despesa -= centavos(tx.valor)
        }
    }
    for (const fatura of faturas) {
        const mes = meses.get(fatura.vencimento.slice(0, 7))
        if (mes) mes.despesa += Math.max(0, centavos(fatura.valorTotal))
    }
    // Uma fatura paga sem débito correspondente pode ter sido paga por uma conta fora da cobertura.
    if (faturasNaoConciliadas.some(({ situacao, valorTotal }) => situacao === 'paga' && valorTotal > 0)) conciliado = false
    if (parcelasPagas.some(({ vencimento, valorTotal }) => meses.has(vencimento.slice(0, 7)) && valorTotal > 0)) conciliado = false
    const rendas = [...meses.values()].map(({ renda }) => renda)
    const renda = Math.min(...rendas)
    const irregular = renda <= 0 || Math.max(...rendas) > renda * 1.25
    const despesas = Math.max(...[...meses.values()].map(({ despesa }) => despesa))
    const parcelas = completo(fontes.emprestimos) && ativos.every((item) => item.mensal && conhecido(item.parcelaMensal) && item.parcelaMensal > 0)
        ? somar(ativos, 'parcelaMensal') : null
    const suficiente = ['contas', 'movimentacao', 'cartoes', 'faturas', 'emprestimos'].every((nome) => completo(fontes[nome])) &&
        [...meses.values()].every(({ evidencia }) => evidencia) && conciliado && !irregular && parcelas !== null
    return { suficiente, renda, despesas, parcelas, irregular, conciliado }
}

function contratoIdentificado(emprestimos, mensagens) {
    for (const { role, content } of [...mensagens].reverse()) {
        if (role !== 'user') continue
        const texto = normalizarTexto(content)
        if (!/\bcontrato\b/.test(texto)) continue
        const identificador = texto.match(/\bcontrato\s+(?:(?:n(?:umero)?[º°.]?|id)\s*[:#]?\s*)?([a-z0-9./-]*\d[a-z0-9./-]*)/i)?.[1]
        const termo = texto.match(/\bcontrato\s+["“]([^"”]+)["”]/)?.[1]
        if (!identificador && !termo) continue
        const encontrados = emprestimos.filter((item) => brl(item) && item.status !== 'QUITADO' &&
            (identificador ? [item.id, item.numeroContrato].some((id) => typeof id === 'string' && normalizarTexto(id) === identificador)
                : typeof item.nome === 'string' && normalizarTexto(item.nome) === termo))
        if (encontrados.length !== 1) return {}
        const item = encontrados[0]
        const dados = { saldo_devedor: item.saldoDevedor, prazo: item.mensal ? item.parcelasRestantes : null,
            taxa: item.taxaEfetivaAnual, sistema_calculo: item.sistemaCalculo }
        return Object.fromEntries(Object.entries(dados).filter(([campo, valor]) => campoValido('amortizacao', campo, valor, [])))
    }
    return {}
}

function projetar(fontes, metas, periodo, hoje, mensagens, conexoes) {
    const conectadas = Object.values(fontes).some(({ disponivel }) => disponivel)
    const fontesDisponiveis = Object.keys(fontes).filter((nome) => fontes[nome].disponivel)
    if (Array.isArray(metas)) fontesDisponiveis.push('metas')
    const contexto = { moeda: 'BRL', periodo: { inicio: diaISO(periodo.inicio), fim_exclusivo: diaISO(periodo.fim) },
        cobertura: conectadas ? 'parcial' : 'indisponivel', fontes: fontesDisponiveis }
    const moedaSemConversao = Object.values(fontes).some(({ dados }) => dados.some((item) => !brl(item)))
    const fluxo = estimarFluxo(fontes, periodo)
    const metasAtivas = metas?.filter((meta) => Number(meta.status) === 1 && Number(meta.valor_total) < Number(meta.valor_desejado))
    const aportes = metasAtivas?.every((m) => m.aporte_mensal != null && Number.isFinite(Number(m.aporte_mensal)) && Number(m.aporte_mensal) >= 0)
        ? metasAtivas.reduce((soma, m) => soma + centavos(Number(m.aporte_mensal)), 0) : null
    if (aportes !== null) contexto.aportes_metas_mensais = reais(aportes)

    for (const [nome, campo, chave] of [
        ['contas', 'saldoLiquido', 'saldo_liquido_disponivel'],
        ['investimentos', 'valorResgatavel', 'investimentos_liquidos_disponiveis'],
        ['emprestimos', 'saldoDevedor', 'saldo_devedor_total']
    ]) {
        const fonte = fontes[nome]
        if (completo(fonte) && fonte.dados.every((item) => brl(item) && conhecido(item[campo]) && item[campo] >= 0))
            contexto[chave] = reais(somar(fonte.dados, campo))
    }
    const suficiente = fluxo.suficiente && !moedaSemConversao && aportes !== null
    if (suficiente) {
        const margem = Math.ceil(fluxo.renda / 20)
        const compromissos = fluxo.parcelas + aportes
        Object.assign(contexto, {
            renda_recorrente_mensal: reais(fluxo.renda), despesas_recorrentes_mensais: reais(fluxo.despesas),
            compromissos_mensais: reais(compromissos), margem_seguranca_mensal: reais(margem),
            capacidade_aporte_mensal: reais(Math.max(0, fluxo.renda - fluxo.despesas - compromissos - margem)),
            cobertura: Object.values(fontes).every(completo) ? 'suficiente' : 'parcial'
        })
    }
    const lista = fontesDisponiveis.map((nome) => nomes[nome]).join(', ') || 'nenhuma'
    const base = 'Referência ' + hoje + ', meses ' + contexto.periodo.inicio.slice(0, 7) + ' a ' +
        diaISO(new Date(periodo.fim.getTime() - 86400000)).slice(0, 7) + '. Fontes disponíveis: ' + lista +
        '. Cobertura ' + contexto.cobertura + '.'
    const vazias = Object.keys(fontes).filter((nome) => completo(fontes[nome]) && !fontes[nome].dados.length)
    if (Array.isArray(metas) && !metas.length) vazias.push('metas')
    const metodo = suficiente
        ? 'Menor renda recorrente e maior despesa mensal observadas, descontando parcelas, metas ativas e margem de 5% da renda (' +
            dinheiro.format(contexto.margem_seguranca_mensal) + ').'
        : [
            Array.isArray(conexoes) && !conexoes.length ? 'Sem conexão ativa autorizada.' : '',
            moedaSemConversao ? 'Há valores sem conversão validada para BRL.' : '',
            conectadas && fluxo.irregular ? 'Renda recorrente irregular ou sem três meses de evidência.' : '',
            !fluxo.conciliado ? 'Há pagamentos sem conciliação suficiente.' : '',
            'Capacidade mensal sem estimativa.'
        ].filter(Boolean).join(' ')
    return { contexto, base: base + (vazias.length ? ' Sem registros: ' + vazias.map((nome) => nomes[nome]).join(', ') + '.' : ''),
        metodo, contrato: contratoIdentificado(fontes.emprestimos.dados, mensagens) }
}

function projetarCredito(fonte, hoje, mensagens) {
    const cobertura = completo(fonte) ? 'suficiente' : fonte.disponivel ? 'parcial' : 'indisponível'
    const contrato = contratoIdentificado(fonte.dados, mensagens)
    const base = 'Referência ' + hoje + '. Consulta de créditos autorizados com cobertura ' + cobertura + '.' +
        (completo(fonte) && !fonte.dados.length ? ' Sem contratos na fonte consultada.' : '')
    return { contexto: null, contrato, base }
}

module.exports = { projetar, projetarCredito }
