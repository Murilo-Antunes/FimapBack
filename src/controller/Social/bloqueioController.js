const bloqueioDAO = require('../../../model/DAO/Social/bloqueioDAO.js')
const privacidadeDAO = require('../../../model/DAO/Social/privacidadeDAO.js')

const idValido = (id) => Number.isInteger(id) && id > 0

const responder = (res, status, sucesso, mensagem, extra = {}) =>
    res.status(status).json({ sucesso, mensagem, ...extra })

const ERRO_INTERNO = 'Erro interno do servidor.'

// POST /bloqueios
// Body: { id_usuario, id_bloqueado }
const bloquear = async (req, res) => {
    try {
        const id_bloqueador = Number(req.body?.id_usuario)
        const id_bloqueado = Number(req.body?.id_bloqueado)

        if (!idValido(id_bloqueador) || !idValido(id_bloqueado)) {
            return responder(res, 400, false, 'Informe id_usuario e id_bloqueado válidos.')
        }
        if (id_bloqueador === id_bloqueado) return responder(res, 400, false, 'Você não pode bloquear a si mesmo.')

        if (!await privacidadeDAO.BuscarDono(id_bloqueado)) {
            return responder(res, 404, false, 'Usuário não encontrado.')
        }

        await bloqueioDAO.Bloquear(id_bloqueador, id_bloqueado)

        return responder(res, 201, true, 'Usuário bloqueado.')
    } catch (error) {
        console.error('Erro ao bloquear usuário:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// DELETE /bloqueios/:id_usuario/:id_bloqueado
const desbloquear = async (req, res) => {
    try {
        const id_bloqueador = Number(req.params.id_usuario)
        const id_bloqueado = Number(req.params.id_bloqueado)

        if (!idValido(id_bloqueador) || !idValido(id_bloqueado)) {
            return responder(res, 400, false, 'Informe ids válidos.')
        }

        const removeu = await bloqueioDAO.Desbloquear(id_bloqueador, id_bloqueado)
        if (!removeu) return responder(res, 404, false, 'Este usuário não está bloqueado.')

        return responder(res, 200, true, 'Usuário desbloqueado.')
    } catch (error) {
        console.error('Erro ao desbloquear usuário:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// GET /bloqueios/:id_usuario
const listarBloqueados = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        if (!idValido(id_usuario)) return responder(res, 400, false, 'Id de usuário inválido.')

        const bloqueados = await bloqueioDAO.ListarBloqueados(id_usuario)

        return responder(res, 200, true, 'Usuários bloqueados encontrados.', { quantidade: bloqueados.length, bloqueados })
    } catch (error) {
        console.error('Erro ao listar bloqueados:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

module.exports = { bloquear, desbloquear, listarBloqueados }
