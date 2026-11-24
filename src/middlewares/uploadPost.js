const multer = require('multer')

const CAMPOS_ARQUIVO = [
    { name: 'conteudo[foto]', maxCount: 10 },
    { name: 'conteudo[midia]', maxCount: 10 }
]

const TIPOS_PERMITIDOS = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4'
])

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 10,
        fields: 20,
        fieldSize: 192 * 1024,
        parts: 30
    },
    fileFilter: (_req, file, callback) => {
        if (TIPOS_PERMITIDOS.has(file.mimetype)) return callback(null, true)
        return callback(new Error('TIPO_ARQUIVO_NAO_PERMITIDO'))
    }
})

// Permite JSON como antes e processa multipart com até 10 mídias.
const uploadPost = (req, res, next) => {
    upload.fields(CAMPOS_ARQUIVO)(req, res, (erro) => {
        if (!erro) return next()

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                sucesso: false,
                mensagem: 'Cada foto ou vídeo deve ter no máximo 25 MB.'
            })
        }

        if (erro.code === 'LIMIT_FILE_COUNT' || erro.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Um post aceita no máximo 10 fotos e vídeos. Use os campos conteudo[foto] e conteudo[midia].'
            })
        }

        if (erro.message === 'TIPO_ARQUIVO_NAO_PERMITIDO') {
            return res.status(400).json({
                sucesso: false,
                mensagem: 'Envie imagens JPG, PNG ou WebP e vídeos MP4.'
            })
        }

        console.error('Erro ao processar arquivos do post:', erro)
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Não foi possível processar os arquivos enviados.'
        })
    })
}

module.exports = uploadPost
