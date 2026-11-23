# Autenticação da API

O login (`POST /v1/openfinance/usuario/login`) retorna `access_token`. Envie-o nas rotas protegidas:

```http
Authorization: Bearer <access_token>
```

O token contém o ID do usuário no claim `sub` e usa HS256. `JWT_SECRET` precisa ter pelo menos 32 bytes; gere um valor aleatório e diferente por ambiente (por exemplo, `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`). O arquivo `.env.example` deixa esse campo vazio de propósito.

As rotas de cadastro, login, validação de OTP e recuperação de senha são públicas para permitir criar e recuperar uma conta. A consulta de perfil social por username e a disponibilidade do username também são públicas. `/ping`, `/health` e o chat público seguem públicos. As outras rotas exigem JWT.

IDs de usuário enviados para operações privadas precisam corresponder ao `sub` do token. Consultas a dados do Open Finance também verificam se o item pertence ao usuário autenticado.

O login agora devolve `access_token` e `tipo_token: "Bearer"`. Para redefinir uma senha sem sessão, solicite um código em `POST /v1/openfinance/usuario/codigo-otp/senha/:id_usuario` e envie `codigo` e `novaSenha` para `POST /v1/openfinance/usuario/senha/redefinir/:id_usuario`. Essas tentativas têm limite por IP.
