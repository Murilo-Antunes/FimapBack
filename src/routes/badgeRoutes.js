const express = require("express")
const router = express.Router()

const badgeController = require("../controller/Badge/BadgeController.js")
const badgeUserController = require("../controller/BadgeUser/badgeUserController.js")
const badgeDestaqueController = require("../controller/BadgeUser/badgeDestaqueController.js")
const badgeProgressoController = require("../controller/BadgeUser/badgeProgressoController.js") 
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')

router.use(autenticar, autorizarUsuario)

router.get("/badge-usuario/destaques/:id_usuario", badgeDestaqueController.buscarBadgesDestaque)   
router.patch("/badge-usuario/destaques/:id_usuario", badgeDestaqueController.definirBadgesDestaque)
router.get("/badge-usuario/progresso/:id_usuario", badgeProgressoController.buscarProgresso)       

router.get("/badge-usuario/:id_usuario", badgeUserController.BuscarBadgesUsuario)

router.get("/badges", badgeController.buscarTodasBadges)

module.exports = router
