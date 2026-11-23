<!-- Explica como funciona e como ativar o planejamento financeiro. -->
# Planejamento financeiro do Fimap Copilot

O chat autenticado aceita objetivos descritos em português. O Worker interpreta o pedido e a conversa recente. O backend coleta dados pertinentes, calcula o cenário, valida cartões e guarda as versões. O clique em **Salvar** cadastra uma meta ou simulação no FIMAP. Investimentos e amortizações são simulações.

## Configuração

1. Aplique as migrações com `npm run db:migrate` no banco de destino. A migração `202611230001_chat_acoes.js` acrescenta as tabelas InnoDB `tbl_chat_acao` e `tbl_chat_acao_versao`, com FKs para o chat e as mensagens. A leitura do histórico usa essas tabelas também quando a geração v2 está desativada.
2. Configure `CLOUDFLARE_WORKER_URL` com a URL privada HTTPS terminando em `/v1/ia/chat` e `CLOUDFLARE_CHAT_TOKEN` com o Bearer compartilhado. HTTP em loopback é aceito para desenvolvimento local.
3. Ative `CLOUDFLARE_PLANNING_VERSION=2` depois que o Worker oferecer a interpretação v2. O SSE comum, o chat público, o contexto financeiro v1 e a interpretação v1 do próprio Worker mantêm seus contratos. Desative a geração de novos cartões limpando essa variável. O histórico e a confirmação de propostas já persistidas permanecem disponíveis.

## Contrato privado

O backend envia `POST /v1/ia/chat/acoes/interpretar` com `versao: 2`, `mensagem`, `hoje` em America/Sao_Paulo, `historico`, `rascunhos`, `categorias` e `contextoPlanejamento`. O envelope aceita até oito mensagens recentes, três rascunhos, vinte categorias e 16 KiB em UTF-8. A primeira chamada classifica com contexto nulo. A segunda ocorre quando o Worker identifica planejamento. Cada chamada tem prazo de oito segundos, não segue redirecionamentos e aceita até 32 KiB de resposta JSON. O cancelamento do chat interrompe o fluxo.

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

O backend grava o par de mensagens e os snapshots na mesma transação antes de emitir `fim`. Revisão e confirmação são serializadas por locks no banco. Uma ação tem um único vínculo durável com o seu cadastro. Excluir a conversa remove seus rascunhos e snapshots por cascata. Metas e simulações confirmadas continuam nas respectivas tabelas. Reverter a migração remove os snapshots e a capacidade de recuperar confirmações antigas pelo chat.

## Testes e limites

`npm test` cobre chat comum e v1, HTTP/JWT, Worker v2 simulado, SAC e Price, isolamento, projeção em centavos, cenários acima da capacidade, fontes parciais, reabertura, replays e salvamento independente. O teste opt-in `CHAT_TEST_MYSQL_URL` cria um schema descartável, aplica as migrações do chat e testa rollback, duas conexões concorrentes e a disputa entre confirmação e revisão. Use apenas uma instância MySQL de teste.

A interpretação semântica, a latência do Worker, a cobertura dos conectores e os cartões do aplicativo precisam de validação conjunta em homologação. Os testes usam respostas e dados financeiros sintéticos. O SDK pode concluir uma chamada já iniciada após o cancelamento. A coleta descarta essa resposta e para a paginação seguinte. Categorias de transação pouco informativas e contratos indexados reduzem o preenchimento automático. A versão atual usa a referência de 0% ou a taxa informada na conversa, sem consultar taxas de mercado.
