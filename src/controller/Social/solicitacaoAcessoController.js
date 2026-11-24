const solicitacaoDAO = require('../../../model/DAO/Social/solicitacaoAcessoDAO.js')
const privacidadeDAO = require('../../../model/DAO/Social/privacidadeDAO.js')

const idValido = (id) => Number.isInteger(id) && id > 0

const responder = (res, status, sucesso, mensagem, extra = {}) =>
    res.status(status).json({ sucesso, mensagem, ...extra })

const ERRO_INTERNO = 'Erro interno do servidor.'
const TIPOS = ['conexao', 'seguir']
const DECISOES = ['aceitar', 'recusar']

// GET /solicitacao/status/:id_usuario?id_destinatario=
// :id_usuario = eu (autorizarUsuario já garantiu que é o dono do token).
// -> { status: 'nenhuma' | 'pendente' }   (pendente vencida conta como nenhuma)
const buscarStatus = async (req, res) => {
    try {
        const id_solicitante = Number(req.params.id_usuario)
        const id_destinatario = Number(req.query?.id_destinatario)

        if (!idValido(id_destinatario)) {
            return responder(res, 400, false, 'Informe id_destinatario válido.')
        }

        const solicitacao = await solicitacaoDAO.BuscarPorPar(id_solicitante, id_destinatario)
        const pendente = solicitacao?.status === 'pendente' && solicitacaoDAO.aindaValida(solicitacao)

        return responder(res, 200, true, 'Status encontrado.', { status: pendente ? 'pendente' : 'nenhuma' })
    } catch (error) {
        console.error('Erro ao buscar status da solicitação:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// POST /solicitar/:id_usuario   Body: { id_destinatario, tipo: 'conexao' | 'seguir' }
// :id_usuario = eu (o solicitante).
const solicitar = async (req, res) => {
    try {
        const id_solicitante = Number(req.params.id_usuario)
        const id_destinatario = Number(req.body?.id_destinatario)
        const tipo = req.body?.tipo

        if (!idValido(id_destinatario)) return responder(res, 400, false, 'Informe id_destinatario válido.')
        if (!TIPOS.includes(tipo)) return responder(res, 400, false, `tipo deve ser um de: ${TIPOS.join(', ')}.`)
        if (id_solicitante === id_destinatario) return responder(res, 400, false, 'Você não pode solicitar acesso a si mesmo.')

        const [destinatario, solicitante] = await Promise.all([
            privacidadeDAO.BuscarDono(id_destinatario),
            privacidadeDAO.BuscarDono(id_solicitante),
        ])

        // Não revela bloqueio nem perfil desativado: aparece como "não encontrado".
        if (!destinatario || !solicitante || !Number(destinatario.perfil_social_ativo)) {
            return responder(res, 404, false, 'Usuário não encontrado.')
        }
        if (await privacidadeDAO.EstaBloqueado(id_destinatario, id_solicitante)) {
            return responder(res, 404, false, 'Usuário não encontrado.')
        }
        if (await privacidadeDAO.EstaBloqueado(id_solicitante, id_destinatario)) {
            return responder(res, 403, false, 'Desbloqueie este usuário para enviar uma solicitação.')
        }

        if (Number(destinatario.visibilidade) === 1) {
            return responder(res, 400, false, 'Este perfil é público: não precisa de solicitação.')
        }

        const existente = await solicitacaoDAO.BuscarPorPar(id_solicitante, id_destinatario)

        if (existente?.status === 'aceita') {
            return responder(res, 409, false, 'Você já tem acesso a este perfil.')
        }
        if (existente?.status === 'pendente' && solicitacaoDAO.aindaValida(existente)) {
            return responder(res, 409, false, 'Você já enviou uma solicitação para este perfil.')
        }
        // Evita pedir de novo, em loop, logo depois de uma recusa.
        if (existente?.status === 'recusada' && existente.data_resposta) {
            const dias = (Date.now() - new Date(existente.data_resposta).getTime()) / (24 * 60 * 60 * 1000)
            if (dias < solicitacaoDAO.VALIDADE_DIAS) {
                return responder(res, 403, false, 'Sua solicitação foi recusada recentemente. Tente novamente mais tarde.')
            }
        }

        await solicitacaoDAO.CriarOuRenovar({ id_solicitante, id_destinatario, tipo })

        return responder(res, 201, true, 'Solicitação enviada.', { status: 'pendente' })
    } catch (error) {
        console.error('Erro ao criar solicitação de acesso:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// DELETE /solicitar/:id_usuario   Body: { id_destinatario }
const cancelar = async (req, res) => {
    try {
        const id_solicitante = Number(req.params.id_usuario)
        const id_destinatario = Number(req.body?.id_destinatario)

        if (!idValido(id_destinatario)) return responder(res, 400, false, 'Informe id_destinatario válido.')

        const cancelou = await solicitacaoDAO.Cancelar(id_solicitante, id_destinatario)
        if (!cancelou) return responder(res, 404, false, 'Nenhuma solicitação pendente encontrada.')

        return responder(res, 200, true, 'Solicitação cancelada.', { status: 'nenhuma' })
    } catch (error) {
        console.error('Erro ao cancelar solicitação:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// GET /solicitacoes/recebidas/:id_usuario
const listarRecebidas = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        const solicitacoes = await solicitacaoDAO.ListarRecebidas(id_usuario)

        return responder(res, 200, true, 'Solicitações encontradas.', { quantidade: solicitacoes.length, solicitacoes })
    } catch (error) {
        console.error('Erro ao listar solicitações recebidas:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

// PATCH /solicitacoes/:id_usuario/:id_solicitacao/responder   Body: { decisao }
// :id_usuario = eu (o destinatário).
const responderSolicitacao = async (req, res) => {
    try {
        const id_destinatario = Number(req.params.id_usuario)
        const id_solicitacao = Number(req.params.id_solicitacao)
        const decisao = req.body?.decisao

        if (!idValido(id_solicitacao)) return responder(res, 400, false, 'Id de solicitação inválido.')
        if (!DECISOES.includes(decisao)) return responder(res, 400, false, `decisao deve ser: ${DECISOES.join(' ou ')}.`)

        const resultado = await solicitacaoDAO.Responder({ id_solicitacao, id_destinatario, decisao })

        if (!resultado) {
            return responder(res, 404, false, 'Solicitação não encontrada, já respondida ou expirada.')
        }

        return responder(res, 200, true, decisao === 'aceitar' ? 'Solicitação aceita.' : 'Solicitação recusada.', {
            status: resultado.status,
        })
    } catch (error) {
        console.error('Erro ao responder solicitação:', error)
        return responder(res, 500, false, ERRO_INTERNO)
    }
}

module.exports = { buscarStatus, solicitar, cancelar, listarRecebidas, responderSolicitacao }
