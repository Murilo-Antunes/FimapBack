const { createHash } = require('node:crypto')
const db = require('../../model/Database_config_knex/connection.js')
const pluggy = require('./pluggyService.js')

const positions = 'tbl_posicao_recomendacao_ia'
const equityTypes = new Set(['SECURITY', 'EQUITY', 'ETF'])
const alerts = 'tbl_alerta_gasto_ia'
const duration = 12 * 60 * 60 * 1000

async function compare(user, itemId, key, asset, reference, url, token) {
    const value = Math.round(asset.valor * 100)
    if (!Number.isSafeInteger(value) || value < 0 || value > 1e12) return
    const scope = { id_usuario: user, posicao: key }
    const current = { quantidade: asset.quantidade, valor_centavos: value, referencia_ms: reference }
    const previous = await db(positions).where(scope).first()
    if (!previous) {
        await db(positions).insert({ ...scope, ...current }).onConflict(['id_usuario', 'posicao']).ignore()
        return
    }
    const previousReference = Number(previous.referencia_ms)
    if (previousReference >= reference) return

    const before = Number(previous.valor_centavos)
    const change = value - before
    const tipo = change < 0 ? 'queda_posicao' : 'alta_posicao'
    let alert
    const open = await db(alerts).where({ id_usuario: user, area: 'investimentos' }).whereNull('dispensada_em')
        .where('expira_ms', '>', Date.now()).first('id')
    if (!open && Number(previous.quantidade) === asset.quantidade && before > 0 && Math.abs(change) * 100 >= before * 5) {
        const ticker = typeof asset.codigo === 'string' ? asset.codigo.trim().toUpperCase() : ''
        const simbolo = /^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(ticker) ? ticker : undefined
        const response = await fetch(url, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(12000),
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo, simbolo, anteriorCentavos: before, atualCentavos: value,
                comparacao: {
                    posicaoId: key,
                    anterior: { referenciaEm: new Date(previousReference).toISOString(), quantidade: Number(previous.quantidade) },
                    atual: { referenciaEm: new Date(reference).toISOString(), quantidade: asset.quantidade },
                },
            }),
        })
        if (!response.ok) throw new Error('ANALISE_INVESTIMENTO_INDISPONIVEL')
        const { versao, recomendacao } = await response.json()
        if (versao !== 1 || (recomendacao !== null && (recomendacao?.acao !== 'revisar_investimento' ||
            typeof recomendacao.mensagem !== 'string' || recomendacao.mensagem.length > 512))) {
            throw new Error('ANALISE_INVESTIMENTO_INVALIDA')
        }
        alert = recomendacao
    }

    await db.transaction(async (trx) => {
        const userLock = await trx('tbl_usuario').where('id', user).forUpdate().first('id')
        if (!userLock) return
        const active = await trx('tbl_conexao_open_finance').where({
            id_usuario: user, external_connection_id: itemId, status: 1, provedor: 'pluggy',
        }).forUpdate().first('id')
        if (!active) return
        const updated = await trx(positions).where(scope).where('referencia_ms', previousReference).update(current)
        if (!updated || !alert) return
        const now = Date.now()
        if (await trx(alerts).where({ id_usuario: user, area: 'investimentos' }).whereNull('dispensada_em')
            .where('expira_ms', '>', now).forUpdate().first('id')) return
        await trx(alerts).insert({
            id_usuario: user,
            chave: `${change < 0 ? 'queda' : 'alta'}:${key}:${reference}`,
            mes: new Date(now).toISOString().slice(0, 7),
            categoria: key,
            area: 'investimentos',
            expira_ms: now + duration,
            titulo: `${change < 0 ? 'Queda' : 'Alta'} na posição de ${String(asset.codigo || asset.nome || 'ativo').slice(0, 75)}`,
            mensagem: alert.mensagem,
            acao: alert.acao,
        }).onConflict(['id_usuario', 'chave']).ignore()
    })
}

async function analyzeInvestments(user, items, now, url, token) {
    for (const id of new Set(items)) {
        const connection = await pluggy.validarItemDoUsuario(id, user, now)
        if (!connection || connection.atualizando || connection.parcial) continue
        const snapshot = await pluggy.listarInvestimentos(id, { preservarAusencia: true, validarVinculo: true })
        if (snapshot.atualizando) continue
        for (const asset of snapshot.investimentos) {
            if (!asset.id || !equityTypes.has(asset.tipo) || asset.moeda !== 'BRL' ||
                !Number.isFinite(asset.quantidade) || asset.quantidade <= 0 ||
                !Number.isFinite(asset.valor)) continue
            const reference = new Date(asset.dataSaldo ?? connection.atualizadoEm ?? NaN).getTime()
            if (!Number.isFinite(reference) || reference > now.getTime() || now.getTime() - reference > 7 * 86400000) continue
            const itemKey = createHash('sha256').update(id).digest('hex').slice(0, 16)
            const key = itemKey + createHash('sha256').update(String(asset.id)).digest('hex').slice(0, 48)
            await compare(user, id, key, asset, reference, url, token)
        }
    }
}

module.exports = { analyzeInvestments }
