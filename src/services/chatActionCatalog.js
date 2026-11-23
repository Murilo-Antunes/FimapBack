const { validarDados: investimento } = require('../controller/Simulacoes/SimulacaoInvestimentoController.js')
const { validarDados: amortizacao } = require('../controller/Simulacoes/SimulacaoAmortizacaoController.js')
const { table: recomendacoes, salvarPlanoDoChat } = require('./financialRecommendationsService.js')
const { criarSimulacaoInvestimento } = require('../../model/DAO/Simulacoes/SimulacaoInvestimentoDAO.js')
const { criarSimulacaoAmortizacao } = require('../../model/DAO/Simulacoes/SimulacaoAmortizacaoDAO.js')
const { CreateMeta } = require('../../model/DAO/Metas/MetasDAO.js')

const texto = (limite) => (v) => typeof v === 'string' && Boolean(v.trim()) &&
    [...v.trim()].length <= limite && !/[\p{Cc}\p{Cf}]/u.test(v)
const dinheiro = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 9999999999999.99 &&
    Number(v.toFixed(2)) === v
const positivo = (v) => dinheiro(v) && v > 0
const inteiro = (v) => Number.isInteger(v) && v > 0 && v <= 2147483647
const taxa = (min) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= 999.99 &&
    Number(v.toFixed(2)) === v
const escolha = (...valores) => (v) => valores.includes(v)
const data = (v) => {
    if (typeof v !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)) return false
    const d = new Date(v)
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v
}
const reais = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const valor = (v) => reais.format(v)
const seguro = (v) => String(v).replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&')
const campo = (label, validar, pergunta, formatar = seguro) => ({ label, validar, pergunta, formatar })
const monetario = (label, pergunta, validar = dinheiro) => campo(label, validar, pergunta, valor)
const nome = (limite) => campo('Nome', texto(limite), 'Como você quer chamar esse registro?')
const aporte = monetario('Aporte mensal', 'Quanto você quer aportar por mês?')
const prazo = campo('Prazo', inteiro, 'Qual deve ser o prazo em meses?', (v) => `${v} meses`)
const anual = (label, min, pergunta) => campo(label, taxa(min), pergunta, (v) => `${v}% ao ano`)

const categorias = (trx, usuario) => trx('tbl_categoria_meta')
    .where((q) => q.where('id_usuario', usuario).orWhereNull('id_usuario'))
const categoriaDaMeta = (trx, usuario, nomeCategoria) => categorias(trx, usuario)
    .where('nome', nomeCategoria).orderBy('id').first('id')

const catalogo = {
    meta: {
        label: 'meta financeira', tabela: 'tbl_meta_financeira', destino: 'Metas',
        campos: {
            nome: nome(100),
            valor_desejado: monetario('Valor desejado', 'Quanto você quer juntar para essa meta?', positivo),
            data_alvo: campo('Data-alvo', data, 'Até que data você quer atingir a meta?'),
            valor_inicio: monetario('Valor inicial', 'Quanto você já separou para essa meta?'),
            aporte_mensal: aporte,
            categoria: campo('Categoria', texto(80), 'Em qual categoria você quer guardar a meta?')
        },
        async pronto(trx, r, dados) {
            return await categoriaDaMeta(trx, r.id_usuario, dados.categoria) ? null :
                'Qual categoria existente você quer usar? Essa categoria não está disponível na sua conta.'
        },
        async gravar(trx, r, dados) {
            const { categoria, data_alvo, ...campos } = dados
            const registro = await categoriaDaMeta(trx, r.id_usuario, categoria).forShare()
            if (!registro) return null
            return CreateMeta({ ...campos, id_categoria: registro.id, id_usuario: r.id_usuario,
                data_alvo: new Date(data_alvo + 'T15:00:00Z'), valor_total: dados.valor_inicio, status: 1,
                descricao: null, id_conta_vinculada: null }, { executor: trx, propagarErro: true })
        }
    },
    investimento: {
        label: 'simulação de investimento', tabela: 'tbl_simulacao_investimento', destino: 'Simulações → Investimentos',
        campos: {
            nome: nome(45), aporte_mensal: aporte, prazo,
            valor_inicial: monetario('Valor inicial', 'Com quanto você quer começar a simulação?'),
            rentabilidade: anual('Rentabilidade', -99.99, 'Qual rentabilidade anual devo usar na simulação?')
        },
        async gravar(trx, r, dados) {
            const registro = await criarSimulacaoInvestimento(r.id_usuario, investimento(dados), trx)
            return registro?.id
        }
    },
    amortizacao: {
        label: 'simulação de amortização', tabela: 'tbl_simulacao_amortizacao', destino: 'Simulações → Amortizações',
        campos: {
            nome: nome(45), saldo_devedor: monetario('Saldo devedor', 'Qual é o saldo devedor atual?', positivo),
            aporte_mensal: aporte, prazo, taxa: anual('Taxa', 0, 'Qual é a taxa de juros anual do contrato?'),
            sistema_calculo: campo('Sistema', escolha('SAC', 'PRICE'), 'Seu contrato usa SAC ou Price?'),
            modalidade: campo('Modalidade', escolha('REDUZIR_PRAZO', 'REDUZIR_PARCELA'),
                'Você quer reduzir o prazo ou o valor da parcela?', (v) => v === 'REDUZIR_PRAZO' ? 'Reduzir prazo' : 'Reduzir parcela')
        },
        async gravar(trx, r, dados) {
            const registro = await criarSimulacaoAmortizacao(r.id_usuario, amortizacao(dados, false), trx)
            return registro?.id
        }
    },
    recomendacao: {
        label: 'recomendação financeira', tabela: recomendacoes, destino: 'Recomendações', excluir: false,
        campos: {
            titulo: campo('Título', texto(100), 'Qual título você quer dar à recomendação?'),
            mensagem: campo('Plano', texto(512), 'Que plano ou objetivo você quer desenvolver?'),
            area: campo('Área', escolha('nucleo', 'investimentos'), 'O plano é para o Núcleo Financeiro ou para Investimentos?',
                (v) => v === 'nucleo' ? 'Núcleo Financeiro' : 'Investimentos')
        },
        gravar: salvarPlanoDoChat
    }
}

function classeMeta(alvo, now) {
    const anos = (Date.parse(alvo + 'T15:00:00Z') - now) / (365.25 * 86_400_000)
    return anos < 1 ? 'curto' : anos < 5 ? 'médio' : 'longo'
}

module.exports = { catalogo, categorias, seguro, texto, classeMeta }
