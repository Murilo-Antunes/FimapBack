// Confere IDs de usuário informados como identidade do solicitante.
// IDs de usuários-alvo (ex.: id_seguindo) não são tratados como identidade.
const autorizarUsuario = (req, res, next) => {
    // Estes endpoints leem dados públicos de outros perfis; ainda exigem token,
    // mas o usuário consultado não é a identidade que está fazendo a requisição.
    const rotaPublicaDePerfil = req.method === 'GET' && (
        /^\/buscar\/post\/\d+$/.test(req.path) ||
        /^\/listar\/(seguidores|seguindo)\/\d+$/.test(req.path)
    )
    if (rotaPublicaDePerfil) return next()

    const idAutenticado = Number(req.usuario?.id)
    const identidadeInformada = [
        req.params?.id_usuario,
        req.params?.idUsuario,
        req.params?.usuarioId,
        req.query?.id_usuario,
        req.query?.idUsuario,
        req.query?.usuarioId,
        req.query?.clientUserId,
        req.query?.id_seguidor,
        req.body?.id_usuario,
        req.body?.idUsuario,
        req.body?.usuarioId,
        req.body?.clientUserId,
        req.body?.id_seguidor
    ].filter((id) => id !== undefined && id !== null && id !== '')

    if (identidadeInformada.some((id) => String(id) !== String(idAutenticado))) {
        return res.status(403).json({
            sucesso: false,
            codigo: 'USUARIO_SEM_PERMISSAO',
            mensagem: 'A operação não pode ser realizada para outro usuário.'
        })
    }

    return next()
}

module.exports = autorizarUsuario
