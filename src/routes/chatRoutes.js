// Define os endereços do chat que o aplicativo pode chamar.
/*
 * Define as rotas autenticadas de conversas do FIMAP.
 * Encaminha o envio de perguntas, a consulta do histórico e o acompanhamento
 * das requisições ao controlador de mensagens.
 */

const express = require("express");
const router = express.Router();

const ChatController = require("../controller/Chat/ChatController.js")
const mensagens = require('../controller/MensagemChat/MensagemChatController.js')

router.use(require('../middlewares/autorization.js'));
router.post('/iniciar-chat{/:id_usuario}', ChatController.CriarChat);

router.get('/listar-chats{/:id_usuario}', ChatController.ListarChatsPorUsuario);
router.get('/listar-chat/:id_chat/mensagens{/:id_usuario}', mensagens.listarMensagensChat);
router.get('/listar-chat/:id_chat{/:id_usuario}', ChatController.ListaPorId);
router.post('/mensagens', mensagens.enviarMensagemChat);
router.post('/:id_chat/acoes/:id_acao/confirmar', mensagens.confirmarAcao);
router.get('/requisicoes/:requisicaoId{/:id_usuario}', mensagens.consultarRequisicao);
router.post('/requisicoes/:requisicaoId/cancelar{/:id_usuario}', mensagens.cancelarRequisicao);

router.delete('/apagar-chat/:id_chat{/:id_usuario}', ChatController.ApagarChat);

router.patch('/atualizar-nome-chat/:id_chat{/:id_usuario}', ChatController.AtualizarNomeChat);

router.use(require("./mensagemChatRoutes.js"));

module.exports = router;
