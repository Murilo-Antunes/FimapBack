const privacidadeDAO = require('../../model/DAO/Social/privacidadeDAO.js')

const idValido = (id) => Number.isInteger(id) && id > 0

const negar = (res, status, mensagem, extra = {}) =>
    res.status(status).json({ sucesso: false, mensagem, ...extra })

const idDoVisualizador = (req) => Number(req.usuario?.id ?? req.usuario?.id_usuario) || 0

/**
 * Resultado possível:
 *  'liberado'     -> pode ver
 *  'restrito'     -> perfil privado e o visualizador não tem conexão aprovada
 *  'indisponivel' -> perfil desativado, ou o dono bloqueou o visualizador
 *                    (propositalmente igual a "inexistente": não revela o bloqueio)
 *  'inexistente'  -> usuário não existe
 */
async function verificarAcesso(id_visualizador, id_dono) {
    const visualizador = Number(id_visualizador) || 0

    if (visualizador && visualizador === id_dono) return 'liberado'

    const dono = await privacidadeDAO.BuscarDono(id_dono)
    if (!dono) return 'inexistente'
    if (!Number(dono.perfil_social_ativo)) return 'indisponivel'

    if (visualizador && await privacidadeDAO.EstaBloqueado(id_dono, visualizador)) return 'indisponivel'

    if (Number(dono.visibilidade) === 1) return 'liberado'

    if (visualizador && await privacidadeDAO.TemAcessoAprovado(visualizador, id_dono)) return 'liberado'

    return 'restrito'
}

const responderAcessoNegado = (res, acesso) =>
    acesso === 'restrito'
        ? negar(res, 403, 'Este perfil é privado.', { acesso_restrito: true })
        : negar(res, 404, 'Usuário não encontrado.')

// Pra rotas que mostram dados de OUTRA pessoa (badges, posts, respostas,
// seguidores do perfil público) — NÃO exige ser o dono, exige só que o perfil
// não esteja privado/bloqueado pra quem está olhando. Use no lugar de
// autorizarUsuario nessas rotas específicas.
const exigirAcessoAoPerfil = (nomeParam = 'id_usuario') => async (req, res, next) => {
    try {
        const id_dono = Number(req.params?.[nomeParam])
        if (!idValido(id_dono)) return negar(res, 400, 'Id de usuário inválido.')

        const acesso = await verificarAcesso(idDoVisualizador(req), id_dono)
        if (acesso === 'liberado') return next()

        return responderAcessoNegado(res, acesso)
    } catch (error) {
        console.error('Erro ao verificar acesso ao perfil:', error)
        return negar(res, 500, 'Erro interno do servidor.')
    }
}

// POST /seguir: o seguidor tem que ser o próprio usuário do token, e perfil
// privado só entra por solicitação aprovada (não por follow direto).
const bloquearSeguirPerfilPrivado = async (req, res, next) => {
    try {
        const id_seguidor = Number(req.body?.id_seguidor)
        const id_seguindo = Number(req.body?.id_seguindo)

        if (!idValido(id_seguidor) || !idValido(id_seguindo)) return next() // deixa o controller responder o erro de sempre

        const visualizador = idDoVisualizador(req)
        if (!visualizador || visualizador !== id_seguidor) {
            return negar(res, 403, 'Você só pode seguir em seu próprio nome.')
        }

        const acesso = await verificarAcesso(visualizador, id_seguindo)
        if (acesso === 'liberado') return next()

        if (acesso === 'restrito') {
            return negar(res, 403, 'Este perfil é privado. Envie uma solicitação de acesso.', { acesso_restrito: true })
        }

        return negar(res, 404, 'Usuário não encontrado.')
    } catch (error) {
        console.error('Erro ao validar follow de perfil privado:', error)
        return negar(res, 500, 'Erro interno do servidor.')
    }
}

module.exports = {
    idDoVisualizador,
    verificarAcesso,
    responderAcessoNegado,
    exigirAcessoAoPerfil,
    bloquearSeguirPerfilPrivado,
}