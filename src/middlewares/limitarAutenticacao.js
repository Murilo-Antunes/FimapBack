const { rateLimit } = require('express-rate-limit')

module.exports = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        sucesso: false,
        codigo: 'LIMITE_AUTENTICACAO',
        mensagem: 'Muitas tentativas. Aguarde antes de tentar novamente.'
    }
})
