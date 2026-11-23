const pluggyService = require('../services/pluggyService.js')

const autorizarItemFinanceiro = async (req, res, next) => {
    const caminho = (req.originalUrl || req.url).split('?')[0]
    const itemDaRota = caminho.match(/\/financeiro\/(?:contas|investimentos|emprestimos|transacoes|saldo)\/([^/]+)/)?.[1] ??
        caminho.match(/\/financeiro\/cartoes\/([^/]+)$/)?.[1]
    const itemId = req.params?.itemId ?? req.query?.itemId ?? itemDaRota
    if (typeof itemId !== 'string' || itemId.length === 0) {
        return res.status(400).json({ sucesso: false, mensagem: 'Informe o itemId.' })
    }

    try {
        const item = await pluggyService.validarItemDoUsuario(itemId, req.usuario.id)
        if (!item) {
            return res.status(404).json({ sucesso: false, mensagem: 'Conexão não encontrada.' })
        }
        req.itemFinanceiroAutorizado = itemId
        return next()
    } catch (error) {
        console.error('Erro ao validar proprietário da conexão financeira:', error)
        return res.status(502).json({ sucesso: false, mensagem: 'Não foi possível validar a conexão financeira.' })
    }
}

module.exports = autorizarItemFinanceiro
