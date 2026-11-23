const express = require("express")
const router = express.Router()

const denunciaUsuarioController = require("../controller/Comunidade/Denuncia/denunciaUsuarioController.js")
router.use(require('../middlewares/autorization.js'), require('../middlewares/autorizarUsuario.js'))

// Sugestão de montagem: app.use("/v1/comunidade/denuncias", denunciaUsuarioRoutes)
router.post("/denunciar-usuario", denunciaUsuarioController.criarDenunciaUsuario)

module.exports = router
