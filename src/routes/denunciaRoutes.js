const express = require("express")
const router = express.Router()

const denunciaController = require("../controller/Comunidade/Denuncia/denunciaController.js")
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
router.use(autenticar, autorizarUsuario)

// Criar denúncia
router.post("/criar", denunciaController.criarDenuncia)

// Buscar denúncias
router.get("/buscar/:id_denuncia", denunciaController.buscarDenunciaPorId)
router.get("/listar/usuario/:id_usuario", denunciaController.listarDenunciasPorUsuario)

// Listar categorias de denúncia
router.get("/categorias", denunciaController.ListarCategoriasDenuncia)

// Atualizar denúncia
router.patch("/atualizar/:id_denuncia", denunciaController.atualizarDenuncia)

// Deletar denúncia
router.delete("/deletar/:id_denuncia", denunciaController.deletarDenuncia)

module.exports = router
