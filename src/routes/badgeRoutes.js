const express = require("express")
const router = express.Router()

const badgeController = require("../controller/Badge/BadgeController.js")
const badgeUserController = require("../controller/BadgeUser/badgeUserController.js")
const badgeDestaqueController = require("../controller/BadgeUser/badgeDestaqueController.js")
const badgeProgressoController = require("../controller/BadgeUser/badgeProgressoController.js") 

router.get("/badge-usuario/destaques/:id_usuario", badgeDestaqueController.buscarBadgesDestaque)   
router.patch("/badge-usuario/destaques/:id_usuario", badgeDestaqueController.definirBadgesDestaque)
router.get("/badge-usuario/progresso/:id_usuario", badgeProgressoController.buscarProgresso)       

router.post("/badge-usuario", badgeUserController.AtrelarBadgeUsuario)
router.get("/badge-usuario/:id_usuario", badgeUserController.BuscarBadgesUsuario)
router.delete("/badge-usuario", badgeUserController.RemoverBadgeUsuario)

router.post("/criar-badge", badgeController.criarBadge)
router.patch("/badge-update/:id_badge", badgeController.atualizarBadge)
router.get("/badges", badgeController.buscarTodasBadges)
router.delete("/badge-delete/:id_badge", badgeController.deletarBadge)

module.exports = router
