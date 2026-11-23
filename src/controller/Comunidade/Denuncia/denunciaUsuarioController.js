const config_message = require('../../modulo/configMensagens.js')
const denunciaUsuarioDAO = require('../../../../model/DAO/Comunidade/Denuncia/denunciaUsuarioDAO.js')
const postDAO = require('../../../../model/DAO/Comunidade/Post/postDAO.js') // reaproveita ExisteUsuario

const idValido = (id) => Number.isInteger(id) && id > 0

const responderErro = (res, cfg) =>
    res.status(cfg.status).json({ sucesso: false, mensagem: cfg.mensagem })

const responderSucesso = (res, cfg, dados = {}) =>
    res.status(cfg.status).json({ sucesso: true, mensagem: cfg.mensagem, ...dados })

const idDoUsuarioLogado = (req) => Number(req.body?.id_usuario ?? req.query?.id_usuario)

const ehDuplicada = (error) => error?.code === 'ER_DUP_ENTRY'

// POST /denunciar-usuario
// Body: { id_usuario, id_usuario_denunciado, id_categoria, titulo, descricao }
const criarDenunciaUsuario = async (req, res) => {
    try {
        const id_usuario_denunciante = idDoUsuarioLogado(req)
        const id_usuario_denunciado = Number(req.body?.id_usuario_denunciado)
        const id_categoria = Number(req.body?.id_categoria)
        const titulo = typeof req.body?.titulo === 'string' ? req.body.titulo.trim() : ''
        const descricao = typeof req.body?.descricao === 'string' ? req.body.descricao.trim() : ''

        if (!idValido(id_usuario_denunciante)) return responderErro(res, config_message.NAO_AUTENTICADO)
        if (!idValido(id_usuario_denunciado)) return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        if (!idValido(id_categoria)) return responderErro(res, config_message.ID_CATEGORIA_INVALIDO)
        if (!titulo || !descricao) return responderErro(res, config_message.DENUNCIA_DADOS_INVALIDOS)

        if (id_usuario_denunciante === id_usuario_denunciado) {
            return responderErro(res, config_message.DENUNCIA_AUTO_DENUNCIA)
        }

        if (!await postDAO.ExisteUsuario(id_usuario_denunciante)) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        if (!await postDAO.ExisteUsuario(id_usuario_denunciado)) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        const id_denuncia = await denunciaUsuarioDAO.CreateDenunciaUsuario({
            titulo,
            descricao,
            id_usuario_denunciante,
            id_usuario_denunciado,
            id_categoria,
        })

        if (!id_denuncia) {
            return responderErro(res, config_message.ERRO_CRIAR_DENUNCIA)
        }

        return responderSucesso(res, config_message.DENUNCIA_CRIADA, { id: id_denuncia })

    } catch (error) {
        if (ehDuplicada(error)) {
            return responderErro(res, config_message.DENUNCIA_JA_EXISTE)
        }
        console.error('Erro ao criar denúncia de usuário:', error)
        return responderErro(res, config_message.ERRO_CRIAR_DENUNCIA)
    }
}

module.exports = { criarDenunciaUsuario }
