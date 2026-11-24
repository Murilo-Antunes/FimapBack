const config_message = require('../modulo/configMensagens.js')
const crypto = require('crypto')
const codigoOTPModel = require('../../../model/DAO/condigo_OTP/codigo_otp_DAO.js')
const dispositivoModel = require('../../../model/DAO/Dispositivos/dispositivos.js')
const usuarioModel = require('../../../model/DAO/Usuario/usuarioDAO.js')
const usuarioSocialDAO = require('../../../model/DAO/Usuario/usuarioSocialDAO.js')
const { UploadArquivo, ExcluirVarias } = require('../../services/cloudinary.js')
const { enviarOTP } = require('../../config/email.js')
const { gerarToken } = require('../../services/jwtService.js')

const { verificarAcesso, idDoVisualizador, responderAcessoNegado } = require('../../middlewares/privacidadePerfil.js')

const OTP_VALIDADE_MS = 5 * 60 * 1000
const SENHA_MIN_CARACTERES = 8

// Campos que o próprio usuário pode editar (xp, nível e e-mail ficam de fora).
// A senha pode ser editada, mas exige um código OTP válido (ver atualizarUsuario).
const CAMPOS_EDITAVEIS = [
    'nome',
    'username',
    'senha',
    'foto_perfil',
    'nome_exibicao',
    'username_social',
    'biografia_social',
    'localizacao_estado',
    'visibilidade'
]

// username_social: 3 a 30 caracteres [a-z0-9._], sem . ou _ no início/fim nem em sequência
const REGEX_USERNAME_SOCIAL = /^(?![._])(?!.*[._]{2})[a-z0-9._]{3,30}(?<![._])$/

// Valida os campos sociais de `dados` (normaliza trim e minúsculas do username).
// Devolve { campo: 'mensagem' }; objeto vazio = tudo certo.
const validarCamposSociais = (dados) => {
    const campos = {}

    for (const nome of ['nome_exibicao', 'username_social', 'biografia_social', 'localizacao_estado']) {
        if (dados[nome] === undefined) continue

        if (typeof dados[nome] !== 'string') {
            campos[nome] = 'Valor inválido.'
            continue
        }

        dados[nome] = dados[nome].trim()
    }

    if (typeof dados.username_social === 'string') {
        dados.username_social = dados.username_social.toLowerCase()
    }

    if (typeof dados.nome_exibicao === 'string' &&
        (dados.nome_exibicao.length < 2 || dados.nome_exibicao.length > 80)) {
        campos.nome_exibicao = 'O nome de exibição deve ter entre 2 e 80 caracteres.'
    }

    if (typeof dados.username_social === 'string' && !REGEX_USERNAME_SOCIAL.test(dados.username_social)) {
        campos.username_social = 'Nome de usuário social inválido.'
    }

    if (typeof dados.biografia_social === 'string' && dados.biografia_social.length > 250) {
        campos.biografia_social = 'A biografia deve ter no máximo 250 caracteres.'
    }

    if (typeof dados.localizacao_estado === 'string' && dados.localizacao_estado.length > 60) {
        campos.localizacao_estado = 'A localização deve ter no máximo 60 caracteres.'
    }

    return campos
}

const responderUsernameSocialEmUso = (res) =>
    res.status(409).json({
        sucesso: false,
        codigo: 'USERNAME_SOCIAL_EM_USO',
        mensagem: 'Este nome de usuário já está em uso.'
    })

// Gera OTP de 6 dígitos
const gerarCodigo = () => crypto.randomInt(100000, 1000000).toString()

// Valida tamanho mínimo da senha
const senhaValida = (senha) =>
    typeof senha === 'string' && senha.length >= SENHA_MIN_CARACTERES

// Valida id numérico positivo
const idValido = (id) => Number.isInteger(id) && id > 0

// Resposta padrão de erro
const responderErro = (res, cfg) =>
    res.status(cfg.status).json({ sucesso: false, mensagem: cfg.mensagem })

// Resposta de erro de senha curta
const responderSenhaCurta = (res) =>
    res.status(400).json({
        sucesso: false,
        mensagem: `A senha deve ter pelo menos ${SENHA_MIN_CARACTERES} caracteres.`
    })

// Resposta de código OTP inválido
const responderOTPInvalido = (res) =>
    res.status(400).json({
        sucesso: false,
        mensagem: 'Código inválido ou expirado.'
    })

// Remove a senha do objeto de usuário antes de enviar na resposta
const semSenha = ({ senha, ...resto }) => resto

// Remove o valor do código OTP antes de enviar na resposta
const semCodigo = ({ codigo, ...resto }) => resto

// O DAO pode devolver o id como "id" ou "id_usuario"; aceita os dois
const idDoUsuario = (usuario) => usuario.id ?? usuario.id_usuario

// Valida e normaliza os dados do dispositivo enviados no login
const montarDispositivo = (dados) => {
    const { nome, sistema_operacional, identificador } = dados || {}

    if (!nome || !sistema_operacional || !identificador) {
        return null
    }

    return {
        nome: String(nome).trim(),
        sistema_operacional: String(sistema_operacional).trim(),
        identificador: String(identificador).trim()
    }
}

// Rollback do cadastro (NÃO é handler Express). Nunca lança erro.
const desfazerCadastro = async (id_usuario) => {
    if (!id_usuario) return

    try {
        await usuarioModel.DeleteUsers(id_usuario)
    } catch (erro) {
        console.error('Erro no rollback do usuário:', erro)
    }
}

// Garante que o dispositivo está registrado para o usuário, sem duplicar.
// Retorna true se já existia ou foi criado agora; false se não foi possível.
const garantirDispositivo = async (id_usuario, aparelho) => {
    const existente = await dispositivoModel.GetDispositivoByIdentificador(
        id_usuario,
        aparelho.identificador
    )

    if (existente) return true

    const id_dispositivo = await dispositivoModel.CreateDispositivo({
        ...aparelho,
        id_usuario
    })

    if (id_dispositivo) return true

    // Pode ter sido uma corrida (outro login criou o mesmo dispositivo agora há pouco)
    const criadoPorOutraRequisicao = await dispositivoModel.GetDispositivoByIdentificador(
        id_usuario,
        aparelho.identificador
    )

    return Boolean(criadoPorOutraRequisicao)
}

// Cria o usuário, o OTP, e envia por e-mail.
// Se qualquer etapa falhar, o usuário criado é apagado.
const criarCodigoOTPUsuario = async (req, res) => {
    let id_usuario = null

    try {
        const usuario = req.body

        if (!usuario || !usuario.email || !usuario.senha) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        if (!senhaValida(usuario.senha)) {
            return responderSenhaCurta(res)
        }

        const usuarioExiste = await usuarioModel.ValidarUser(usuario)

        if (usuarioExiste) {
            return responderErro(res, config_message.DADOS_USUARIO_EXISTENTES)
        }

        // 1. cria o usuário (o DAO faz o hash da senha)
        id_usuario = await usuarioModel.CreateUsers(usuario)

        if (!id_usuario) {
            return responderErro(res, config_message.ERRO_CRIAR_USUARIO)
        }


        // 3. cria o código ligado ao usuário
        const codigo = gerarCodigo()

        const id_codigo_otp = await codigoOTPModel.CreateCodigoOTP({
            codigo,
            data_expiracao: new Date(Date.now() + OTP_VALIDADE_MS),
            id_usuario
        })

        if (!id_codigo_otp) {
            await desfazerCadastro(id_usuario)
            return responderErro(res, config_message.ERRO_GERAR_OTP)
        }

        // 4. envia o e-mail; se falhar, apaga tudo
        try {
            await enviarOTP(usuario.email, codigo)
        } catch (erroEmail) {
            console.error('Erro ao enviar OTP:', erroEmail)
            await desfazerCadastro(id_usuario)
            return responderErro(res, config_message.ERRO_ENVIAR_OTP)
        }

        return res.status(config_message.USUARIO_CRIADO.status).json({
            sucesso: true,
            mensagem: 'Usuário criado. Verifique seu e-mail para obter o código OTP.',
            id_usuario
        })
    } catch (error) {
        console.error('Erro ao criar usuário:', error)
        await desfazerCadastro(id_usuario)
        return responderErro(res, config_message.ERRO_CRIAR_USUARIO)
    }
}

// Confirma o código OTP enviado no cadastro
const verificarOTPCadastro = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { codigo } = req.body || {}

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        if (!codigo) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const otp = await codigoOTPModel.GetCodigoOTPValido(id_usuario, String(codigo))

        if (!otp) {
            return responderOTPInvalido(res)
        }

        await codigoOTPModel.DesativarCodigoOTP(id_usuario, String(codigo))

        return res.status(200).json({
            sucesso: true,
            mensagem: 'E-mail verificado com sucesso.'
        })
    } catch (error) {
        console.error('Erro ao verificar OTP do cadastro:', error)
        return responderErro(res, config_message.ERRO_GERAR_OTP)
    }
}

// Atualizar dados do próprio usuário autenticado. Recuperação sem sessão usa
// redefinirSenhaComOTP, que valida e consome o código antes de gravar a senha.
const atualizarUsuario = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        const dados = Object.fromEntries(
            Object.entries(req.body || {}).filter(([campo]) => CAMPOS_EDITAVEIS.includes(campo))
        )

        if (Object.keys(dados).length === 0) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const trocandoSenha = dados.senha !== undefined

        // Troca de senha exige tamanho mínimo e código OTP válido
        if (trocandoSenha) {
            if (!senhaValida(dados.senha)) {
                return responderSenhaCurta(res)
            }
        }

        // Campos sociais: validação de formato e tamanho
        const camposInvalidos = validarCamposSociais(dados)

        if (Object.keys(camposInvalidos).length > 0) {
            return res.status(400).json({
                sucesso: false,
                codigo: 'VALIDACAO',
                mensagem: 'Corrija os campos informados.',
                campos: camposInvalidos
            })
        }

        // username_social é único (o índice do banco é a garantia final)
        if (dados.username_social) {
            const dono = await usuarioSocialDAO.GetUsuarioByUsernameSocial(dados.username_social)

            if (dono && Number(dono.id) !== id_usuario) {
                return responderUsernameSocialEmUso(res)
            }
        }

        // Se for trocar o username, garante que não pertence a outro usuário
        if (dados.username) {
            const existente = await usuarioModel.GetUsuarioByUsername(dados.username)

            if (existente && idDoUsuario(existente) !== id_usuario) {
                return responderErro(res, config_message.DADOS_USUARIO_EXISTENTES)
            }
        }

        // Senha em texto puro: o DAO faz o hash
        const atualizado = await usuarioModel.UpdateUsers({ ...dados, id_usuario })

        if (!atualizado) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        return res.status(config_message.USUARIO_ATUALIZADO.status).json({
            sucesso: true,
            mensagem: config_message.USUARIO_ATUALIZADO.mensagem
        })
    } catch (error) {
        // Corrida entre dois usuários escolhendo o mesmo @ (índice único)
        if (error?.code === 'ER_DUP_ENTRY' && String(error.sqlMessage ?? '').includes('username_social')) {
            return responderUsernameSocialEmUso(res)
        }

        console.error('Erro ao atualizar usuário:', error)
        return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
    }
}

// PASSO 1 da troca de senha: gera o OTP e envia por e-mail
const solicitarOTPAlteracaoSenha = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        const usuario = await usuarioModel.GetUsuarioById(id_usuario)

        if (!usuario) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        const codigo = gerarCodigo()

        const id_codigo_otp = await codigoOTPModel.CreateCodigoOTP({
            codigo,
            data_expiracao: new Date(Date.now() + OTP_VALIDADE_MS),
            id_usuario
        })

        if (!id_codigo_otp) {
            return responderErro(res, config_message.ERRO_GERAR_OTP)
        }

        try {
            await enviarOTP(usuario.email, codigo)
        } catch (erroEmail) {
            console.error('Erro ao enviar OTP:', erroEmail)
            return responderErro(res, config_message.ERRO_ENVIAR_OTP)
        }

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Código enviado para o seu e-mail.'
        })
    } catch (error) {
        console.error('Erro ao solicitar OTP:', error)
        return responderErro(res, config_message.ERRO_GERAR_OTP)
    }
}

// Recuperação pública de senha: o OTP enviado ao e-mail é a prova de posse da conta.
const redefinirSenhaComOTP = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { codigo, novaSenha } = req.body || {}

        if (!idValido(id_usuario) || !codigo || !senhaValida(novaSenha)) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Informe um código válido e uma nova senha com pelo menos 8 caracteres.'
            })
        }

        const otp = await codigoOTPModel.GetCodigoOTPValido(id_usuario, String(codigo))
        if (!otp || !await codigoOTPModel.DesativarCodigoOTP(id_usuario, String(codigo))) {
            return responderOTPInvalido(res)
        }

        const atualizado = await usuarioModel.UpdateUsers({ id_usuario, senha: novaSenha })
        if (!atualizado) return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)

        return res.status(200).json({ sucesso: true, mensagem: 'Senha redefinida com sucesso.' })
    } catch (error) {
        console.error('Erro ao redefinir senha por OTP:', error)
        return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
    }
}

// PASSO 2 da troca de senha: só confere o código, SEM consumir.
// O código é consumido no PASSO 3 (atualizarUsuario, ao enviar "senha" + "codigo").
const verificarCodigoAlteracaoSenha = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { codigo } = req.body || {}

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        if (!codigo) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const otp = await codigoOTPModel.GetCodigoOTPValido(id_usuario, String(codigo))

        if (!otp) {
            return responderOTPInvalido(res)
        }

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Código válido.'
        })
    } catch (error) {
        console.error('Erro ao verificar código:', error)
        return responderErro(res, config_message.ERRO_GERAR_OTP)
    }
}

// Confere a senha ATUAL do usuário logado (tela "Alterar Senha" em Configurações).
// Diferente do login: não exige nem registra dispositivo e não devolve dados do usuário.
const verificarSenhaAtual = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { senha } = req.body || {}

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        if (!senha) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const usuario = await usuarioModel.GetUsuarioById(id_usuario)

        const senhaCorreta = usuario
            ? await usuarioModel.ValidarSenha(senha, usuario.senha)
            : false

        // Mesma resposta para usuário inexistente e senha errada
        if (!senhaCorreta) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Senha atual incorreta.'
            })
        }

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Senha confirmada.'
        })
    } catch (error) {
        console.error('Erro ao verificar senha atual:', error)
        return responderErro(res, config_message.ERRO_LOGIN)
    }
}

// Troca de senha do usuário logado: confere a senha ATUAL e grava a nova numa única chamada.
// Aqui a prova de identidade é a própria senha atual, por isso não exige OTP.
const alterarSenhaComSenhaAtual = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { senhaAtual, novaSenha } = req.body || {}

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        if (!senhaAtual || !novaSenha) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        if (!senhaValida(novaSenha)) {
            return responderSenhaCurta(res)
        }

        const usuario = await usuarioModel.GetUsuarioById(id_usuario)

        const senhaCorreta = usuario
            ? await usuarioModel.ValidarSenha(senhaAtual, usuario.senha)
            : false

        // Mesma resposta para usuário inexistente e senha errada
        if (!senhaCorreta) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Senha atual incorreta.'
            })
        }

        if (senhaAtual === novaSenha) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'A nova senha deve ser diferente da atual.'
            })
        }

        // Senha em texto puro: o DAO faz o hash
        const atualizado = await usuarioModel.UpdateUsers({ id_usuario, senha: novaSenha })

        if (!atualizado) {
            return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
        }

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Senha alterada com sucesso.'
        })
    } catch (error) {
        console.error('Erro ao alterar senha com senha atual:', error)
        return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
    }
}

// Deletar usuário
const deletarUsuario = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        const deletado = await usuarioModel.DeleteUsers(id_usuario)

        if (!deletado) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        return res.status(config_message.USUARIO_DELETADO.status).json({
            sucesso: true,
            mensagem: config_message.USUARIO_DELETADO.mensagem
        })
    } catch (error) {
        console.error('Erro ao deletar usuário:', error)
        return responderErro(res, config_message.ERRO_DELETAR_USUARIO)
    }
}

// Buscar usuário pelo username
const buscarUsuarioPorUsername = async (req, res) => {
    try {
        const { username } = req.params

        if (!username) {
            return responderErro(res, config_message.USERNAME_OBRIGATORIO)
        }

        const usuario = await usuarioModel.GetUsuarioByUsername(username)

        if (!usuario) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        return res.status(config_message.USUARIO_ENCONTRADO.status).json({
            sucesso: true,
            mensagem: config_message.USUARIO_ENCONTRADO.mensagem,
            usuario: semSenha(usuario)
        })
    } catch (error) {
        console.error('Erro ao buscar usuário:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIO)
    }
}

const buscarUsuarioPorUsernameSocial = async (req, res) => {
    try {
        const username_social = typeof req.params?.username_social === 'string' ? req.params.username_social.trim() : ''

        if (!username_social) {
            return res.status(400).json({ sucesso: false, mensagem: 'Informe um username válido.' })
        }

        const usuario = await usuarioModel.BuscarUsuarioPorUsernameSocial(username_social)

        if (!usuario) {
            return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado.' })
        }

        const acesso = await verificarAcesso(idDoVisualizador(req), Number(usuario.id))

        if (acesso === 'inexistente' || acesso === 'indisponivel') {
            return responderAcessoNegado(res, acesso)
        }

        if (acesso === 'restrito') {
            // Só o necessário pra montar a tela de perfil privado — nada de métricas, bio ou badges.
            const { id, nome, nome_exibicao, username_social: handle, foto_perfil, visibilidade, data_cadastro } = usuario

            return res.status(200).json({
                sucesso: true,
                mensagem: 'Perfil privado.',
                usuario: { id, nome, nome_exibicao, username_social: handle, foto_perfil, visibilidade, data_cadastro, acesso_restrito: true },
            })
        }

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Usuário encontrado.',
            usuario: { ...semSenha(usuario), acesso_restrito: false },
        })

    } catch (error) {
        console.error('Erro ao buscar usuário por username:', error)
        return res.status(500).json({ sucesso: false, mensagem: 'Erro interno do servidor.' })
    }
}

// Buscar todos os usuários
const buscarTodosUsuarios = async (req, res) => {
    try {
        const usuarios = await usuarioModel.GetAllUsers()

        if (usuarios === false) {
            return responderErro(res, config_message.ERRO_BUSCAR_USUARIOS)
        }

        const usuariosSemSenha = usuarios.map(semSenha)

        return res.status(config_message.USUARIOS_ENCONTRADOS.status).json({
            sucesso: true,
            mensagem: config_message.USUARIOS_ENCONTRADOS.mensagem,
            quantidade: usuariosSemSenha.length,
            usuarios: usuariosSemSenha
        })
    } catch (error) {
        console.error('Erro ao buscar usuários:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIOS)
    }
}

// Buscar todos os códigos OTP (sem expor o valor do código)
const buscarTodosCodigos = async (req, res) => {
    try {
        const codigos = await codigoOTPModel.GetAllCodigoOTP()

        if (codigos === false) {
            return responderErro(res, config_message.ERRO_BUSCAR_USUARIOS)
        }

        const codigosSemValor = codigos.map(semCodigo)

        return res.status(config_message.USUARIOS_ENCONTRADOS.status).json({
            sucesso: true,
            mensagem: config_message.USUARIOS_ENCONTRADOS.mensagem,
            quantidade: codigosSemValor.length,
            codigos: codigosSemValor
        })
    } catch (error) {
        console.error('Erro ao buscar códigos OTP:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIOS)
    }
}

// Buscar usuário pelo ID
const buscarUsuarioPorId = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        const usuario = await usuarioModel.GetUsuarioById(id_usuario)

        if (!usuario) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        return res.status(config_message.USUARIO_ENCONTRADO.status).json({
            sucesso: true,
            mensagem: config_message.USUARIO_ENCONTRADO.mensagem,
            usuario: semSenha(usuario)
        })
    } catch (error) {
        console.error('Erro ao buscar usuário por ID:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIO)
    }
}

// Buscar usuário pelo email
const buscarUsuarioPorEmail = async (req, res) => {
    try {
        const { email } = req.params

        if (!email) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'E-mail obrigatório.'
            })
        }

        const usuario = await usuarioModel.GetUsuarioByEmail(email)

        if (!usuario) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        return res.status(config_message.USUARIO_ENCONTRADO.status).json({
            sucesso: true,
            mensagem: config_message.USUARIO_ENCONTRADO.mensagem,
            usuario: semSenha(usuario)
        })
    } catch (error) {
        console.error('Erro ao buscar usuário por email:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIO)
    }
}

// Login: valida credenciais e registra o dispositivo (sem duplicar)
const login = async (req, res) => {
    try {
        const { username, email, senha, dispositivo } = req.body || {}
        const loginInformado = String(username || email || '').trim()

        if (!loginInformado || !senha) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const aparelho = montarDispositivo(dispositivo)

        if (!aparelho) {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Dados do dispositivo obrigatórios (nome, sistema_operacional e identificador).'
            })
        }

        // "@" indica e-mail, senão é username
        const usuario = loginInformado.includes('@')
            ? await usuarioModel.GetUsuarioByEmail(loginInformado)
            : await usuarioModel.GetUsuarioByUsername(loginInformado)

        const senhaCorreta = usuario
            ? await usuarioModel.ValidarSenha(senha, usuario.senha)
            : false

        // Mesma resposta para usuário inexistente e senha errada
        if (!senhaCorreta) {
            return responderErro(res, config_message.SENHA_INVALIDA)
        }

        // Só cadastra o dispositivo se ainda não existir. Falha aqui NUNCA apaga o usuário.
        const dispositivoOk = await garantirDispositivo(idDoUsuario(usuario), aparelho)

        if (!dispositivoOk) {
            return res.status(500).json({
                sucesso: false,
                mensagem: 'Erro ao cadastrar o dispositivo.'
            })
        }

        const token = gerarToken({ sub: String(idDoUsuario(usuario)) })
        if (!token) {
            return res.status(503).json({
                sucesso: false,
                codigo: 'JWT_CONFIGURACAO',
                mensagem: 'A autenticação não está configurada com um segredo seguro.'
            })
        }

        return res.status(config_message.LOGIN_SUCESSO.status).json({
            sucesso: true,
            mensagem: config_message.LOGIN_SUCESSO.mensagem,
            usuario: semSenha(usuario),
            access_token: token,
            tipo_token: 'Bearer'
        })
    } catch (error) {
        console.error('Erro ao realizar login:', error)
        return responderErro(res, config_message.ERRO_LOGIN)
    }
}

// Valida (e consome) um código OTP
const validarCodigoOTP = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)
        const { codigo } = req.body || {}

        if (!idValido(id_usuario) || !codigo) {
            return responderErro(res, config_message.CAMPOS_OBRIGATORIOS)
        }

        const otp = await codigoOTPModel.GetCodigoOTPValido(id_usuario, String(codigo))

        if (!otp) {
            return responderOTPInvalido(res)
        }

        await codigoOTPModel.DesativarCodigoOTP(id_usuario, String(codigo))

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Código OTP validado com sucesso.'
        })
    } catch (error) {
        console.error('Erro ao validar código OTP:', error)
        return responderErro(res, config_message.ERRO_GERAR_OTP)
    }
}

// GET /social/username-disponivel/:username_social?id_usuario=
// Diz se o @ está livre (ou já é do próprio usuário que consulta).
const verificarUsernameSocial = async (req, res) => {
    try {
        const username = String(req.params.username_social || '').trim().toLowerCase()
        const id_usuario = Number(req.query?.id_usuario)

        if (!REGEX_USERNAME_SOCIAL.test(username)) {
            return res.status(400).json({
                sucesso: false,
                codigo: 'USERNAME_SOCIAL_INVALIDO',
                mensagem: 'Nome de usuário social inválido.'
            })
        }

        const dono = await usuarioSocialDAO.GetUsuarioByUsernameSocial(username)
        const disponivel = !dono || (idValido(id_usuario) && Number(dono.id) === id_usuario)

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Consulta realizada.',
            disponivel
        })
    } catch (error) {
        console.error('Erro ao verificar username social:', error)
        return responderErro(res, config_message.ERRO_BUSCAR_USUARIO)
    }
}

// POST /foto-perfil/:id_usuario (multipart, campo "foto")
// Sobe a foto ao Cloudinary, grava em foto_perfil e apaga a anterior.
const enviarFotoPerfil = async (req, res) => {
    let urlNova = null

    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        if (!req.file) {
            return res.status(400).json({ sucesso: false, mensagem: 'Envie uma foto no campo "foto".' })
        }

        const atual = await usuarioSocialDAO.GetFotoPerfil(id_usuario)

        if (!atual) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        urlNova = await UploadArquivo(req.file, `perfis/${id_usuario}`)

        await usuarioSocialDAO.UpdateFotoPerfil(id_usuario, urlNova)

        // A foto nova já está salva; falha ao apagar a antiga não deve derrubar a resposta
        const anterior = atual.foto_perfil
        urlNova = null

        if (anterior) {
            try {
                await ExcluirVarias([anterior])
            } catch (erro) {
                console.error('Erro ao excluir a foto anterior:', erro)
            }
        }

        const atualizada = await usuarioSocialDAO.GetFotoPerfil(id_usuario)

        return res.status(200).json({
            sucesso: true,
            mensagem: 'Foto de perfil atualizada.',
            foto_perfil: atualizada?.foto_perfil ?? null
        })
    } catch (error) {
        // Upload feito mas o UPDATE falhou: não deixa arquivo órfão
        if (urlNova) {
            try { await ExcluirVarias([urlNova]) } catch (_) { /* já registrado abaixo */ }
        }

        console.error('Erro ao enviar foto de perfil:', error)
        return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
    }
}

// DELETE /foto-perfil/:id_usuario
const removerFotoPerfil = async (req, res) => {
    try {
        const id_usuario = Number(req.params.id_usuario)

        if (!idValido(id_usuario)) {
            return responderErro(res, config_message.ID_USUARIO_INVALIDO)
        }

        const atual = await usuarioSocialDAO.GetFotoPerfil(id_usuario)

        if (!atual) {
            return responderErro(res, config_message.USUARIO_NAO_ENCONTRADO)
        }

        await usuarioSocialDAO.UpdateFotoPerfil(id_usuario, null)

        if (atual.foto_perfil) {
            try {
                await ExcluirVarias([atual.foto_perfil])
            } catch (erro) {
                console.error('Erro ao excluir a foto do Cloudinary:', erro)
            }
        }

        return res.status(200).json({ sucesso: true, mensagem: 'Foto de perfil removida.' })
    } catch (error) {
        console.error('Erro ao remover foto de perfil:', error)
        return responderErro(res, config_message.ERRO_ATUALIZAR_USUARIO)
    }
}

module.exports = {
    criarCodigoOTPUsuario,
    verificarOTPCadastro,
    atualizarUsuario,
    verificarUsernameSocial,
    enviarFotoPerfil,
    removerFotoPerfil,
    solicitarOTPAlteracaoSenha,
    redefinirSenhaComOTP,
    verificarCodigoAlteracaoSenha,
    verificarSenhaAtual,
    alterarSenhaComSenhaAtual,
    deletarUsuario,
    buscarUsuarioPorUsername,
    buscarTodosUsuarios,
    buscarUsuarioPorId,
    buscarUsuarioPorEmail,
    login,
    validarCodigoOTP,
    buscarTodosCodigos,
    buscarUsuarioPorUsernameSocial
}
