# Manticello Vendas

App de celular para registrar as vendas da Manticello em feiras e fechar o caixa no fim do dia.

- **Venda em 2 toques:** produto → forma de pagamento.
- **Funciona sem internet:** a venda fica guardada no celular e vai para a planilha quando houver sinal.
- **Dois (ou mais) celulares** ao mesmo tempo, sem conflito.
- As vendas caem na aba **`app`** da planilha "Manticello", com as mesmas colunas da aba "Faturamento".
- **Fechamento do dia:** cobrado, descontos, taxas, líquido, por forma de pagamento, por produto, custo da feira e a lista de vendas por horário para conferir com o extrato.

**Endereço do app:** https://lucmascia.github.io/sales-app-project/

## Como funciona

```
celular (app)  ──vendas──▶  script da planilha  ──grava──▶  aba "app"
      ▲                            │
      └──produtos, preços, taxas───┘  (lidos de "app_produtos", "Tabela de Preço" e "Taxas")
```

O script só **escreve** nas abas `app` e `app_produtos`. Ele **lê** "Tabela de Preço" e "Taxas". Nenhuma outra aba é tocada.

## Instalação

São três partes. A primeira e a segunda são feitas uma vez só; a terceira, uma vez em cada celular.

### 1. Colocar o script na planilha (≈ 5 minutos, no computador)

> Os nomes dos menus do Google podem variar um pouco de como estão escritos aqui.

1. Abra a planilha "Manticello" e vá em **Extensões → Apps Script**.
2. Apague o que estiver no arquivo `Código.gs` e cole o conteúdo inteiro de [`apps-script/Code.gs`](apps-script/Code.gs). Salve (ícone de disquete).
3. Na barra de cima, escolha a função **`configurar`** e clique em **Executar**.
   - O Google vai pedir autorização: **Revisar permissões** → escolha sua conta → **Avançado** → **Acessar o projeto (não seguro)** → **Permitir**. Esse aviso aparece para qualquer script feito por você mesmo; a permissão pedida é só para esta planilha.
   - Volte à planilha: devem ter aparecido as abas **`app`** e **`app_produtos`**.
4. De volta ao Apps Script: **Implantar → Nova implantação**. Na engrenagem "Selecionar tipo", escolha **App da Web** e preencha:
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
5. Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).

**Esse link é a chave de acesso.** Quem tem o link consegue lançar vendas na aba `app`. Guarde-o só entre vocês; ele não fica no repositório.

### 2. Publicar o app (uma vez)

O app é a pasta [`app/`](app/): arquivos estáticos, sem etapa de build. Ele é publicado pelo GitHub Pages.

1. No GitHub, abra **Settings → Pages** deste repositório.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.

A partir daí, cada mudança no branch `main` é publicada sozinha em https://lucmascia.github.io/sales-app-project/ (leva um ou dois minutos). O andamento aparece na aba **Actions**.

### 3. Configurar cada celular (≈ 1 minuto)

**Instale primeiro, configure depois.** No iPhone, o app da Tela de Início guarda seus dados separado do Safari: o que for configurado no Safari não vale para o ícone.

1. Abra https://lucmascia.github.io/sales-app-project/ no navegador do celular (Safari no iPhone, Chrome no Android).
2. **Adicione à tela inicial:** no iPhone, botão de compartilhar → "Adicionar à Tela de Início"; no Android, menu ⋮ → "Adicionar à tela inicial" / "Instalar app".
3. Abra o app **pelo ícone**. Em **Ajustes**, cole o **link do script** (passo 1.5), escreva **seu nome** e toque em **Salvar e testar**. Deve aparecer "Conectado: 8 produtos e 4 formas de pagamento".

Use sempre pelo ícone: é o que garante que o app abre sem internet e que o celular não apaga os dados.

Para o **segundo celular**: em Ajustes do primeiro, use **Configurar outro celular → Compartilhar link** e mande pelo WhatsApp. No Android, abrir esse link já liga o app à planilha. No iPhone, copie o link recebido e cole no campo "Link do script" do app instalado (ele aceita tanto esse link quanto o link direto do script).

### Venda de teste

1. Em **Vender**, toque em um produto e em uma forma de pagamento.
2. Espere uns 10 segundos e olhe a aba `app` da planilha: a linha deve estar lá.
3. Em **Fechamento**, toque em **Cancelar** nessa venda. Na planilha, a linha fica com Situação "Cancelada" e valores zerados. Pode apagá-la à mão.

Se o "Salvar e testar" disser que *o link respondeu com uma página em vez de dados*, o script foi publicado sem o acesso "Qualquer pessoa" ou o link copiado não é o que termina em `/exec`.

## No dia da feira

- **Vender:** cada toque no produto soma 1 unidade; `−` tira 1. Tocar na forma de pagamento **conclui** a venda.
- **Desfazer:** aparece por 6 segundos logo depois da venda. Depois disso, cancele pelo Fechamento.
- **Desconto:** toque no **Total** e digite o valor final (ex.: 250). O app calcula o desconto e distribui entre os produtos.
- **Sinal:** o botão no canto de cima mostra `✓` (tudo enviado) ou `↑ 3` (3 vendas esperando sinal). Tocar nele tenta enviar na hora. Sem sinal, continue vendendo normalmente.
- **Fechamento:** toque em **Atualizar** com internet. Ele só está completo quando os **dois** celulares estiverem com `✓`. A linha "Última venda de cada um" ajuda a conferir.
- **Pagamento em duas formas** (parte PIX, parte dinheiro): registre como duas vendas.

Data e hora de cada venda vêm do relógio do celular.

## A aba `app`

Colunas A–R iguais às da "Faturamento", gravadas como **valores** (não fórmulas) — dá para copiar e colar de uma aba para a outra. Colunas extras:

| Coluna | Conteúdo |
|---|---|
| S · Hora | hora da venda |
| T · Venda | código da venda; produtos da mesma venda repetem o código |
| U · Vendedor | nome configurado no celular |
| V · Situação | `OK` ou `Cancelada` |
| W · Cobrado | o que o cliente pagou por aquela linha; a soma das linhas de uma venda é o valor do extrato |

Conta de cada linha, igual à da "Faturamento": `Taxas = taxa% × (Valor Un × Unidade − Descontos)` e `Total = Valor Un × Unidade − Descontos − Taxas`.

## Manutenção

| Quero… | Faço… |
|---|---|
| Mudar um preço | Altero na "Tabela de Preço", como sempre. O app pega o preço do ano corrente (ou do ano mais recente cadastrado). |
| Mudar uma taxa ou incluir forma de pagamento | Altero na aba "Taxas". |
| Incluir um produto no app | Adiciono uma linha em `app_produtos` (Produto, Tamanho, Canal, Ativo = Sim). O trio precisa existir na "Tabela de Preço". |
| Tirar um produto do app | Ponho "Não" na coluna Ativo. |
| Ver a mudança no celular | Ajustes → **Salvar e testar** (ou espere: o app se atualiza sozinho a cada 10 minutos com sinal). |
| Atualizar o script | Colo o novo `Code.gs`, depois **Implantar → Gerenciar implantações → ✏️ → Versão: Nova versão → Implantar**. Assim o link continua o mesmo. Não crie uma "Nova implantação", que geraria outro link. |

Camiseta e Marmelatta estão em `app_produtos` com Canal "Varejo" porque é esse o Canal que a "Tabela de Preço" usa para o preço praticado na feira.

## Limites conhecidos

- Os celulares não veem as vendas um do outro em tempo real; só no Fechamento, depois de "Atualizar".
- Só o celular que fez a venda consegue cancelá-la pelo app.
- O primeiro uso de cada celular precisa de internet (para baixar produtos, preços e taxas).
- Depois de uma atualização do app, a versão nova aparece na segunda vez que ele é aberto.
- O script foi testado contra uma planilha simulada, com os dados reais de preço e taxa. A primeira execução contra o Google de verdade é a "Venda de teste" acima.

## Desenvolvimento

Sem dependências para instalar. Os testes de navegador (`test:e2e`) precisam do Playwright disponível na máquina; os demais só do Node 22.

```bash
npm test          # contas, script da planilha, fila de envio (Node)
npm run test:e2e  # o app num navegador em tamanho de celular
npm run serve     # app em http://127.0.0.1:8080 contra uma planilha simulada
```

Nos testes, o `Code.gs` de verdade roda dentro do Node contra uma planilha falsa (`tests/fake-sheets.mjs`), atrás de um servidor que imita o do Google (`tests/mock-server.mjs`).

| Arquivo | Papel |
|---|---|
| `app/js/calc.js` | contas da venda: desconto, taxa, total |
| `app/js/summary.js` | contas do fechamento |
| `app/js/store.js` | o que o celular guarda (localStorage) |
| `app/js/api.js` | chamadas ao script |
| `app/js/sync.js` | fila de envio |
| `app/js/main.js` | as telas |
| `app/sw.js` | faz o app abrir sem internet |
| `apps-script/Code.gs` | script da planilha |
