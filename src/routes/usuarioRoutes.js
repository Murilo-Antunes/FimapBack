const express = require("express")
const router = express.Router()

const usuarioController = require("../controller/Usuario/usuarioController.js")
const uploadFotoPerfil = require("../middlewares/uploadFotoPerfil.js")
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
const limitarAutenticacao = require('../middlewares/limitarAutenticacao.js')

// Cadastro e autenticação por OTP
router.post("/criar-usuario", limitarAutenticacao, usuarioController.criarCodigoOTPUsuario)
router.post("/codigo-otp/senha/:id_usuario", limitarAutenticacao, usuarioController.solicitarOTPAlteracaoSenha)
router.post("/alterar/verificar-codigo/:id_usuario", limitarAutenticacao, usuarioController.verificarCodigoAlteracaoSenha)
router.post("/senha/redefinir/:id_usuario", limitarAutenticacao, usuarioController.redefinirSenhaComOTP)
router.post("/login", limitarAutenticacao, usuarioController.login)
router.post("/consultar/otp/:id_usuario", limitarAutenticacao, usuarioController.validarCodigoOTP)

// Consultas usadas pelo perfil social público.
router.get("/social/username-disponivel/:username_social", usuarioController.verificarUsernameSocial)
router.get("/usuario/social/:username_social", usuarioController.buscarUsuarioPorUsernameSocial)

router.use(autenticar, autorizarUsuario)
router.post("/alterar/verificar-senha-atual/:id_usuario", usuarioController.verificarSenhaAtual)

// Atualizar usuário
router.patch("/usuario-update/:id_usuario", usuarioController.atualizarUsuario)
router.patch("/alterar/senha-atual/:id_usuario", usuarioController.alterarSenhaComSenhaAtual)

// Perfil social
router.post("/foto-perfil/:id_usuario", uploadFotoPerfil, usuarioController.enviarFotoPerfil)
router.delete("/foto-perfil/:id_usuario", usuarioController.removerFotoPerfil)

// Buscar usuários
// ⚠️ VOLTOU: essa é a rota que o PublicProfileView.vue usa pra carregar o
// perfil público de outro usuário, buscando por username_social.
router.get("/usuario/id/:id_usuario", usuarioController.buscarUsuarioPorId)

// Deletar usuário
router.delete("/usuario-delete/:id_usuario", usuarioController.deletarUsuario)

module.exports = router

// Base: http://localhost:8080/v1/openfinance/usuario
