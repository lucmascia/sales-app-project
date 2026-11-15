/**
 * @OnlyCurrentDoc
 *
 * Manticello Vendas — script da planilha.
 *
 * (A linha @OnlyCurrentDoc acima faz o Google pedir permissão só para ESTA
 * planilha, e não para todas as planilhas da conta.)
 *
 * Recebe as vendas registradas no app do celular e grava na aba "app".
 * Só escreve nas abas "app" e "app_produtos". As abas "Tabela de Preço" e
 * "Taxas" são apenas lidas. Nenhuma outra aba é tocada.
 *
 * Instalação: veja o README do projeto (colar este arquivo em
 * Extensões → Apps Script, rodar a função "configurar" uma vez e publicar
 * como "App da Web").
 */

var ABA_APP = 'app';
var ABA_PRODUTOS = 'app_produtos';
var ABA_PRECOS = 'Tabela de Preço';
var ABA_TAXAS = 'Taxas';

// Colunas A–R iguais às da aba "Faturamento"; S–W são extras do app.
var CABECALHO = ['produto', 'mes', 'Data', 'Produto', 'Tamanho', 'Canal', 'Valor Un', 'Unidade',
  'Descontos', 'Taxas', 'Total', 'Cliente', 'Status', 'Pendente', 'Forma Pgmt', 'Conta', 'Notas', 'Frete',
  'Hora', 'Venda', 'Vendedor', 'Situação', 'Cobrado'];
var COL = { DATA: 3, UNIDADE: 8, NOTAS: 17, HORA: 19, VENDA: 20, SITUACAO: 22, COBRADO: 23 };

// Produtos que aparecem no app na primeira instalação. O Canal é o que a
// "Tabela de Preço" usa para o preço praticado na feira.
var PRODUTOS_INICIAIS = [
  ['Manticello', 375, 'Feiras', 'Sim'],
  ['Manticello', 750, 'Feiras', 'Sim'],
  ['Camiseta', 'Solto', 'Varejo', 'Sim'],
  ['Camiseta', 'Soltinho', 'Varejo', 'Sim'],
  ['Camiseta', 'Soltão', 'Varejo', 'Sim'],
  ['Sacola Linho', 'Unico', 'Feiras', 'Sim'],
  ['Marmelatta', 120, 'Varejo', 'Sim'],
  ['Marmelatta', 260, 'Varejo', 'Sim']
];

/** Rode esta função uma vez pelo editor: cria as abas e pede a autorização do Google. */
function configurar() {
  garantirAbas_(SpreadsheetApp.getActiveSpreadsheet());
}

function doGet(e) {
  return responder_(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var p = (e && e.parameter) || {};
    if (p.action === 'config') return lerConfig_(ss);
    if (p.action === 'day') return lerDia_(ss, p.date);
    return { ok: true, app: 'manticello-vendas' };
  });
}

function doPost(e) {
  return responder_(function () {
    var corpo;
    try {
      corpo = JSON.parse(e.postData.contents);
    } catch (erro) {
      throw new Error('Pedido inválido (não é JSON).');
    }
    if (!corpo || corpo.action !== 'sync') throw new Error('Ação desconhecida.');
    return sincronizar_(SpreadsheetApp.getActiveSpreadsheet(), corpo);
  });
}

function responder_(fn) {
  var resultado;
  try {
    resultado = fn();
  } catch (erro) {
    resultado = { ok: false, error: String((erro && erro.message) || erro) };
  }
  return ContentService.createTextOutput(JSON.stringify(resultado)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- abas ----------

function garantirAbas_(ss) {
  var app = ss.getSheetByName(ABA_APP);
  if (!app) {
    app = ss.insertSheet(ABA_APP);
    app.getRange(1, 1, 1, CABECALHO.length).setValues([CABECALHO]);
    app.setFrozenRows(1);
    formatarLinhas_(app, 2, app.getMaxRows() - 1);
  }
  var produtos = ss.getSheetByName(ABA_PRODUTOS);
  if (!produtos) {
    produtos = ss.insertSheet(ABA_PRODUTOS);
    var linhas = [['Produto', 'Tamanho', 'Canal', 'Ativo']].concat(PRODUTOS_INICIAIS);
    produtos.getRange(1, 1, linhas.length, 4).setValues(linhas);
    produtos.setFrozenRows(1);
  }
  return { app: app, produtos: produtos };
}

// Hora e código da venda ficam como texto, senão o Sheets converte "14:32:05" em número.
function formatarLinhas_(aba, primeiraLinha, quantas) {
  if (quantas < 1) return;
  aba.getRange(primeiraLinha, COL.DATA, quantas, 1).setNumberFormat('yyyy-mm-dd');
  aba.getRange(primeiraLinha, 9, quantas, 3).setNumberFormat('#,##0.00');
  aba.getRange(primeiraLinha, COL.HORA, quantas, 2).setNumberFormat('@');
  aba.getRange(primeiraLinha, COL.COBRADO, quantas, 1).setNumberFormat('#,##0.00');
}

function abaObrigatoria_(ss, nome) {
  var aba = ss.getSheetByName(nome);
  if (!aba) throw new Error('Aba "' + nome + '" não encontrada na planilha.');
  return aba;
}

// ---------- produtos, preços e taxas ----------

function lerConfig_(ss) {
  var abas = garantirAbas_(ss);
  var fuso = ss.getSpreadsheetTimeZone();
  var anoAtual = Number(Utilities.formatDate(new Date(), fuso, 'yyyy'));
  var precos = abaObrigatoria_(ss, ABA_PRECOS).getDataRange().getValues().slice(1);
  var avisos = [];
  var produtos = [];

  abas.produtos.getDataRange().getValues().slice(1).forEach(function (linha) {
    var produto = texto_(linha[0]);
    if (!produto || inativo_(linha[3])) return;
    var tamanho = linha[1];
    var canal = texto_(linha[2]);
    var preco = buscarPreco_(precos, produto, tamanho, canal, anoAtual);
    if (preco === null) {
      avisos.push('Sem preço na "' + ABA_PRECOS + '": ' + produto + ' ' + tamanho + ' (' + canal + ')');
      return;
    }
    produtos.push({ produto: produto, tamanho: typeof tamanho === 'number' ? tamanho : texto_(tamanho), canal: canal, preco: preco });
  });

  var taxas = [];
  abaObrigatoria_(ss, ABA_TAXAS).getDataRange().getValues().slice(1).forEach(function (linha) {
    var chave = texto_(linha[0]);
    if (!chave) return;
    taxas.push({ chave: chave, taxa: Number(linha[3]) || 0 });
  });

  return { ok: true, products: produtos, fees: taxas, warnings: avisos };
}

function inativo_(valor) {
  var v = String(valor).trim().toLowerCase();
  return v === 'não' || v === 'nao' || v === 'n' || v === 'false' || v === '0';
}

// Mesma chave do VLOOKUP da "Faturamento" (Produto + Tamanho + Canal + Ano):
// vale o ano corrente; se ainda não houver, o ano mais recente cadastrado.
function buscarPreco_(precos, produto, tamanho, canal, anoAtual) {
  var melhor = null;
  precos.forEach(function (linha) {
    if (texto_(linha[1]) !== produto || texto_(linha[3]) !== texto_(tamanho) || texto_(linha[4]) !== canal) return;
    var ano = Number(linha[5]);
    var valor = Number(linha[6]);
    if (!ano || linha[6] === '' || isNaN(valor)) return;
    var candidato = { ano: ano, valor: valor, vigente: ano <= anoAtual };
    if (melhor === null
        || (candidato.vigente && !melhor.vigente)
        || (candidato.vigente === melhor.vigente && candidato.ano > melhor.ano)) {
      melhor = candidato;
    }
  });
  return melhor === null ? null : melhor.valor;
}

// ---------- gravar vendas ----------

function sincronizar_(ss, corpo) {
  var vendas = corpo.sales || [];
  var cancelamentos = corpo.cancels || [];
  if (Object.prototype.toString.call(vendas) !== '[object Array]'
      || Object.prototype.toString.call(cancelamentos) !== '[object Array]') {
    throw new Error('Pedido inválido.');
  }
  var fuso = ss.getSpreadsheetTimeZone();
  // Valida tudo antes de gravar qualquer coisa.
  var linhasPorVenda = vendas.map(function (venda) { return linhasDaVenda_(venda, fuso); });

  var trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    var aba = garantirAbas_(ss).app;
    var conhecidas = {};
    lerColuna_(aba, COL.VENDA).forEach(function (id) { conhecidas[String(id)] = true; });

    var salvas = [];
    var duplicadas = [];
    var novas = [];
    vendas.forEach(function (venda, i) {
      if (conhecidas[venda.id]) {
        if (duplicadas.indexOf(venda.id) < 0 && salvas.indexOf(venda.id) < 0) duplicadas.push(venda.id);
        return;
      }
      conhecidas[venda.id] = true;
      salvas.push(venda.id);
      novas = novas.concat(linhasPorVenda[i]);
    });

    if (novas.length > 0) {
      var primeira = aba.getLastRow() + 1;
      var faltam = primeira + novas.length - 1 - aba.getMaxRows();
      if (faltam > 0) aba.insertRowsAfter(aba.getMaxRows(), faltam);
      formatarLinhas_(aba, primeira, novas.length);
      aba.getRange(primeira, 1, novas.length, CABECALHO.length).setValues(novas);
    }

    var canceladas = [];
    var naoEncontradas = [];
    if (cancelamentos.length > 0) {
      var ids = lerColuna_(aba, COL.VENDA);
      cancelamentos.forEach(function (id) {
        var achou = false;
        ids.forEach(function (valor, i) {
          if (String(valor) !== String(id)) return;
          achou = true;
          cancelarLinha_(aba, i + 2);
        });
        (achou ? canceladas : naoEncontradas).push(id);
      });
    }

    return { ok: true, saved: salvas, duplicates: duplicadas, canceled: canceladas, notFound: naoEncontradas };
  } finally {
    trava.releaseLock();
  }
}

function lerColuna_(aba, coluna) {
  var ultima = aba.getLastRow();
  if (ultima < 2) return [];
  return aba.getRange(2, coluna, ultima - 1, 1).getValues().map(function (linha) { return linha[0]; });
}

function cancelarLinha_(aba, linha) {
  if (aba.getRange(linha, COL.SITUACAO).getValue() === 'Cancelada') return;
  var unidade = aba.getRange(linha, COL.UNIDADE).getValue();
  aba.getRange(linha, COL.UNIDADE, 1, 4).setValues([[0, 0, 0, 0]]); // Unidade, Descontos, Taxas, Total
  aba.getRange(linha, COL.NOTAS).setValue('Cancelada (era ' + unidade + ' un)');
  aba.getRange(linha, COL.SITUACAO).setValue('Cancelada');
  aba.getRange(linha, COL.COBRADO).setValue(0);
}

function linhasDaVenda_(venda, fuso) {
  if (!venda || typeof venda.id !== 'string' || !venda.id) throw new Error('Venda inválida: sem código.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(venda.date))) throw new Error('Venda inválida: data ' + venda.date + '.');
  if (Object.prototype.toString.call(venda.lines) !== '[object Array]' || venda.lines.length === 0) {
    throw new Error('Venda inválida: sem produtos.');
  }
  var data = Utilities.parseDate(venda.date, fuso, 'yyyy-MM-dd');
  var mes = Number(venda.date.substring(5, 7));
  var cancelada = venda.canceled === true;
  return venda.lines.map(function (l) {
    var tamanho = typeof l.tamanho === 'number' ? l.tamanho : texto_(l.tamanho);
    var produto = texto_(l.produto);
    var canal = texto_(l.canal);
    var unidade = numero_(l.unidade);
    return [
      produto + tamanho + canal, mes, data, produto, tamanho, canal,
      numero_(l.valorUn),
      cancelada ? 0 : unidade,
      cancelada ? 0 : numero_(l.desconto),
      cancelada ? 0 : numero_(l.taxa),
      cancelada ? 0 : numero_(l.total),
      'Não informado', 'Pago', 0,
      texto_(venda.payment), '',
      cancelada ? 'Cancelada (era ' + unidade + ' un)' : '',
      '',
      texto_(venda.time), texto_(venda.id), texto_(venda.seller),
      cancelada ? 'Cancelada' : 'OK',
      cancelada ? 0 : numero_(l.cobrado)
    ];
  });
}

function numero_(valor) {
  if (typeof valor !== 'number' || !isFinite(valor)) throw new Error('Venda inválida: número esperado, veio ' + valor + '.');
  return valor;
}

// Texto simples: sem espaços nas pontas e sem "=" ou "+" no começo, para que
// nada vindo de fora seja interpretado como fórmula pela planilha.
function texto_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().replace(/^[=+@]+/, '');
}

// ---------- ler as vendas de um dia ----------

function lerDia_(ss, data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw new Error('Data inválida.');
  var aba = garantirAbas_(ss).app;
  var ultima = aba.getLastRow();
  if (ultima < 2) return { ok: true, rows: [] };
  var fuso = ss.getSpreadsheetTimeZone();
  var linhas = [];
  aba.getRange(2, 1, ultima - 1, CABECALHO.length).getValues().forEach(function (l) {
    if (!l[COL.VENDA - 1] || dataComoTexto_(l[COL.DATA - 1], fuso) !== data) return;
    linhas.push({
      id: String(l[19]), date: data, time: horaComoTexto_(l[18], fuso), seller: String(l[20]), payment: String(l[14]),
      situacao: l[21] === 'Cancelada' ? 'Cancelada' : 'OK',
      produto: String(l[3]), tamanho: l[4], canal: String(l[5]),
      valorUn: Number(l[6]) || 0, unidade: Number(l[7]) || 0, desconto: Number(l[8]) || 0,
      taxa: Number(l[9]) || 0, total: Number(l[10]) || 0, cobrado: Number(l[22]) || 0,
      notas: String(l[16])
    });
  });
  return { ok: true, rows: linhas };
}

function ehData_(valor) {
  return Object.prototype.toString.call(valor) === '[object Date]';
}

function dataComoTexto_(valor, fuso) {
  return ehData_(valor) ? Utilities.formatDate(valor, fuso, 'yyyy-MM-dd') : String(valor).trim();
}

function horaComoTexto_(valor, fuso) {
  return ehData_(valor) ? Utilities.formatDate(valor, fuso, 'HH:mm:ss') : String(valor).trim();
}
