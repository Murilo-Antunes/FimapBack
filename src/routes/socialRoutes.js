const express = require("express")
const router = express.Router()

const socialConfigController = require("../controller/Social/socialConfigController.js")
const bloqueioController = require("../controller/Social/bloqueioController.js")
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')

// Montar em: app.use("/v1/comunidade/social", socialRoutes)
// Toda rota aqui tem :id_usuario = o dono (inclusive a de criar bloqueio, que
// reorganizei pra ficar nesse padrão) — é exatamente o caso que autorizarUsuario
// já resolve, então aqui (diferente de badge/post/comentário/seguir) dá pra
// aplicar globalmente sem quebrar nada.
router.use(autenticar, autorizarUsuario)

// Configurações do Espaço Social
router.get("/configuracoes/:id_usuario", socialConfigController.buscarConfiguracoes)
router.patch("/configuracoes/:id_usuario", socialConfigController.atualizarConfiguracoes)
router.get("/resumo/:id_usuario", socialConfigController.buscarResumo)

// Desativar / reativar o perfil da comunidade
router.patch("/desativar/:id_usuario", socialConfigController.desativarPerfil)
router.patch("/reativar/:id_usuario", socialConfigController.reativarPerfil)

// Bloqueios — POST agora é /bloqueios/:id_usuario (id_bloqueado no body),
// pra ficar com :id_usuario como as outras e caber no autorizarUsuario global.
router.get("/bloqueios/:id_usuario", bloqueioController.listarBloqueados)
router.post("/bloqueios/:id_usuario", bloqueioController.bloquear)
router.delete("/bloqueios/:id_usuario/:id_bloqueado", bloqueioController.desbloquear)

module.exports = router
