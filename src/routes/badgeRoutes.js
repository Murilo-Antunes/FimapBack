const express = require("express")
const router = express.Router()

const badgeController = require("../controller/Badge/BadgeController.js")
const badgeUserController = require("../controller/BadgeUser/badgeUserController.js")
const badgeDestaqueController = require("../controller/BadgeUser/badgeDestaqueController.js")
const badgeProgressoController = require("../controller/BadgeUser/badgeProgressoController.js")
const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
const { exigirAcessoAoPerfil } = require('../middlewares/privacidadePerfil.js')

// Só autentica aqui (confirma o token, popula req.usuario). autorizarUsuario
// (dono = :id_usuario) e exigirAcessoAoPerfil (perfil privado/bloqueio) entram
// rota a rota: nem toda rota daqui é "só do dono" — ver badges de OUTRO
// usuário é o caso normal do perfil público.
router.use(autenticar)

// Só o dono mexe nos próprios destaques/progresso.
router.get("/badge-usuario/destaques/:id_usuario", autorizarUsuario, badgeDestaqueController.buscarBadgesDestaque)
router.patch("/badge-usuario/destaques/:id_usuario", autorizarUsuario, badgeDestaqueController.definirBadgesDestaque)
router.get("/badge-usuario/progresso/:id_usuario", autorizarUsuario, badgeProgressoController.buscarProgresso)

// Badges conquistadas: isso alimenta o perfil PÚBLICO — qualquer autenticado
// pode ver as de outro usuário, respeitando perfil privado/bloqueio.
router.get("/badge-usuario/:id_usuario", exigirAcessoAoPerfil("id_usuario"), badgeUserController.BuscarBadgesUsuario)

// Catálogo de badges: não é de ninguém específico, só precisa estar logado.
router.get("/badges", badgeController.buscarTodasBadges)

module.exports = router
