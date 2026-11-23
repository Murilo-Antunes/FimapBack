const router = require('express').Router()
const db = require('../../model/Database_config_knex/connection.js')
const { table, active, connections } = require('../services/financialRecommendationsService.js')

const fields = ['id', 'titulo', 'mensagem', 'acao', 'area', 'expira_ms']
const serialize = ({ expira_ms, ...record }) => ({ ...record, expiraEm: Number(expira_ms) })

router.use(require('../middlewares/autorization.js'))
router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
})

router.get('/pendente', async (req, res) => {
    const id = req.usuario.id
    const area = req.query.area ?? 'nucleo'
    if (area !== 'nucleo' && area !== 'investimentos') return res.status(400).json({ mensagem: 'Área inválida.' })
    try {
        const now = Date.now()
        const item = await active(db(connections)).where('id_usuario', id).first('id')
        const rows = item ? await db(table).where({ id_usuario: id, area }).where('expira_ms', '>', now)
            .whereNull('dispensada_em').orderBy('id', 'asc').limit(1).select(fields) : []
        const recomendacoes = rows.map(serialize)
        return res.json({ agora: now, recomendacoes, recomendacao: recomendacoes[0] ?? null })
    } catch {
        return res.status(503).json({ mensagem: 'Recomendações temporariamente indisponíveis.' })
    }
})

router.get('/historico', async (req, res) => {
    const before = req.query.antes
    if (before !== undefined && (typeof before !== 'string' || !/^\d+$/.test(before) ||
        !Number.isSafeInteger(Number(before)) || Number(before) <= 0)) {
        return res.status(400).json({ mensagem: 'Cursor inválido.' })
    }
    try {
        const query = db(table).where({ id_usuario: req.usuario.id }).where('expira_ms', '<=', Date.now())
        if (before !== undefined) query.where('id', '<', Number(before))
        const rows = await query.orderBy('id', 'desc').limit(21).select(fields)
        const page = rows.slice(0, 20)
        return res.json({ recomendacoes: page.map(serialize), proximo: rows.length > 20 ? page.at(-1).id : null })
    } catch {
        return res.status(503).json({ mensagem: 'Histórico temporariamente indisponível.' })
    }
})

router.post('/:id/dispensar', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ mensagem: 'Recomendação inválida.' })
    try {
        await db(table).where({ id, id_usuario: req.usuario.id }).whereNull('dispensada_em')
            .update({ dispensada_em: db.fn.now() })
        return res.sendStatus(204)
    } catch {
        return res.status(503).json({ mensagem: 'Não foi possível atualizar a recomendação.' })
    }
})

module.exports = router
