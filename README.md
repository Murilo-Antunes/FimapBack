<!--
PARA QUE SERVE: apresentar o projeto e os comandos iniciais.
QUANDO ENTRA EM AÇÃO: ao instalar, iniciar ou procurar a documentação do backend.
QUANDO FAZ DIFERENÇA: aponta o caminho mais curto para testar o chat e verificar o banco.
-->

# Back-end FIMAP

API Express com MySQL, integrações financeiras e chat com IA.

Use Node.js 22.13 ou superior.

```sh
npm install
npm test
npm start
```

O backend escuta em `http://localhost:8080`. `GET /health` verifica o processo.
O chat público usa `POST /v1/ia/chat-publico`. O chat autenticado usa
`POST /v1/ia/chat/mensagens` com o JWT do usuário.

Veja os corpos das requisições, variáveis de ambiente, eventos SSE e requisitos do banco em
[docs/ai-chat.md](docs/ai-chat.md). O arquivo `.env.example` documenta a configuração da IA.

## Testar o chat com dados financeiros em outro computador

1. Clone o repositório e copie `.env.example` para `.env` na raiz.
2. Obtenha o `CLOUDFLARE_CHAT_TOKEN` com o responsável pelo Worker e configure `JWT_SECRET` localmente. Para testar dados bancários, configure também `CLIENT_ID` e `CLIENT_SECRET` da Pluggy e use uma conta de teste com uma conexão autorizada.
3. Defina `CLOUDFLARE_FINANCIAL_CONTEXT_VERSION=1` se o `/health` do Worker informar `contextoFinanceiroVersao: 1`. Mantenha a URL HTTPS do Worker com o caminho `/v1/ia/chat`.
4. Confirme a conexão MySQL em `model/Database_config_knex/KnexFile.js` e use um banco de teste com o esquema e as migrations do projeto. Execute `npm install` e `npm start`, entre no site e pergunte no chat autenticado sobre as contas ou metas do usuário de teste.

O `.env` deve ficar fora do Git. Compartilhe as credenciais pelo canal privado da equipe.
