const express = require("express")
const router = express.Router()

const nivelController = require("../controller/Nivel/nivelController.js")
router.use(require('../middlewares/autorization.js'))

// Sugestão de montagem: app.use("/v1/comunidade", nivelRoutes) -> GET /v1/comunidade/niveis
router.get("/niveis", nivelController.buscarNiveis)

module.exports = router
