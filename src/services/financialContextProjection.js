/*
 * Transforma os dados consultados em totais e detalhes selecionados para a IA.
 * Reaproveita os cálculos do painel e do extrato para manter os valores
 * de receitas, despesas e faturas alinhados aos exibidos no site.
 */

const painel = require('./dashboardService.js')
const { somarFatura, dataISO10 } = require('./extratoCartao/extratoCartaoMapper.js')
const { diaISO, normalizarTexto } = require('./financialContextSelection.js')

const LIMITE_DETALHES = 8
const TIPOS_INVESTIMENTO = new Set(['MUTUAL_FUND', 'SECURITY', 'EQUITY', 'COE', 'FIXED_INCOME', 'ETF', 'OTHER'])
const ESTADOS_FATURA = ['aberta', 'fechada', 'paga']
const ESTADOS_PARCELA = ['PAGA', 'PENDENTE', 'AMORTIZADA']

const numero = (valor) => {
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null
    const convertido = Number(valor)
    return Number.isFinite(convertido) ? convertido : null
}
const arredondar = (valor) => valor == null ? null : Number(valor.toFixed(2))
const moedaDe = (item) => typeof item.moeda === 'string' && /^[A-Z]{3}$/.test(item.moeda) ? item.moeda : 'BRL'
const codigoSeguro = (valor, permitidos) => permitidos.includes(valor) ? valor : null
const dataCivil = (valor) => valor instanceof Date && Number.isFinite(valor.getTime()) ? diaISO(valor) : dataISO10(valor)
const total = (itens, campo) => arredondar(itens.reduce((soma, item) => soma + (numero(item[campo]) ?? 0), 0))
const totalConhecido = (itens, campo) => itens.some((item) => numero(item[campo]) !== null) ? total(itens, campo) : null
const ordenarMoedas = (moedas) => [...moedas].sort((a, b) => a === 'BRL' ? -1 : b === 'BRL' ? 1 : a.localeCompare(b))

function porMoeda(itens, calcular) {
    const grupos = Map.groupBy(itens, moedaDe)
    return ordenarMoedas(grupos.keys()).map((moeda) => ({ moeda, ...calcular(grupos.get(moeda)) }))
}

function detalhes(itens, formatar) {
    return {
        detalhes: itens.slice(0, LIMITE_DETALHES).map(formatar),
        detalhesTruncados: itens.length > LIMITE_DETALHES
    }
}

function movimentos(transacoes) {
    const totais = painel.totalizarMovimentacao(transacoes)
    return { quantidade: transacoes.length, receitas: arredondar(totais.receita), despesas: arredondar(totais.despesa) }
}

function contas(contasBancarias, transacoes) {
    return {
        porMoeda: porMoeda(contasBancarias, (itens) => ({ quantidade: itens.length, saldo: totalConhecido(itens, 'saldo') })),
        ...(transacoes && { movimentacaoBancaria: porMoeda(transacoes, movimentos) }),
        ...detalhes(contasBancarias, (conta) => ({
            instituicao: conta.instituicaoOrdem,
            moeda: moedaDe(conta),
            saldo: arredondar(numero(conta.saldo))
        }))
    }
}

function movimentacao(transacoes) {
    return {
        porMoeda: porMoeda(transacoes, movimentos),
        porMoedaContasBancarias: porMoeda(transacoes.filter((transacao) => transacao.bancaria), movimentos),
        ...ultimasTransacoes(transacoes)
    }
}

function ultimasTransacoes(transacoes) {
    const recentes = painel.obterUltimasTransacoes(transacoes, LIMITE_DETALHES + 1)
    return detalhes(recentes, (transacao) => ({
        data: diaISO(painel.obterDataBrasilia(transacao)),
        tipo: painel.obterTipoTransacao(transacao),
        valor: arredondar(numero(transacao.valor)),
        moeda: moedaDe(transacao),
        origem: transacao.bancaria ? 'conta_bancaria' : 'outro_produto'
    }))
}

function nucleoFinanceiro(contas) {
    const nucleo = painel.calcularNucleoFinanceiro(contas)
    return {
        quantidadeContas: nucleo.quantidadeContas,
        quantidadeInstituicoes: nucleo.instituicoes.length,
        quantidadeConexoesBancarias: new Set(contas.map(({ instituicaoOrdem }) => instituicaoOrdem)).size,
        ...detalhes(nucleo.instituicoes, (nome) => String(nome).slice(0, 80))
    }
}

function simulacoes(investimentos, amortizacoes, limitePorTipo) {
    const base = (item) => ({
        nome: String(item.nome ?? '').slice(0, 45),
        aporteMensal: numero(item.aporte_mensal),
        prazoMeses: numero(item.prazo),
        criacao: dataCivil(item.data_criacao)
    })
    return {
        fontes: {
            investimentos: investimentos ? (investimentos.length ? 'ok' : 'sem_dados') : 'indisponivel',
            amortizacoes: amortizacoes ? (amortizacoes.length ? 'ok' : 'sem_dados') : 'indisponivel'
        },
        detalhes: [
            ...(investimentos ?? []).slice(0, limitePorTipo).map((item) => ({
                tipo: 'investimento', ...base(item), valorInicial: numero(item.valor_inicial),
                rentabilidadeAnualPercentual: numero(item.rentabilidade)
            })),
            ...(amortizacoes ?? []).slice(0, limitePorTipo).map((item) => ({
                tipo: 'amortizacao', ...base(item), saldoDevedor: numero(item.saldo_devedor),
                taxaAnualPercentual: numero(item.taxa),
                sistema: codigoSeguro(item.sistema_calculo, ['SAC', 'PRICE']),
                modalidade: codigoSeguro(item.modalidade, ['REDUZIR_PRAZO', 'REDUZIR_PARCELA'])
            }))
        ],
        detalhesTruncados: [investimentos, amortizacoes].some((itens) => itens?.length > limitePorTipo)
    }
}

function cartoes(itens) {
    return {
        porMoeda: porMoeda(itens, (grupo) => {
            const painelCartoes = painel.calcularCartoes(grupo)
            return {
                quantidade: grupo.length,
                limiteTotal: totalConhecido(grupo, 'limite'),
                limiteDisponivel: totalConhecido(grupo, 'limiteDisponivel'),
                faturaAberta: grupo.some((cartao) => numero(cartao.faturaAberta) !== null) ? arredondar(painelCartoes.faturaAberta) : null
            }
        }),
        ...detalhes(itens, (cartao) => ({
            instituicao: cartao.instituicaoOrdem,
            moeda: moedaDe(cartao),
            limiteTotal: arredondar(numero(cartao.limite)),
            limiteDisponivel: arredondar(numero(cartao.limiteDisponivel)),
            vencimentoAtual: dataISO10(cartao.dataVencimentoFatura)
        }))
    }
}

function faturaDoPeriodo(extrato, cartao, periodo) {
    const { fatura } = extrato
    const vencimento = dataISO10(fatura?.vencimento)
    const valorTotal = numero(fatura?.valorTotal)
    if (vencimento === null || valorTotal === null) return null
    if (vencimento < diaISO(periodo.inicio) || vencimento >= diaISO(periodo.fim)) return false

    const lancamentos = extrato.lancamentos ?? []
    return {
        instituicao: cartao.instituicaoOrdem,
        moeda: moedaDe(cartao),
        vencimento,
        situacao: codigoSeguro(fatura.status, ESTADOS_FATURA),
        valorTotal: arredondar(valorTotal),
        comprasLiquidas: somarFatura(lancamentos),
        compras: total(lancamentos.filter(({ tipo }) => tipo === 'compra'), 'valor'),
        estornos: total(lancamentos.filter(({ tipo }) => tipo === 'estorno'), 'valor')
    }
}

function faturas(itens) {
    return {
        porMoeda: porMoeda(itens, (grupo) => ({
            quantidade: grupo.length,
            valorTotal: total(grupo, 'valorTotal'),
            comprasLiquidas: total(grupo, 'comprasLiquidas'),
            compras: total(grupo, 'compras'),
            estornos: total(grupo, 'estornos')
        })),
        ...detalhes(itens, (fatura) => fatura)
    }
}

function investimentos(itens) {
    const carteira = itens.map((item) => ({ ...item, tipo: TIPOS_INVESTIMENTO.has(item.tipo) ? item.tipo : 'OTHER' }))
    return {
        porMoeda: porMoeda(carteira, (grupo) => {
            const resumo = painel.calcularInvestimentos(grupo)
            return {
                quantidade: resumo.quantidade,
                valorAtual: totalConhecido(grupo, 'valor'),
                valorAplicado: totalConhecido(grupo, 'valorAplicado'),
                porTipo: Object.fromEntries(Object.keys(resumo.porCategoria).map((tipo) => [tipo,
                    totalConhecido(grupo.filter((item) => item.tipo === tipo), 'valor')]))
            }
        }),
        ...detalhes(carteira, (item) => ({
            instituicao: item.instituicaoOrdem,
            tipo: item.tipo,
            moeda: moedaDe(item),
            valorAtual: arredondar(numero(item.valor)),
            valorAplicado: arredondar(numero(item.valorAplicado)),
            dataSaldo: dataISO10(item.dataSaldo)
        }))
    }
}

function cronogramaNoPeriodo(emprestimo, periodo) {
    const inicio = diaISO(periodo.inicio), fim = diaISO(periodo.fim)
    return (emprestimo.parcelas ?? []).flatMap((parcela) => {
        const vencimento = dataISO10(parcela.vencimento)
        const valor = numero(parcela.valor)
        const situacao = codigoSeguro(parcela.status, ESTADOS_PARCELA)
        if (!vencimento || vencimento < inicio || vencimento >= fim || valor === null || !situacao) return []
        return [{ vencimento, valor: arredondar(valor), situacao, moeda: moedaDe(emprestimo) }]
    })
}

function emprestimos(itens, periodo) {
    return {
        porMoeda: porMoeda(itens, (grupo) => {
            const resumo = painel.calcularEmprestimos(grupo)
            const parcelas = grupo.flatMap((item) => cronogramaNoPeriodo(item, periodo))
            return {
                quantidade: resumo.quantidade,
                saldoDevedor: totalConhecido(grupo, 'saldoDevedor'),
                parcelaMensalEstimada: totalConhecido(grupo, 'parcelaMensal'),
                parcelasPagasNoPeriodo: total(parcelas.filter(({ situacao }) => situacao === 'PAGA'), 'valor'),
                parcelasPendentesNoPeriodo: total(parcelas.filter(({ situacao }) => situacao === 'PENDENTE'), 'valor'),
                amortizacoesNoPeriodo: total(parcelas.filter(({ situacao }) => situacao === 'AMORTIZADA'), 'valor')
            }
        }),
        ...detalhes(itens.flatMap((item) => cronogramaNoPeriodo(item, periodo)), (parcela) => parcela)
    }
}

function patrimonio(origens) {
    const tipos = ['contas', 'cartoes', 'investimentos', 'emprestimos']
    const moedas = new Set(tipos.flatMap((tipo) => origens[tipo].dados.map(moedaDe)))
    const campos = ['saldoContas', 'faturaAberta', 'totalInvestido', 'saldoDevedor']
    return {
        porMoeda: ordenarMoedas(moedas).map((moeda) => {
            const grupos = Object.fromEntries(tipos.map((tipo) => [tipo, origens[tipo].dados.filter((item) => moedaDe(item) === moeda)]))
            const resumo = painel.calcularPatrimonio(grupos)
            const medidas = ['saldo', 'faturaAberta', 'valor', 'saldoDevedor']
            const componentes = Object.fromEntries(campos.map((campo, indice) => {
                const tipo = tipos[indice]
                const itens = grupos[tipo]
                const conhecido = origens[tipo].disponivel &&
                    (itens.length ? itens.some((item) => numero(item[medidas[indice]]) !== null) : !origens[tipo].parcial)
                return [campo, conhecido ? arredondar(resumo[campo]) : null]
            }))
            const faltamValores = tipos.some((tipo, indice) => grupos[tipo].some((item) => numero(item[medidas[indice]]) === null))
            const completo = !faltamValores && tipos.every((tipo) => origens[tipo].disponivel && !origens[tipo].parcial)
            return { moeda, ...componentes, patrimonioLiquido: completo ? arredondar(resumo.patrimonioLiquido) : null }
        })
    }
}

function metas(itens, assunto) {
    const selecionadas = itens.filter((meta) => {
        const nome = normalizarTexto(String(meta.nome ?? '')).trim()
        return nome.length >= 3 && (` ${assunto.replace(/[^a-z0-9 ]/g, ' ')} `).includes(` ${nome} `)
    })
    const visiveis = selecionadas.length ? selecionadas : itens
    return {
        quantidade: visiveis.length,
        selecionadasPorNome: selecionadas.length > 0,
        acumulado: totalConhecido(visiveis, 'valor_total'),
        objetivo: totalConhecido(visiveis, 'valor_desejado'),
        ...detalhes(visiveis, (meta) => {
            const valor = numero(meta.valor_total), objetivo = numero(meta.valor_desejado)
            return {
                ordem: itens.indexOf(meta) + 1,
                acumulado: arredondar(valor),
                objetivo: arredondar(objetivo),
                aporteMensal: arredondar(numero(meta.aporte_mensal)),
                situacao: codigoSeguro(meta.status, [0, 1]),
                dataAlvo: dataCivil(meta.data_alvo),
                progressoPercentual: valor === null || objetivo === null ? null :
                    objetivo <= 0 ? 0 : Math.min(Math.round((valor / objetivo) * 100), 100)
            }
        })
    }
}

function comprometimento(movimentos, contasCartao, emprestimosPeriodo) {
    const temCobertura = (modulo) => ['ok', 'sem_dados'].includes(modulo.estado)
    const completas = [movimentos, contasCartao, emprestimosPeriodo].every(temCobertura)
    const valores = ({ dados }) => dados?.porMoeda ?? []
    const entradasBancarias = movimentos.dados?.porMoedaContasBancarias ?? []
    const moedas = new Set([...entradasBancarias, ...valores(contasCartao), ...valores(emprestimosPeriodo)].map(({ moeda }) => moeda))
    const grupo = (modulo, moeda) => valores(modulo).find((valor) => valor.moeda === moeda)
    return {
        porMoeda: ordenarMoedas(moedas).map((moeda) => {
            const receita = entradasBancarias.find((grupo) => grupo.moeda === moeda)?.receitas ?? null
            const faturas = grupo(contasCartao, moeda)?.valorTotal ?? (temCobertura(contasCartao) ? 0 : null)
            const parcelas = grupo(emprestimosPeriodo, moeda)
            const pagas = parcelas?.parcelasPagasNoPeriodo ?? (temCobertura(emprestimosPeriodo) ? 0 : null)
            const pendentes = parcelas?.parcelasPendentesNoPeriodo ?? (temCobertura(emprestimosPeriodo) ? 0 : null)
            const totalComprometido = completas ? arredondar(faturas + pagas + pendentes) : null
            return { moeda, receita, faturas, parcelasPagas: pagas, parcelasPendentesEstimadas: pendentes,
                totalComprometido, percentualDaReceita: receita > 0 && totalComprometido !== null ? arredondar(totalComprometido / receita * 100) : null }
        })
    }
}

module.exports = { contas, movimentacao, ultimasTransacoes, nucleoFinanceiro, simulacoes, cartoes, faturas, faturaDoPeriodo, investimentos, emprestimos, patrimonio, metas, comprometimento }
