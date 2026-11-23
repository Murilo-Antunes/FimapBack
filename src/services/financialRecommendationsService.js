const cron = require('node-cron')
const { analyzeInvestments } = require('./investmentRecommendationService.js')
const { createHash } = require('node:crypto')
const db = require('../../model/Database_config_knex/connection.js')
const pluggy = require('./pluggyService.js')
const { obterDataBrasilia } = require('./dashboardService.js')

const table = 'tbl_alerta_gasto_ia'
const connections = 'tbl_conexao_open_finance'
const actions = new Set(['revisar_gastos', 'acompanhar_orcamento'])
const dayMs = 86_400_000
const duration = 12 * 60 * 60 * 1000
const iso = (date) => date.toISOString().slice(0, 10)
const brasilia = (date) => new Date(date.getTime() - 3 * 60 * 60 * 1000)
const active = (query) => query.where({ status: 1, provedor: 'pluggy' }).whereNotNull('external_connection_id')

function period(now) {
    const local = brasilia(now)
    const year = local.getUTCFullYear()
    const month = local.getUTCMonth()
    const days = local.getUTCDate() - 1
    const months = Array.from({ length: 4 }, (_, index) => iso(new Date(Date.UTC(year, month - index, 1))).slice(0, 7))
    return { month: months[0], months, days, today: iso(local) }
}

function aggregate(transactions, window) {
    const categories = new Map()
    const earliest = new Map()
    const seen = new Set()
    for (const tx of transactions) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(tx.data)
            ? new Date(`${tx.data}T00:00:00Z`) : obterDataBrasilia(tx)
        if (!tx.id || !date || !Number.isFinite(date.getTime()) || tx.valor == null) return []
        const key = `${tx.contaId}:${tx.id}`
        if (seen.has(key)) continue
        seen.add(key)
        if ((tx.status != null && tx.status !== 'POSTED') || tx.moeda !== 'BRL') continue
        const day = iso(date)
        if (!earliest.has(tx.contaId) || day < earliest.get(tx.contaId)) earliest.set(tx.contaId, day)
        const monthIndex = window.months.indexOf(day.slice(0, 7))
        if (monthIndex < 0 || date.getUTCDate() > window.days || tx.valor >= 0 || typeof tx.categoria !== 'string') continue
        const label = tx.categoria.trim().slice(0, 80)
        if (!label || /transfer|pagamento.*fatura|credit card payment|internal movement/i.test(label)) continue
        const id = createHash('sha256').update(label.toLowerCase()).digest('hex').slice(0, 24)
        if (!categories.has(id)) categories.set(id, { id, label, amounts: [0, 0, 0, 0] })
        categories.get(id).amounts[monthIndex] += Math.round(-tx.valor * 100)
    }

    // Preserve a month as unknown if an observed account has no evidence of history by its first day.
    const comparable = window.months.slice(1).map((month) => {
        const [year, number] = month.split('-').map(Number)
        return window.days <= new Date(Date.UTC(year, number, 0)).getUTCDate() &&
            [...earliest.values()].every((day) => day <= `${month}-01`)
    })
    return [...categories.values()].filter(({ amounts }) => amounts[0] >= 5000)
        .sort((a, b) => b.amounts[0] - a.amounts[0] || a.id.localeCompare(b.id))
        .slice(0, 100)
        .map(({ id, label, amounts }) => ({
            label, id, atualCentavos: amounts[0],
            historicoCentavos: comparable.map((complete, index) => complete ? amounts[index + 1] : null),
        }))
}

function recurringCharges(transactions, window) {
    const groups = new Map()
    const seen = new Set()
    for (const tx of transactions) {
        const transactionId = `${tx.contaId}:${tx.id}`
        if (!tx.contaId || !tx.id || seen.has(transactionId) ||
            (tx.status != null && tx.status !== 'POSTED') || tx.moeda !== 'BRL' ||
            typeof tx.valor !== 'number' || !Number.isFinite(tx.valor) || tx.valor >= 0 ||
            typeof tx.descricao !== 'string') continue
        seen.add(transactionId)
        const name = tx.descricao.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ').trim()
        if (!name) continue
        const label = `${tx.categoria ?? ''} ${name}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
        const servico = /\b(academia|gym|fitness)\b/.test(label) ? 'academia'
            : /\b(internet|banda larga|broadband)\b/.test(label) ? 'internet'
            : /\b(telefonia|plano movel|mobile plan)\b/.test(label) ? 'telefonia'
            : /\b(assinatura|subscription|streaming)\b/.test(label) ? 'assinatura' : null
        if (!servico) continue
        const date = /^\d{4}-\d{2}-\d{2}$/.test(tx.data)
            ? new Date(`${tx.data}T00:00:00Z`) : obterDataBrasilia(tx)
        if (!date || !Number.isFinite(date.getTime())) continue
        const day = iso(date)
        const month = window.months.slice(0, 3).indexOf(day.slice(0, 7))
        if (month < 0 || day > window.today) continue
        const amount = Math.round(-tx.valor * 100)
        if (amount < 1 || amount > 1e12) continue
        const id = createHash('sha256').update(JSON.stringify([tx.contaId, name])).digest('hex').slice(0, 32)
        if (!groups.has(id)) groups.set(id, [[], [], []])
        groups.get(id)[month].push({ date: new Date(`${day}T00:00:00Z`), amount, servico })
    }
    const candidates = []
    for (const [recorrenciaId, groupsByMonth] of groups) {
        if (groupsByMonth.some(month => month.length !== 1)) continue
        const [[current], [previous], [oldest]] = groupsByMonth
        const interval = (moreRecent, older) => (moreRecent.date - older.date) / dayMs
        const validInterval = (days) => days >= 20 && days <= 40
        const difference = Math.abs(current.amount - previous.amount)
        if (current.servico !== previous.servico || previous.servico !== oldest.servico ||
            previous.amount !== oldest.amount || !validInterval(interval(current, previous)) ||
            !validInterval(interval(previous, oldest)) || difference < 500 || difference * 100 < previous.amount * 5) continue
        candidates.push({
            tipo: 'variacao_mensalidade', recorrenciaId, servico: current.servico,
            anteriorCentavos: previous.amount, atualCentavos: current.amount,
            referenciaAnteriorEm: previous.date.toISOString(), referenciaAtualEm: current.date.toISOString(),
        })
    }
    const impact = (row) => Math.abs(row.atualCentavos - row.anteriorCentavos)
    return candidates.sort((a, b) => impact(b) - impact(a) || a.recorrenciaId.localeCompare(b.recorrenciaId))
}

async function readTransactions(items, user, window, now) {
    const from = iso(new Date(Date.parse(`${window.months[3]}-01`) - dayMs))
    const all = []
    const cutoff = Date.parse(`${window.today}T03:00:00Z`)
    for (const id of items) {
        const item = await pluggy.validarItemDoUsuario(id, user, now)
        if (!item || item.atualizando || item.parcial || !(Date.parse(item.atualizadoEm) >= cutoff)) return null
        const accounts = await pluggy.listarContas(id, { preservarAusencia: true, validarVinculo: true })
        if (accounts.atualizando || !Array.isArray(accounts.contas)) return null
        const banks = accounts.contas.filter(({ tipo }) => tipo === 'BANK')
        const response = await pluggy.listarTransacoes(id, {
            resultadoContas: { ...accounts, contas: banks }, dateFrom: from,
            dateTo: window.today, permitirParcial: true, validarVinculo: true,
        })
        if (response.atualizando || response.parcial) return null
        for (const transaction of response.transacoes) all.push(transaction)
    }
    return all
}

async function analyze(user, window, now, url, token) {
    // Mantém uma recomendação de gastos ativa por usuário.
    if (await db(table).where({ id_usuario: user, area: 'nucleo' }).where('expira_ms', '>', Date.now()).whereNull('dispensada_em').first('id')) return
    const items = await active(db(connections)).where('id_usuario', user).orderBy('id').pluck('external_connection_id')
    if (!items.length) return
    const transactions = await readTransactions([...new Set(items)], user, window, now)
    if (!transactions) return
    const categories = aggregate(transactions, window)
    const muted = await db(table).where({ id_usuario: user, area: 'nucleo', mes: window.month }).pluck('categoria')
    const suppressed = new Set(muted)
    const recurring = recurringCharges(transactions, window).find(({ recorrenciaId }) => !suppressed.has(recorrenciaId))
    if (!recurring && (!window.days || !categories.some(({ historicoCentavos }) =>
        historicoCentavos.filter((value) => value !== null).length >= 2))) return
    const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(recurring ?? {
            mes: window.month, diasObservados: window.days,
            categorias: categories.filter(({ id }) => !suppressed.has(id)).map(({ label, ...summary }) => summary),
        }),
    })
    if (!response.ok) throw new Error('WORKER_RECOMENDACAO_INDISPONIVEL')
    const { versao, recomendacao: rec } = await response.json()
    if (versao !== 1) throw new Error('WORKER_RECOMENDACAO_INVALIDA')
    if (rec === null) return
    const category = recurring ?? categories.find(({ id }) => id === rec?.categoriaId && !suppressed.has(id))
    const key = recurring ? `mensalidade:${recurring.recorrenciaId}:${window.month}` : `aumento-gastos:${window.month}:${category?.id}`
    if (!category || rec.chave !== key || !actions.has(rec.acao) ||
        typeof rec.mensagem !== 'string' || rec.mensagem.length > 512 ||
        (recurring && (typeof rec.titulo !== 'string' || rec.titulo.length > 100))) {
        throw new Error('WORKER_RECOMENDACAO_INVALIDA')
    }
    await db.transaction(async (trx) => {
        const userLock = await trx('tbl_usuario').where('id', user).forUpdate().first('id')
        if (!userLock) return
        const current = await active(trx(connections)).where('id_usuario', user).orderBy('id').forUpdate().pluck('external_connection_id')
        if (JSON.stringify(current) !== JSON.stringify(items)) return
        if (await trx(table).where({ id_usuario: user, area: 'nucleo' }).where('expira_ms', '>', Date.now()).whereNull('dispensada_em').forUpdate().first('id')) return
        await trx(table).insert({
            id_usuario: user, chave: rec.chave, mes: window.month, categoria: recurring?.recorrenciaId ?? category.id,
            area: 'nucleo', expira_ms: Date.now() + duration,
            titulo: recurring ? rec.titulo : `Aumento de gastos: ${category.label}`, mensagem: rec.mensagem, acao: rec.acao,
        }).onConflict(['id_usuario', 'chave']).ignore()
    })
}

async function salvarPlanoDoChat(trx, pedido, dados, now) {
    const [id] = await trx(table).insert({
        ...dados, id_usuario: pedido.id_usuario, chave: `chat:${pedido.requisicao_id}`,
        mes: brasilia(new Date(now)).toISOString().slice(0, 7), categoria: 'plano_chat',
        acao: 'revisar_gastos', expira_ms: 0
    })
    return id
}

function start() {
    const url = process.env.FIMAP_RECOMMENDATION_URL
    const token = process.env.RECOMMENDATION_API_TOKEN
    if (!url || !token) return
    let running = false
    const run = async () => {
        if (running) return
        running = true
        try {
            const now = new Date()
            const window = period(now)
            let cursor = 0
            for (;;) {
                const users = await active(db(connections)).distinct().where('id_usuario', '>', cursor)
                    .orderBy('id_usuario').limit(50).pluck('id_usuario')
                if (!users.length) break
                for (const user of users) {
                    try {
                        await analyze(user, window, now, url, token)
                    } catch {
                        console.error('Falha ao processar recomendação de gastos.')
                    }
                    try {
                        const items = await active(db(connections)).where('id_usuario', user).pluck('external_connection_id')
                        await analyzeInvestments(user, items, now, url, token)
                    } catch {
                        console.error('Falha ao processar recomendação de investimentos.')
                    }
                }
                cursor = users.at(-1)
            }
        } catch {
            console.error('Falha ao executar rotina de recomendações.')
        } finally {
            running = false
        }
    }
    cron.schedule('*/15 * * * *', run, { timezone: 'America/Sao_Paulo', noOverlap: true })
    void run()
}

module.exports = { table, active, connections, period, recurringCharges, analyze, salvarPlanoDoChat, start }
