const express = require("express");
const router = express.Router();

const comentarioController = require('../../src/controller/Comunidade/Comentario/comentarioController.js');
const autenticar = require('../../src/middlewares/autorization.js')
const { exigirAcessoAoPerfil } = require('../../src/middlewares/privacidadePerfil.js')

router.use(autenticar)

router.post("/comentar", comentarioController.criarComentario)


router.patch("/update-comentario/:id_comentario", comentarioController.atualizarComentario)


router.get("/buscar-comentarios/post/:id_post", comentarioController.listarComentariosPorPost)
router.get("/buscar-comentario/:id_comentario", comentarioController.buscarComentarioPorId)
// "Respostas" do perfil PÚBLICO de outra pessoa — não é "só o dono".
router.get("/buscar-comentario/usuario/:id_usuario", exigirAcessoAoPerfil("id_usuario"), comentarioController.listarComentariosPorUsuario)
router.get("/buscar-respostas/:id_comentario", comentarioController.listarRespostas)

router.delete("/deletar-comentario/:id_comentario", comentarioController.deletarComentario)

module.exports = router
