const multer = require('multer')

const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp']
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024

// A foto vai por multipart (o express.json aceita no máximo 192 KB), campo "foto".
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANHO_MAX_BYTES, files: 1 },
    fileFilter: (req, file, cb) =>
        TIPOS_PERMITIDOS.includes(file.mimetype)
            ? cb(null, true)
            : cb(new Error('TIPO_ARQUIVO_NAO_PERMITIDO'))
})

// Middleware com tratamento de erro próprio (respostas no mesmo formato da API)
const uploadFotoPerfil = (req, res, next) => {
    upload.single('foto')(req, res, (erro) => {
        if (!erro) return next()

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ sucesso: false, mensagem: 'A foto deve ter no máximo 5 MB.' })
        }

        if (erro.message === 'TIPO_ARQUIVO_NAO_PERMITIDO') {
            return res.status(400).json({ sucesso: false, mensagem: 'Envie uma imagem JPG, PNG ou WebP.' })
        }

        console.error('Erro no upload da foto de perfil:', erro)
        return res.status(400).json({ sucesso: false, mensagem: 'Não foi possível processar a foto enviada.' })
    })
}

module.exports = uploadFotoPerfil
