const express = require('express')
const router = express.Router()
const autenticar = require('../middlewares/autorization.js')

const simulacaoInvestimentoController = require('../controller/Simulacoes/SimulacaoInvestimentoController.js')
const simulacaoAmortizacaoController = require('../controller/Simulacoes/SimulacaoAmortizacaoController.js')
const indicadoresController = require('../controller/Simulacoes/IndicadoresController.js')

router.get('/indicadores', indicadoresController.consultarIndicadores)

// As simulações salvas pertencem ao usuário identificado pelo JWT.
router.use(autenticar, require('../middlewares/autorizarUsuario.js'))

router.get('/investimentos', simulacaoInvestimentoController.listarSimulacoesInvestimento)
router.post('/investimentos', simulacaoInvestimentoController.criarSimulacaoInvestimento)
router.get('/investimentos/:simulacaoId', simulacaoInvestimentoController.consultarSimulacaoInvestimento)
router.patch('/investimentos/:simulacaoId', simulacaoInvestimentoController.atualizarSimulacaoInvestimento)
router.delete('/investimentos/:simulacaoId', simulacaoInvestimentoController.removerSimulacaoInvestimento)

router.get('/amortizacoes', simulacaoAmortizacaoController.listarSimulacoesAmortizacao)
router.post('/amortizacoes', simulacaoAmortizacaoController.criarSimulacaoAmortizacao)
router.get('/amortizacoes/:simulacaoId', simulacaoAmortizacaoController.consultarSimulacaoAmortizacao)
router.patch('/amortizacoes/:simulacaoId', simulacaoAmortizacaoController.atualizarSimulacaoAmortizacao)
router.delete('/amortizacoes/:simulacaoId', simulacaoAmortizacaoController.removerSimulacaoAmortizacao)

module.exports = router
