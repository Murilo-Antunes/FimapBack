const jwt = require('jsonwebtoken');

const expiresIn = process.env.JWT_EXPIRATION || '1h';
const segredoConfigurado = () => typeof process.env.JWT_SECRET === 'string' &&
    Buffer.byteLength(process.env.JWT_SECRET, 'utf8') >= 32;

// Função para gerar um token JWT
const gerarToken = (payload) => {
    const secret = process.env.JWT_SECRET;
    if (!secret || !segredoConfigurado()) return null;
    return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn });
};

// Função para validar um token JWT
const validarToken = (token) => {
    const secret = process.env.JWT_SECRET;
    if (!secret || !segredoConfigurado()) return null;
    try {
        return jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (error) {
        console.error('Erro ao validar token JWT:', error.message);
        return null; // Retorna null se o token for inválido ou expirado
    }
};

module.exports = {
    gerarToken,
    validarToken,
    segredoConfigurado,
};
