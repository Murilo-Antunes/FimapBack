// Variáveis de ambiente
require('dotenv').config({
    path: require('path').resolve(__dirname, '../.env')
})

const express = require('express')
const cors = require('cors')

// Rotas
const openFinanceRoutes = require('./routes/openFinanceRoutes.js')
const usuarioRoutes = require('./routes/usuarioRoutes.js')
const simulacoesRoutes = require('./routes/simulacoesRoutes.js')
const metasRoutes = require('./routes/metasRoutes.js')
const configuracoesRoutes = require('./routes/configuracoesRoutes.js')
const badgeRoutes = require('./routes/badgeRoutes.js')
const chatRoutes = require('./routes/chatRoutes.js')
const recommendationRoutes = require('./routes/financialRecommendationsRoutes.js')
const socialRoutes = require('./routes/socialRoutes.js')
const postRoutes = require('./routes/postRoutes.js')
const comentarRoutes = require('./routes/comentarioRoutes.js')
const denunciarRoutes = require('./routes/denunciaRoutes.js')
const curtirRoutes = require('./routes/curtidaRoutes.js')
const seguirSeguidoresRoutes = require('./routes/seguir_seguidoresRoutes.js')
const nivelRoutes = require('./routes/nivelRoutes.js')
const denunciaUsuarioRoutes = require('./routes/denunciaUsuarioRoutes.js')
const notificacaoRoutes = require('./routes/notificacaoRoutes.js')

const sessaoRoutes = require('./routes/sessaoRoutes.js')
const mensagemChatRoutes = require('./routes/mensagemChatRoutes.js')
const chatPublicoController = require('./controller/MensagemChat/PublicChatController.js')
const limitarChat = require('./middlewares/limitarChat.js')


const PORT = process.env.PORT || 8080

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After', 'X-Requisicao-Id']
}

const app = express()

/* ---------------------------- Middlewares ---------------------------- */

app.use(cors(corsOptions))
app.use(express.json({ limit: '192kb' }))
app.use(express.urlencoded({ extended: true }))

/* ------------------------------- Rotas ------------------------------- */

app.get('/ping', (req, res) => {
    return res.status(200).json({ status: 'API funcionando no Render!' })
})

app.get('/health', (req, res) => res.status(200).json({ online: true, servico: 'fimap-api' }))
app.post('/v1/ia/chat-publico', limitarChat, chatPublicoController.conversarPublicamente)
app.use('/v1/ia/chats', mensagemChatRoutes)
app.use('/v1/ia/chat', chatRoutes)
app.use('/v1/ia/recomendacoes', recommendationRoutes)
app.use('/v1/openfinance/usuario', usuarioRoutes)
app.use('/v1/openfinance/metas', metasRoutes)
app.use('/v1/openfinance', openFinanceRoutes)
app.use('/v1/configuracoes', configuracoesRoutes)
app.use('/v1/simulacoes', simulacoesRoutes)
app.use('/v1/notificacoes', notificacaoRoutes)
app.use('/v1/comunidade/social', socialRoutes)
app.use('/v1/comunidade/posts', postRoutes)
app.use('/v1/comunidade/posts/comentario', comentarRoutes)
app.use('/v1/comunidade/curtida', curtirRoutes)
app.use('/v1/comunidade/denuncia', denunciarRoutes)
app.use('/v1/comunidade/badge', badgeRoutes)
app.use('/v1/comunidade/seguir', seguirSeguidoresRoutes)
app.use('/v1/comunidade', nivelRoutes)
app.use('/v1/comunidade/denuncias', denunciaUsuarioRoutes)

/* ----------------------------- Servidor ----------------------------- */

if (require.main === module) {
    const servidor = app.listen(PORT)
    servidor.once('listening', () => {
        console.log(`Servidor rodando na porta ${PORT}`)
        require('./services/financialRecommendationsService.js').start()
    })
    servidor.on('error', (erro) => {
        if (erro.code === 'EADDRINUSE') {
            console.error(`A porta ${PORT} já está em uso. Encerre a outra instância ou defina uma porta diferente em PORT.`)
        } else {
            console.error('Erro ao subir o servidor:', erro)
        }
        process.exit(1)
    })
}

module.exports = app
