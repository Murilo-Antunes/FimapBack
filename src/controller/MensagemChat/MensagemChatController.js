// Recebe os pedidos do chat e devolve as respostas ao aplicativo.
/*
 * Recebe a pergunta do frontend, valida a conversa e a mensagem e obtém a
 * identidade do usuário autenticado. Chama o serviço de chat e transmite
 * os trechos da resposta ao frontend via SSE.
 */

const { randomUUID } = require('node:crypto')
const dao = require('../../../model/DAO/MensagemChat/MensagemChatDAO.js')
const service = require('../../services/chatRequestService.js')
const acoes = require('../../../model/DAO/MensagemChat/AcaoChatDAO.js')
const { criarErro, validarId, idUsuarioAutenticado, validarMensagens, validarRequisicaoId } = require('../../services/chatValidation.js')
const { transmitir, responderErro } = require('../../services/chatStream.js')

const chatId = (req) => {
    const id = validarId(req.params.chatId ?? req.params.id_chat ?? req.body?.id_chat)
    if (!id) throw criarErro(400, 'ID do chat inválido.', 'CHAT_ID_INVALIDO')
    return id
}
const listarMensagensChat = async (req, res) => {
    try {
        const mensagens = await dao.listarMensagensChat(chatId(req), idUsuarioAutenticado(req))
        if (!mensagens) throw criarErro(404, 'Chat não encontrado.', 'CHAT_NAO_ENCONTRADO')
        return res.json({ sucesso: true, mensagem: 'Mensagens consultadas com sucesso.', conteudo: mensagens })
    } catch (error) { return responderErro(res, error) }
}
const enviarMensagemChat = async (req, res) => {
    try {
        const id = chatId(req)
        const usuario = idUsuarioAutenticado(req)
        const [pergunta] = validarMensagens([{ role: 'user', content: req.body?.pergunta ?? req.body?.conteudo }])
        const uuid = req.body?.requisicao_id === undefined ? randomUUID() : validarRequisicaoId(req.body.requisicao_id)
        res.set({ 'X-Requisicao-Id': uuid })
        return await transmitir(res, (trecho, signal) => service.gerar(usuario, id, uuid, pergunta.content, trecho, signal))
    } catch (error) { return responderErro(res, error) }
}
const consultarRequisicao = async (req, res) => {
    try {
        const conteudo = await service.consultar(idUsuarioAutenticado(req), validarRequisicaoId(req.params.requisicaoId))
        return res.json({ sucesso: true, mensagem: 'Solicitação consultada com sucesso.', conteudo })
    } catch (error) { return responderErro(res, error) }
}
const cancelarRequisicao = async (req, res) => {
    try {
        const conteudo = await service.cancelar(idUsuarioAutenticado(req), validarRequisicaoId(req.params.requisicaoId))
        return res.json({ sucesso: true, mensagem: 'Estado da solicitação confirmado.', conteudo })
    } catch (error) { return responderErro(res, error) }
}
const confirmarAcao = async (req, res) => {
    try {
        const usuario = idUsuarioAutenticado(req)
        const id = chatId(req)
        const acao = req.params.id_acao
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(acao))
            throw criarErro(400, 'Informe um ID de ação válido.', 'ACAO_ID_INVALIDO')
        if (!req.body || Object.keys(req.body).length !== 1 || !Number.isSafeInteger(req.body.versao) || req.body.versao < 1)
            throw criarErro(400, 'Envie apenas a versão positiva da proposta.', 'ACAO_VERSAO_INVALIDA')
        const conteudo = await acoes.confirmar(usuario, id, acao.toLowerCase(), req.body.versao)
        return res.json({ sucesso: true, mensagem: 'Proposta salva com sucesso.', conteudo })
    } catch (error) { return responderErro(res, error) }
}
module.exports = { listarMensagensChat, enviarMensagemChat, consultarRequisicao, cancelarRequisicao, confirmarAcao }
