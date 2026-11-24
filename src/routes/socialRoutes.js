const express = require("express")
const router = express.Router()

const socialConfigController = require("../controller/Social/socialConfigController.js")
const bloqueioController = require("../controller/Social/bloqueioController.js")
const solicitacaoAcessoController = require("../controller/Social/solicitacaoAcessoController.js")
const { exigirProprioUsuario } = require("../middlewares/privacidadePerfil.js")

// Montar em: app.use("/v1/comunidade/social", socialRoutes)
// Tudo aqui é do próprio usuário (exigirProprioUsuario compara com ?id_visualizador / req.usuario.id).

// Configurações do Espaço Social
router.get("/configuracoes/:id_usuario", exigirProprioUsuario("id_usuario"), socialConfigController.buscarConfiguracoes)
router.patch("/configuracoes/:id_usuario", exigirProprioUsuario("id_usuario"), socialConfigController.atualizarConfiguracoes)
router.get("/resumo/:id_usuario", exigirProprioUsuario("id_usuario"), socialConfigController.buscarResumo)

// Desativar / reativar o perfil da comunidade
router.patch("/desativar/:id_usuario", exigirProprioUsuario("id_usuario"), socialConfigController.desativarPerfil)
router.patch("/reativar/:id_usuario", exigirProprioUsuario("id_usuario"), socialConfigController.reativarPerfil)

// Bloqueios
router.get("/bloqueios/:id_usuario", exigirProprioUsuario("id_usuario"), bloqueioController.listarBloqueados)
router.post("/bloqueios", exigirProprioUsuario("id_usuario"), bloqueioController.bloquear)
router.delete("/bloqueios/:id_usuario/:id_bloqueado", exigirProprioUsuario("id_usuario"), bloqueioController.desbloquear)

router.get("/solicitacao/status", exigirProprioUsuario("id_solicitante"), solicitacaoAcessoController.buscarStatus)
router.post("/solicitar", exigirProprioUsuario("id_solicitante"), solicitacaoAcessoController.solicitar)
router.delete("/solicitar", exigirProprioUsuario("id_solicitante"), solicitacaoAcessoController.cancelar)
router.get("/solicitacoes/recebidas/:id_usuario", exigirProprioUsuario("id_usuario"), solicitacaoAcessoController.listarRecebidas)
router.patch("/solicitacoes/:id_solicitacao/responder", exigirProprioUsuario("id_usuario"), solicitacaoAcessoController.responderSolicitacao)

module.exports = router
