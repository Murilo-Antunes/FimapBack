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
4. Preencha `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e `DB_NAME` para um banco MySQL com o esquema e as migrations do projeto. Execute `npm install` e `npm start`, entre no site e pergunte no chat autenticado sobre as contas ou metas do usuário de teste.

O `.env` deve ficar fora do Git. Compartilhe as credenciais pelo canal privado da equipe.

## Executar o backend na nuvem

Use um serviço que execute Node.js 22.13 ou superior. Configure `npm ci --omit=dev` para instalar dependências, `npm start` para iniciar a API e `/health` para verificar a inicialização. O servidor usa a variável `PORT` fornecida pela plataforma.

Cadastre as mesmas variáveis de banco e do chat no painel de ambiente do serviço. Para MySQL gerenciado com TLS, use `DB_SSL=true` e, quando o provedor exigir, `DB_SSL_CA` com o certificado CA em PEM. A API Express chama o Worker de IA publicado pela URL HTTPS configurada.

Valide o esquema e o histórico de migrations antes de disponibilizar o serviço. Em um banco existente, faça backup e confira as migrations pendentes antes de rodar `npm run db:migrate`. O script `Database/Script_Fimap.sql` recria o banco e deve ser reservado à preparação de ambientes descartáveis. Aponte o frontend para a URL pública da API e teste o chat autenticado com uma conta de teste.
