const config_message = require('../modulo/configMensagens.js')
const badgeProgressoDAO = require('../../../model/DAO/Badge/badgeProgressoDAO.js')

const idValido = (id) => Number.isInteger(id) && id > 0

const responder = (res, status, sucesso, mensagem, extra = {}) =>
    res.status(status).json({ sucesso, mensagem, ...extra })

// GET /badge-usuario/progresso/:id_usuario
// Devolve só as badges bloqueadas que têm criterio_tipo reconhecido
// (ver badgeProgressoDAO.js). Badges sem criterio_tipo, ou com um tipo que
// ainda não tem calculadora implementada, simplesmente não aparecem aqui —
// o front trata isso como "badge bloqueada sem progresso".
const buscarProgresso = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responder(res, 400, false, 'Id de usuário inválido.')
        }

        const badges = await badgeProgressoDAO.CalcularProgresso(id_usuario)

        return responder(res, 200, true, 'Progresso calculado.', { quantidade: badges.length, badges })
    } catch (error) {
        console.error('Erro ao calcular progresso de badges:', error)
        return responder(res, 500, false, (config_message.ERRO_INTERNO || {}).mensagem || 'Erro interno do servidor.')
    }
}

module.exports = { buscarProgresso }
