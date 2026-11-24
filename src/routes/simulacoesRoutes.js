const express = require('express')
const router = express.Router()

const simulacaoInvestimentoController = require('../controller/Simulacoes/SimulacaoInvestimentoController.js')
const simulacaoAmortizacaoController = require('../controller/Simulacoes/SimulacaoAmortizacaoController.js')
const indicadoresController = require('../controller/Simulacoes/IndicadoresController.js')

const autenticar = require('../middlewares/autorization.js')
const autorizarUsuario = require('../middlewares/autorizarUsuario.js')
router.use(autenticar, autorizarUsuario)

// As operações usam o ID autenticado pelo JWT, nunca o ID informado pelo cliente.

router.get('/indicadores', indicadoresController.consultarIndicadores)

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
