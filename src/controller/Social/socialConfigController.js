const socialConfigDAO = require('../../../model/DAO/Social/socialConfigDAO.js')
const privacidadeDAO = require('../../../model/DAO/Social/privacidadeDAO.js')

const idValido = (id) => Number.isInteger(id) && id > 0

const responder = (res, status, sucesso, mensagem, extra = {}) =>
    res.status(status).json({ sucesso, mensagem, ...extra })

const ERRO_INTERNO = 'Erro interno do servidor.'

const QUEM_COMENTA = ['todos', 'seguidores', 'ninguem']
const CAMPOS_BOOLEANOS = ['visibilidade', 'notif_respostas_mencoes', 'notif_topicos_ia', 'notif_conquistas']

// aceita true/false, 1/0 e '1'/'0'; devolve null se não for nenhum desses
const paraFlag = (valor) => {
    if (valor === true || valor === 1 || valor === '1' || valor === 'true') return 1
    if (valor === false || valor === 0 || valor === '0' || valor === 'false') return 0
    return null
}

// GET /configuracoes/:id_usuario
const buscarConfiguracoes = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        if (!idValido(id_usuario)) return responder(res, 400, false, 'Id de usuário inválido.')

        const configuracoes = await socialConfigDAO.BuscarConfiguracoes(id_usuario)
        if (!configuracoes) return responder(res, 404, false, 'Usuário não encontrado.')

        return responder(res, 200, true, 'Configurações encontradas.', { configuracoes })
    } catch (error) {
        console.error('Erro ao buscar configurações sociais:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// PATCH /configuracoes/:id_usuario
// Body: qualquer subconjunto de { visibilidade, quem_comenta, notif_respostas_mencoes, notif_topicos_ia, notif_conquistas }
const atualizarConfiguracoes = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        if (!idValido(id_usuario)) return responder(res, 400, false, 'Id de usuário inválido.')

        const entrada = req.body ?? {}
        const alteracoes = {}

        for (const campo of CAMPOS_BOOLEANOS) {
            if (entrada[campo] === undefined) continue

            const flag = paraFlag(entrada[campo])
            if (flag === null) return responder(res, 400, false, `Valor inválido para "${campo}".`)

            alteracoes[campo] = flag
        }

        if (entrada.quem_comenta !== undefined) {
            if (!QUEM_COMENTA.includes(entrada.quem_comenta)) {
                return responder(res, 400, false, `quem_comenta deve ser um de: ${QUEM_COMENTA.join(', ')}.`)
            }
            alteracoes.quem_comenta = entrada.quem_comenta
        }

        if (!Object.keys(alteracoes).length) {
            return responder(res, 400, false, 'Nenhuma alteração válida informada.')
        }

        if (!await privacidadeDAO.BuscarDono(id_usuario)) {
            return responder(res, 404, false, 'Usuário não encontrado.')
        }

        await socialConfigDAO.AtualizarConfiguracoes(id_usuario, alteracoes)
        const configuracoes = await socialConfigDAO.BuscarConfiguracoes(id_usuario)

        return responder(res, 200, true, 'Configurações atualizadas.', { configuracoes })
    } catch (error) {
        console.error('Erro ao atualizar configurações sociais:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// GET /resumo/:id_usuario
const buscarResumo = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        if (!idValido(id_usuario)) return responder(res, 400, false, 'Id de usuário inválido.')

        const resumo = await socialConfigDAO.BuscarResumo(id_usuario)
        if (!resumo) return responder(res, 404, false, 'Usuário não encontrado.')

        return responder(res, 200, true, 'Resumo encontrado.', { resumo })
    } catch (error) {
        console.error('Erro ao buscar resumo social:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

const alterarAtivo = (ativo, mensagem) => async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        if (!idValido(id_usuario)) return responder(res, 400, false, 'Id de usuário inválido.')

        if (!await privacidadeDAO.BuscarDono(id_usuario)) {
            return responder(res, 404, false, 'Usuário não encontrado.')
        }

        await socialConfigDAO.DefinirPerfilSocialAtivo(id_usuario, ativo)

        return responder(res, 200, true, mensagem)
    } catch (error) {
        console.error('Erro ao alterar estado do perfil social:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// PATCH /desativar/:id_usuario  e  PATCH /reativar/:id_usuario
const desativarPerfil = alterarAtivo(false, 'Perfil da comunidade desativado.')
const reativarPerfil = alterarAtivo(true, 'Perfil da comunidade reativado.')

module.exports = { buscarConfiguracoes, atualizarConfiguracoes, buscarResumo, desativarPerfil, reativarPerfil }
