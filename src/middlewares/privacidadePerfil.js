const privacidadeDAO = require('../../model/DAO/Social/privacidadeDAO.js')
const autenticar = require('./autorization.js') // seu middleware de JWT (o mesmo do router.use das metas)

const idValido = (id) => Number.isInteger(id) && id > 0

const negar = (res, status, mensagem, extra = {}) =>
    res.status(status).json({ sucesso: false, mensagem, ...extra })

// Quem está autenticado, vindo SÓ do token (preenchido por autorization.js).
// ⚠️ Se o seu middleware guarda o id em outro campo (req.user, req.auth...), ajuste esta linha — é o único lugar.
// Nunca ler o id de body/query/params: isso é controlado pelo cliente.
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

// Resposta a um acesso negado (usada pelos middlewares e pelo controller de perfil).
const responderAcessoNegado = (res, acesso) =>
    acesso === 'restrito'
        ? negar(res, 403, 'Este perfil é privado.', { acesso_restrito: true })
        : negar(res, 404, 'Usuário não encontrado.')

// Todos os middlewares abaixo já rodam o JWT (autenticar) antes da própria checagem,
// então funcionam mesmo que o router não tenha router.use(autorization). Rodar duas
// vezes é só uma verificação a mais do token — não muda nada.

// Rotas com :id_usuario de OUTRA pessoa (badges, posts, respostas, seguidores...).
const exigirAcessoAoPerfil = (nomeParam = 'id_usuario') => [
    autenticar,
    async (req, res, next) => {
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
    },
]

// Rotas que só o próprio usuário pode usar (salvos, arquivados, progresso, configurações...).
// `campo` é lido de params, body ou query e precisa ser igual ao id do token.
const exigirProprioUsuario = (campo = 'id_usuario') => [
    autenticar,
    (req, res, next) => {
        const dados = req.method === 'GET' ? req.query : req.body
        const alvo = Number(req.params?.[campo] ?? dados?.[campo])
        if (!idValido(alvo)) return negar(res, 400, 'Id de usuário inválido.')

        const visualizador = idDoVisualizador(req)
        if (!visualizador || visualizador !== alvo) {
            return negar(res, 403, 'Você só pode acessar os seus próprios dados.')
        }

        return next()
    },
]

// POST /seguir: o seguidor é sempre o usuário do token; perfil privado só entra por solicitação aprovada.
const bloquearSeguirPerfilPrivado = [
    autenticar,
    async (req, res, next) => {
        try {
            const id_seguidor = Number(req.body?.id_seguidor)
            const id_seguindo = Number(req.body?.id_seguindo)

            // Se os ids estão inválidos, deixa o controller responder o erro de sempre.
            if (!idValido(id_seguidor) || !idValido(id_seguindo)) return next()

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
    },
]

module.exports = {
    autenticar,
    idDoVisualizador,
    verificarAcesso,
    responderAcessoNegado,
    exigirAcessoAoPerfil,
    exigirProprioUsuario,
    bloquearSeguirPerfilPrivado,
}
