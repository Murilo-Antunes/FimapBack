const express = require("express");
const router = express.Router();

const postController = require("../controller/Comunidade/Post/postController.js");
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
const { exigirAcessoAoPerfil } = require('../middlewares/privacidadePerfil.js')

router.use(autenticar)

// Montada em /v1/comunidade/posts

// Criar
router.post("/criar", postController.criarPost);

// Posts salvos — ANTES das rotas por id/usuário pra não colidir com elas.
router.post("/salvar", postController.salvarPost);
router.post("/salvar/alternar", postController.alternarSalvarPost);
router.get("/salvar/verificar/:id_post", postController.verificarPostSalvo);
router.delete("/salvar/:id_post", postController.removerPostSalvo);
// "Salvos" é privado — só o dono vê os próprios.
router.get("/salvos/:id_usuario", autorizarUsuario, postController.listarPostsSalvos);

// Buscar (rotas fixas primeiro, por id por último)
router.get("/feed", postController.listarFeed);
// Publicações de um usuário: é o que alimenta o perfil PÚBLICO de outra pessoa.
router.get("/buscar/post/:id_usuario", exigirAcessoAoPerfil("id_usuario"), postController.listarPostsPorUsuario);
// "Arquivados" é privado — só o dono vê os próprios.
router.get("/inativos/:id_usuario", autorizarUsuario, postController.listarPostsInativos);
router.get("/buscar/:id_post", postController.buscarPostPorId);

// Atualizar e deletar
router.patch("/atualizar/:id_post", postController.atualizarPost);
router.patch("/deletar/:id_post", postController.deletarPost);

module.exports = router
