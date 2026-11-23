const express = require("express")
const router = express.Router()

const usuarioController = require("../controller/Usuario/usuarioController.js")
const dispositivoController = require("../controller/dispositivos/dispositivosController.js")
const uploadFotoPerfil = require("../middlewares/uploadFotoPerfil.js")

// Cadastro e autenticação por OTP
router.post("/criar-usuario", usuarioController.criarCodigoOTPUsuario)
router.post("/codigo-otp/senha/:id_usuario", usuarioController.solicitarOTPAlteracaoSenha)
router.post("/alterar/verificar-codigo/:id_usuario", usuarioController.verificarCodigoAlteracaoSenha)
router.post("/login", usuarioController.login)
router.post("/consultar/otp/:id_usuario", usuarioController.validarCodigoOTP)
router.post("/alterar/verificar-senha-atual/:id_usuario", usuarioController.verificarSenhaAtual)

// Atualizar usuário
router.patch("/usuario-update/:id_usuario", usuarioController.atualizarUsuario)
router.patch("/alterar/senha-atual/:id_usuario", usuarioController.alterarSenhaComSenhaAtual)

// Perfil social
router.get("/social/username-disponivel/:username_social", usuarioController.verificarUsernameSocial)
router.post("/foto-perfil/:id_usuario", uploadFotoPerfil, usuarioController.enviarFotoPerfil)
router.delete("/foto-perfil/:id_usuario", usuarioController.removerFotoPerfil)

// Buscar usuários
// ⚠️ VOLTOU: essa é a rota que o PublicProfileView.vue usa pra carregar o
// perfil público de outro usuário, buscando por username_social.
router.get("/usuario/social/:username_social", usuarioController.buscarUsuarioPorUsernameSocial)
router.get("/usuario/id/:id_usuario", usuarioController.buscarUsuarioPorId)
router.get("/usuario/email/:email", usuarioController.buscarUsuarioPorEmail)
router.get("/usuarios", usuarioController.buscarTodosUsuarios)
router.get("/otp/codigos", usuarioController.buscarTodosCodigos)
router.get("/todos/dispositivos", dispositivoController.buscarTodosDispositivos)

// Deletar usuário
router.delete("/usuario-delete/:id_usuario", usuarioController.deletarUsuario)

module.exports = router

// Base: http://localhost:8080/v1/openfinance/usuario
