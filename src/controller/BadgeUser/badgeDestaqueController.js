const config_message = require('../modulo/configMensagens.js')
const badgeDestaqueDAO = require('../../../model/DAO/Badge/badgeDestaqueDAO.js')

// Máximo de badges em destaque no perfil
const DESTAQUES_MAX = 3

const idValido = (id) => Number.isInteger(id) && id > 0

const responder = (res, status, sucesso, mensagem, extra = {}) =>
    res.status(status).json({ sucesso, mensagem, ...extra })

// PATCH /badge-usuario/destaques/:id_usuario
// Body: { ids_badge: number[] }  (até 3 ids únicos, todos do usuário; [] limpa)
// TEMPORÁRIO: o id vem da URL (sem token), como no resto da API.
const definirBadgesDestaque = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const ids = req.body?.ids_badge

        if (!idValido(id_usuario)) {
            return responder(res, 400, false, 'Id de usuário inválido.')
        }

        if (!Array.isArray(ids) || !ids.every((id) => idValido(Number(id)) && Number.isInteger(Number(id)))) {
            return responder(res, 400, false, 'Informe ids_badge como uma lista de ids válidos.')
        }

        const unicos = [...new Set(ids.map(Number))]

        if (unicos.length !== ids.length) {
            return responder(res, 400, false, 'Há badges repetidas na lista.')
        }

        if (unicos.length > DESTAQUES_MAX) {
            return responder(res, 400, false, `Escolha no máximo ${DESTAQUES_MAX} badges em destaque.`)
        }

        const possui = await badgeDestaqueDAO.ContarBadgesDoUsuario(id_usuario, unicos)

        if (possui !== unicos.length) {
            return responder(res, 403, false, 'Só é possível destacar badges que você conquistou.')
        }

        await badgeDestaqueDAO.DefinirDestaques(id_usuario, unicos)

        return responder(res, 200, true, 'Badges em destaque atualizadas.', { ids_badge: unicos })
    } catch (error) {
        console.error('Erro ao definir badges em destaque:', error)
        return responder(res, 500, false, (config_message.ERRO_INTERNO || {}).mensagem || 'Erro interno do servidor.')
    }
}

module.exports = { definirBadgesDestaque }
