const seguir_seguidoresContorller  = require("../controller/Seguir_Seguidores/seguir_seguidoresController.js")
const solicitacaoAcessoController = require("../controller/Social/solicitacaoAcessoController.js")
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
const { exigirAcessoAoPerfil, bloquearSeguirPerfilPrivado } = require('../middlewares/privacidadePerfil.js')
const express = require("express")
const router = express.Router()

router.use(autenticar)

// Cadastro e autenticação por OTP
router.post("/seguir", bloquearSeguirPerfilPrivado, seguir_seguidoresContorller.seguir)

// GET /seguir/verificar?id_seguidor=&id_seguindo= -> { segue: boolean }
router.get("/verificar", seguir_seguidoresContorller.verificarSegue)

// Solicitações de acesso a perfil privado — tudo com :id_usuario = "eu" no path,
// pra caber no mesmo autorizarUsuario que o resto do projeto já usa.
router.get("/solicitacao/status/:id_usuario", autorizarUsuario, solicitacaoAcessoController.buscarStatus)
router.post("/solicitar/:id_usuario", autorizarUsuario, solicitacaoAcessoController.solicitar)
router.delete("/solicitar/:id_usuario", autorizarUsuario, solicitacaoAcessoController.cancelar)
router.get("/solicitacoes/recebidas/:id_usuario", autorizarUsuario, solicitacaoAcessoController.listarRecebidas)
router.patch("/solicitacoes/:id_usuario/:id_solicitacao/responder", autorizarUsuario, solicitacaoAcessoController.responderSolicitacao)

// Buscar usuários — listas de seguidores do perfil PÚBLICO de outra pessoa.
router.get("/listar/seguidores/:id_usuario", exigirAcessoAoPerfil("id_usuario"), seguir_seguidoresContorller.listarSeguidores)
router.get("/listar/seguindo/:id_usuario", exigirAcessoAoPerfil("id_usuario"), seguir_seguidoresContorller.listarSeguindo)

// Deletar usuário
router.delete("/unfollow", seguir_seguidoresContorller.deixarDeSeguir)

module.exports = router
