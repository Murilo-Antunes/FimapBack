const express = require("express");
const router = express.Router();

const postController = require("../controller/Comunidade/Post/postController.js");
const postSalvoController = require("../controller/Comunidade/Post/postSalvoController.js"); // NOVA
router.use(require('../middlewares/autorization.js'), require('../middlewares/autorizarUsuario.js'))

// Montada em /v1/comunidade/posts

// Criar
router.post("/criar", postController.criarPost);

// Posts salvos — ANTES das rotas por id/usuário pra não colidir com elas.
router.post("/salvar", postSalvoController.salvarPost);                                   // NOVA
router.post("/salvar/alternar", postSalvoController.alternarSalvarPost);                  // NOVA
router.get("/salvar/verificar/:id_post", postSalvoController.verificarPostSalvo);         // NOVA
router.delete("/salvar/:id_post", postSalvoController.removerPostSalvo);                 // NOVA
router.get("/salvos/:id_usuario", postSalvoController.listarSalvosPorUsuario);           // NOVA

// Buscar (rotas fixas primeiro, por id por último)
router.get("/feed", postController.listarFeed);                                       // NOVA
router.get("/buscar/post/:id_usuario", postController.listarPostsPorUsuario);
router.get("/inativos/:id_usuario", postController.listarPostsInativos);
router.get("/buscar/:id_post", postController.buscarPostPorId);

// Atualizar e deletar
router.patch("/atualizar/:id_post", postController.atualizarPost);
router.patch("/deletar/:id_post", postController.deletarPost);

module.exports = router
