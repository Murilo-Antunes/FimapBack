<!-- Explica como funciona e como ativar o planejamento financeiro. -->
# Planejamento financeiro do Fimap Copilot

O chat autenticado aceita objetivos descritos em português. O Worker interpreta o pedido e a conversa recente. O backend coleta dados pertinentes, calcula o cenário, valida cartões e guarda as versões. O clique em **Salvar** cadastra uma meta ou simulação no FIMAP. Investimentos e amortizações são simulações.

## Configuração

1. Em homologação, confirme que o Worker privado atende ao contrato V2 e que a interpretação V1 continua disponível no mesmo endpoint. Valide a transição de tabelas numa cópia descartável antes de executar `npm run db:migrate` no banco de homologação.
2. Suba o backend com `CLOUDFLARE_PLANNING_VERSION` vazio. Abra um histórico comum e um com cartões já persistidos. A leitura do histórico e a confirmação dos cartões existentes usam as tabelas V2 com a flag desligada.
3. Configure `CLOUDFLARE_WORKER_URL` com a URL privada HTTPS terminando em `/v1/ia/chat` e `CLOUDFLARE_CHAT_TOKEN` com o Bearer compartilhado. HTTP em loopback é aceito para desenvolvimento local.
4. Ative `CLOUDFLARE_PLANNING_VERSION=2`. Em homologação, teste uma revisão com categoria, o salvamento pelo botão, a repetição da confirmação e a leitura do histórico. Limpe a flag para suspender a geração de novos cartões.

## Contrato privado

O backend envia `POST /v1/ia/chat/acoes/interpretar` com `versao: 2`, `mensagem`, `hoje` em America/Sao_Paulo, `historico`, `rascunhos`, `categorias` e `contextoPlanejamento`. O envelope aceita até oito mensagens recentes, três rascunhos, vinte categorias e 16 KiB em UTF-8. A primeira chamada classifica com contexto nulo. A segunda ocorre quando o Worker identifica planejamento. Cada chamada tem prazo de oito segundos, não segue redirecionamentos e aceita até 32 KiB de resposta JSON. O cancelamento do chat interrompe o fluxo.

A primeira chamada envia `categorias: []` e omite `dados.categoria` e a entrada correspondente em `sugeridos`. A segunda prioriza as categorias autorizadas já usadas nos rascunhos e usa os mesmos vinte nomes para compor e validar a chamada. Se uma categoria saiu do catálogo, o snapshot antigo continua no histórico. A próxima revisão pede uma categoria válida antes da confirmação.

Em orientação, devolva `{"versao":2,"intencao":"orientacao","propostas":[]}`. Em planejamento, devolva `versao: 2`, `intencao: "planejamento"`, `mensagem` em português e até três propostas. Cada item usa `tipo`, `modo`, `campos`, `pendencias` e, opcionalmente, `justificativa`. Em `revisar`, devolva a `referencia` fornecida na chamada atual. Em `nova`, omita a referência. Cada campo é um objeto com `valor`, `origem` (`usuario` ou `ia`) e `premissa` opcional. Uma lista de propostas vazia permite uma pergunta de esclarecimento. Identificadores de rascunhos são aliases opacos, válidos apenas na chamada que os forneceu.

| Tipo | Campos aceitos |
| --- | --- |
| `meta` | `nome`, `descricao`, `valor_inicio`, `valor_desejado`, `aporte_mensal`, `data_alvo`, `categoria` |
| `investimento` | `nome`, `descricao`, `valor_inicial`, `aporte_mensal`, `prazo`, `rentabilidade` |
| `amortizacao` | `nome`, `descricao`, `saldo_devedor`, `aporte_mensal`, `prazo`, `taxa`, `sistema_calculo`, `modalidade` |

Envie valores monetários numéricos em BRL com precisão de centavos. Taxas são percentuais efetivos anuais. `10` significa 10% a.a. O prazo vai de 1 a 600 meses. Para meta, o backend o calcula e conta os fins de mês a partir do próximo mês-calendário até `data_alvo`. Em `até o próximo ano`, o cartão pede uma data mais precisa. Os sistemas aceitos são `SAC` e `PRICE`, e as modalidades são `REDUZIR_PRAZO` e `REDUZIR_PARCELA`. Categorias devem pertencer ao catálogo do titular ou ao catálogo global. Quando faltar uma informação, o Worker deve pedir o dado, incluindo preço, valor já separado ou taxa. Comparações preservam o rascunho atual. Uma afirmação como “sim” pode aceitar premissas para revisão na conversa.

## Base dos cálculos

- O orçamento usa os três últimos meses completos. Considera a menor renda recorrente identificada e a maior despesa mensal observada. Receitas pontuais e resgates ficam fora da renda recorrente. Transferências próprias identificadas ficam fora da renda e da despesa.
- Compras no cartão entram pela fatura. O sistema concilia saídas bancárias identificadas como pagamento de fatura ou parcela usando valor e data. As parcelas mensais dos créditos ativos e os aportes de metas ativas ainda incompletas entram como compromissos. A margem mensal é 5% da renda recorrente conservadora, arredondada para cima em centavos. A capacidade resultante tem piso de zero.
- A capacidade falta quando há lacunas relevantes de cobertura, moeda sem conversão validada, pagamentos identificados sem conciliação ou renda recorrente sem três meses de evidência ou com variação maior que 25% em relação ao menor mês. Nesses casos a proposta pode usar o aporte que a pessoa informar. Fontes vazias aparecem separadamente das indisponíveis.
- Saldos e liquidez explícita são sinais da posição atual. O valor inicial vem do que a pessoa já destinou ao objetivo. O backend compara o cenário sem rendimento com o aporte mínimo arredondado para cima e com a capacidade sustentável. Uma simulação complementar compartilha cenário com a meta e usa 0% a.a. como referência se não houver taxa indicada. A simulação é bruta. Uma taxa futura pode variar.
- Em amortização, use os parâmetros que a pessoa fornecer ou selecione um contrato acessível por número ou nome exato entre aspas, quando a identificação for única. O backend aproveita saldo BRL, parcelas mensais restantes, taxa efetiva prefixada e sistema quando verificados. Modalidade e aporte adicional vêm do usuário.
- Os únicos dados bancários que cruzam a fronteira com o Worker são agregados permitidos, como capacidade, margem e compromissos. A interpretação recebe cobertura `suficiente`, `parcial` ou `indisponivel`, período e fontes quando aplicável. A coleta tem prazo de oito segundos e reutiliza a verificação de titularidade, consentimento e limites do contexto financeiro. Identificadores e descrições bancárias ficam no backend. O navegador recebe os cartões e uma explicação resumida da base.

No exemplo de R$ 60.000,00 com R$ 8.000,00 separados e doze aportes de R$ 1.000,00, o total sem rendimento é R$ 20.000,00. A diferença é R$ 40.000,00 e o mínimo mensal é R$ 4.333,34.

## SSE, histórico e confirmação

O campo opcional `acoes_financeiras` aparece na mensagem do assistente, no evento `fim` e na mesma mensagem no GET `/v1/ia/chat/listar-chat/:id_chat/mensagens/:id_usuario`. Cada proposta tem UUID, versão, tipo e estado `rascunho`, `pronta` ou `salva`. Título e descrição ficam no nível superior. `dados.prazo` é enviado em meses quando definido. Valores monetários são números JSON. A projeção visual é calculada pelo front. A versão pertence à mensagem que a apresentou. Um replay de `requisicao_id` recupera o par e as versões persistidas, incluindo o estado salvo quando a versão foi confirmada.

Envie `POST /v1/ia/chat/:id_chat/acoes/:id_acao/confirmar` com JWT e corpo `{"versao":1}`. A resposta HTTP 200 contém `sucesso: true`, `mensagem` e `conteudo`, com a ação `salva` e `id_registro`. Um replay dessa versão devolve o mesmo cadastro. Versão anterior retorna HTTP 409 e código `ACAO_VERSAO_DESATUALIZADA`. Reabra o histórico para carregar a versão atual. Rascunho incompleto retorna HTTP 422. Ação fora da conversa do titular retorna HTTP 404.

O backend grava o par de mensagens e os snapshots na mesma transação antes de emitir `fim`. Revisão e confirmação são serializadas por locks no banco. Uma ação tem um único vínculo durável com o seu cadastro. Excluir a conversa remove seus rascunhos e snapshots por cascata. Metas e simulações confirmadas continuam nas respectivas tabelas.

## Transição de tabelas e recuperação

O V1 de confirmação por texto continua com `tbl_chat_acao` e chave `id_chat`. O V2 usa `tbl_chat_acao_v2` para o UUID, a versão atual e o vínculo com o cadastro, e `tbl_chat_acao_v2_versao` para os snapshots por mensagem. Rascunhos, códigos e validades do V1 são preservados na tabela legada. Os códigos do V1 permanecem no V1.

1. Antes da migração, faça backup e pause as gravações do chat. Confira as migrações em `knex_migrations` e rode `SHOW CREATE TABLE` para as tabelas existentes com prefixo `tbl_chat_acao`. Compare as colunas, a chave primária, a unicidade de `(tipo, id_registro)` e as FKs com exclusão em cascata.
2. `202611230000_chat_acoes_compat.js` roda antes das duas antigas em bancos novos. Em bancos que já registraram uma delas, roda entre as migrações pendentes. Identifica o V2 antigo pelo esquema e renomeia seu cabeçalho e suas versões para os nomes V2. Quando as duas tabelas antigas existem, a renomeação é feita em uma instrução MySQL. UUIDs, snapshots, vínculos com mensagens e IDs confirmados acompanham as tabelas.
3. As migrações `202611230001_chat_acoes.js` e `202611230002_chat_acoes.js` mantêm seus nomes para preservar o histórico do Knex. Elas completam as estruturas V2 e V1 conforme necessário. A árvore também conserva as migrações de alertas e recomendações presentes em `origin/minhas-alteracoes`, para que o Knex reconheça as entradas já registradas naquela branch.
4. Se uma instrução DDL falhar, confira novamente as tabelas e o histórico. A transição aceita tabelas válidas que já foram renomeadas e completa as FKs e a unicidade quando uma execução anterior parou antes de criá-las. Em caso de esquemas duplicados para o mesmo papel, colunas incompatíveis, órfãos ou duplicidade real de vínculos, mantenha o chat pausado e reconcilie os dados a partir do backup em uma cópia antes de tentar novamente. Se o processo do Knex morreu e deixou o lock preso, confirme que nenhum outro migrador está rodando antes de usar `npx knex --knexfile model/Database_config_knex/KnexFile.js migrate:unlock`. Rode `npm run db:migrate` novamente após a correção.
5. Para recuar a ativação, desligue a flag e mantenha as tabelas separadas. Uma versão do backend V1 pode voltar a ler a tabela legada enquanto o V2 permanece preservado. O rollback automático dessas migrações é bloqueado. Se for indispensável voltar ao backend V2 anterior à renomeação, restaure o backup em uma instância separada e reconcilie as gravações posteriores ao backup antes de apontar o aplicativo para ela.

Ao integrar os serviços das duas branches, mantenha a versão de `202611230002_chat_acoes.js` que usa `garantirV1`, o DAO V1 na tabela legada e o DAO V2 nas tabelas versionadas. Com V2 habilitado, respostas em texto podem revisar o cartão e o botão é a entrada de confirmação desse fluxo.

## Testes e limites

`npm test` cobre chat comum, HTTP/JWT, SAC e Price, isolamento, projeção em centavos, fontes parciais, reabertura, replays e salvamento independente. Defina `CHAT_TEST_MYSQL_URL` para uma instância MySQL descartável com permissão de criar e apagar schemas. A suíte executa migrações pelo Knex em bancos limpo, V1, V2 e com DDL interrompido, além de testar rollback de confirmação, duas conexões concorrentes e a disputa entre confirmação e revisão.

Defina `CHAT_TEST_WORKER_REPO` para um clone de IA-Fimap com `esbuild` instalado e o commit `789b2c3` disponível. O teste carrega o Worker diretamente desse commit, simula a inferência e valida tanto o HTTP 400 do envelope antigo quanto a aceitação dos envelopes corrigidos e da interpretação V1. Pode ser executado com `node --test tests/copilot-worker-contract.test.js`.

A interpretação semântica, a latência do Worker, a cobertura dos conectores e os cartões do aplicativo precisam de validação conjunta em homologação. Os testes usam respostas e dados financeiros sintéticos. O SDK pode concluir uma chamada já iniciada após o cancelamento. A coleta descarta essa resposta e para a paginação seguinte. Categorias de transação pouco informativas e contratos indexados reduzem o preenchimento automático. A versão atual usa a referência de 0% ou a taxa informada na conversa, sem consultar taxas de mercado.
