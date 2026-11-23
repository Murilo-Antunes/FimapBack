const config_message = require('../../modulo/configMensagens.js')
const postSalvoDAO = require('../../../../model/DAO/Comunidade/Post/postDAO.js')
const postDAO = require('../../../../model/DAO/Comunidade/Post/postDAO.js')

/* ============================ CONSTANTES ============================ */

const STATUS_POST_ATIVO = 1

/* ======================= HELPERS: RESPOSTAS/ENTRADA ======================= */

const idValido = (id) => Number.isInteger(id) && id > 0

const responderErro = (res, cfg) =>
    res.status(cfg.status).json({ sucesso: false, mensagem: cfg.mensagem })

const responderSucesso = (res, cfg, dados = {}) =>
    res.status(cfg.status).json({ sucesso: true, mensagem: cfg.mensagem, ...dados })

const lerParam = (req, ...nomes) => {
    for (const nome of nomes) {
        if (req.params?.[nome] !== undefined) return Number(req.params[nome])
    }
    return NaN
}

// TEMPORÁRIO: lê o id do body/query, igual aos outros controllers de post.
// Trocar por req.usuario.id quando o login com token estiver pronto.
const idDoUsuarioLogado = (req) => Number(req.usuario?.id)

/* ========================= HELPERS: VERIFICAÇÕES ========================= */

const buscarPostAtivo = async (idPost) => {
    const post = await postDAO.GetPostById(idPost)
    if (!post || Number(post.status) !== STATUS_POST_ATIVO) return null
    return post
}

const ehDuplicada = (error) => error?.code === 'ER_DUP_ENTRY'

/* ============================ ENDPOINTS ============================ */

// POST /salvar
// Body: { id_usuario, id_post }
const salvarPost = async (req, res) => {
    try {
        const id_usuario = idDoUsuarioLogado(req)
        const id_post = Number(req.body?.id_post)

        if (!idValido(id_usuario)) return responderErro(res, config_message.NAO_AUTENTICADO)
        if (!idValido(id_post)) return responderErro(res, config_message.ID_POST_INVALIDO)

        if (!await postDAO.ExisteUsuario(id_usuario)) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        if (!await buscarPostAtivo(id_post)) {
            return responderErro(res, config_message.POST_NAO_ENCONTRADO)
        }

        if (await postSalvoDAO.GetPostSalvo(id_usuario, id_post)) {
            return responderErro(res, config_message.POST_JA_SALVO)
        }

        const id_salvo = await postSalvoDAO.CreatePostSalvo({ id_usuario, id_post })

        if (!id_salvo) {
            return responderErro(res, config_message.ERRO_SALVAR_POST)
        }

        return responderSucesso(res, config_message.POST_SALVO_CRIADO, { salvo: true })

    } catch (error) {
        if (ehDuplicada(error)) {
            return responderErro(res, config_message.POST_JA_SALVO)
        }
        console.error('Erro ao salvar post:', error)
        return responderErro(res, config_message.ERRO_SALVAR_POST)
    }
}

// DELETE /salvar/:id_post
const removerPostSalvo = async (req, res) => {
    try {
        const id_post = lerParam(req, 'id_post')
        const id_usuario = idDoUsuarioLogado(req)

        if (!idValido(id_post)) return responderErro(res, config_message.ID_POST_INVALIDO)
        if (!idValido(id_usuario)) return responderErro(res, config_message.NAO_AUTENTICADO)

        const removeu = await postSalvoDAO.DeletePostSalvo(id_usuario, id_post)

        if (!removeu) {
            return responderErro(res, config_message.SALVO_NAO_ENCONTRADO)
        }

        return responderSucesso(res, config_message.SALVO_REMOVIDO, { salvo: false })

    } catch (error) {
        console.error('Erro ao remover post salvo:', error)
        return responderErro(res, config_message.ERRO_DESSALVAR_POST)
    }
}

// POST /salvar/alternar
// Body: { id_usuario, id_post }
const alternarSalvarPost = async (req, res) => {
    try {
        const id_usuario = idDoUsuarioLogado(req)
        const id_post = Number(req.body?.id_post)

        if (!idValido(id_usuario)) return responderErro(res, config_message.NAO_AUTENTICADO)
        if (!idValido(id_post)) return responderErro(res, config_message.ID_POST_INVALIDO)

        if (!await postDAO.ExisteUsuario(id_usuario)) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        if (!await buscarPostAtivo(id_post)) {
            return responderErro(res, config_message.POST_NAO_ENCONTRADO)
        }

        const jaSalvo = await postSalvoDAO.GetPostSalvo(id_usuario, id_post)

        if (jaSalvo) {
            await postSalvoDAO.DeletePostSalvo(id_usuario, id_post)
        } else {
            await postSalvoDAO.CreatePostSalvo({ id_usuario, id_post })
        }

        return responderSucesso(
            res,
            jaSalvo ? config_message.SALVO_REMOVIDO : config_message.POST_SALVO_CRIADO,
            { salvo: !jaSalvo },
        )

    } catch (error) {
        if (ehDuplicada(error)) {
            return responderErro(res, config_message.POST_JA_SALVO)
        }
        console.error('Erro ao alternar post salvo:', error)
        return responderErro(res, config_message.ERRO_SALVAR_POST)
    }
}

// GET /salvar/verificar/:id_post?id_usuario=1
const verificarPostSalvo = async (req, res) => {
    try {
        const id_post = lerParam(req, 'id_post')
        const id_usuario = idDoUsuarioLogado(req)

        if (!idValido(id_post)) return responderErro(res, config_message.ID_POST_INVALIDO)
        if (!idValido(id_usuario)) return responderErro(res, config_message.NAO_AUTENTICADO)

        const salvo = await postSalvoDAO.GetPostSalvo(id_usuario, id_post)

        return responderSucesso(res, config_message.SALVOS_ENCONTRADOS, { salvo: salvo !== null })

    } catch (error) {
        console.error('Erro ao verificar post salvo:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_SALVOS)
    }
}

// GET /salvos/:id_usuario
// Lista os posts que o usuário salvou (mais recentes primeiro) — aba "Salvos".
const listarSalvosPorUsuario = async (req, res) => {
    try {
        const id_usuario = lerParam(req, 'id_usuario')

        if (!idValido(id_usuario)) return responderErro(res, config_message.ID_USUARIO_INVALIDO)

        const posts = await postSalvoDAO.GetAllPostsSalvosByIdUsuario(id_usuario)

        return responderSucesso(res, config_message.SALVOS_ENCONTRADOS, {
            quantidade: posts.length,
            posts,
        })

    } catch (error) {
        console.error('Erro ao listar posts salvos:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_SALVOS)
    }
}

module.exports = {
    salvarPost,
    removerPostSalvo,
    alternarSalvarPost,
    verificarPostSalvo,
    listarSalvosPorUsuario,
}
