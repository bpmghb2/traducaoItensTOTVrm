import { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

function extrairCnpjDaChave(chave) {
  if (!chave || typeof chave !== 'string') return '';
  const s = chave.replace(/\s/g, '');
  if (s.length < 20) return '';
  return s.substring(6, 20);
}

/** Número da NF: posições 26 a 34 da chave (44 caracteres). */
function extrairNumeroNfDaChave(chave) {
  if (!chave || typeof chave !== 'string') return '';
  const s = chave.replace(/\s/g, '');
  if (s.length < 34) return '';
  return s.substring(25, 34);
}

/**
 * Extrai itens da NF a partir da coluna XML (objeto já parseado pelo backend).
 * Caminho: dados[0].XML.nfeProc.NFe.infNFe.det -> cada item tem .prod com cProd, xProd, uTrib, qCom, xPed, nItemPed (quando existirem).
 */
function extrairItensDaRespostaBPM007(resultadoPorChave) {
  const dados = resultadoPorChave?.dados;
  if (!Array.isArray(dados) || dados.length === 0) return [];
  const row = dados[0];
  const xml = row?.XML;
  if (!xml || typeof xml !== 'object') return [];
  const det = xml?.nfeProc?.NFe?.infNFe?.det;
  if (!det) return [];
  const lista = Array.isArray(det) ? det : [det];
  return lista.map((item) => {
    const prod = item?.prod;
    if (!prod || typeof prod !== 'object') return { cProd: '', xProd: '', uTrib: '', qCom: '', xPed: '', nItemPed: '' };
    return {
      cProd: prod.cProd ?? '',
      xProd: prod.xProd ?? '',
      uTrib: prod.uTrib ?? '',
      qCom: prod.qCom ?? '',
      xPed: prod.xPed ?? item.xPed ?? '',
      nItemPed: prod.nItemPed ?? item.nItemPed ?? '',
    };
  });
}

/** Lista única de NUMEROMOV (Ordem de Compra) a partir dos dados BPM.SUP.006 */
function listarNumeromov(resultadoPorCnpj) {
  const dados = resultadoPorCnpj?.dados;
  if (!Array.isArray(dados)) return [];
  const set = new Set();
  dados.forEach((row) => {
    const v = row?.NUMEROMOV ?? row?.Numeromov ?? row?.numeromov ?? '';
    if (v !== '' && v != null) set.add(String(v));
  });
  return Array.from(set).sort();
}

/** Itens da OC selecionada: IDPRD, NOMEPRODUTO, UN, NSEQITMMOV, QUANTIDADE, QTD (BPM.SUP.008.1) */
function itensPorNumeromov(resultadoPorCnpj, numeromov) {
  if (!numeromov || !resultadoPorCnpj?.dados) return [];
  const dados = resultadoPorCnpj.dados;
  return dados
    .filter((row) => {
      const v = row?.NUMEROMOV ?? row?.Numeromov ?? row?.numeromov;
      return v != null && String(v) === String(numeromov);
    })
    .map((row) => ({
      IDPRD: row?.IDPRD ?? row?.Idprd ?? '',
      NOMEPRODUTO: row?.NOMEPRODUTO ?? row?.Nomeproduto ?? '',
      UN: row?.UN ?? row?.Un ?? row?.un ?? '',
      NSEQITMMOV: row?.NSEQITMMOV ?? row?.Nseqitmmov ?? '',
      QUANTIDADE: row?.QUANTIDADE ?? row?.Quantidade ?? '',
      QTD: row?.QTD ?? row?.Qtd ?? row?.qtd ?? '',
    }));
}

/**
 * Vínculos automáticos vindos da consulta BPM.SUP.008.3.
 * Para cada linha com CD_PRD_FORNECEDOR, IDPRD e DESCRICAO:
 * - se o CD_PRD_FORNECEDOR coincidir com o cProd do item do XML, mapeia esse item
 *   para o produto interno (IDPRD/DESCRICAO).
 * Retorna um mapa: nfIndex -> { idPrd, descricao, cdFornecedor }.
 */
function mapearVinculosAutomaticos(resultadoProdutosFornecedor, itensNf) {
  const dados = resultadoProdutosFornecedor?.dados;
  if (!Array.isArray(dados) || !Array.isArray(itensNf) || itensNf.length === 0) return {};

  const mapa = {};
  dados.forEach((row) => {
    const cdFornecedor =
      row?.CD_PRD_FORNECEDOR ??
      row?.Cd_prd_fornecedor ??
      row?.cd_prd_fornecedor ??
      row?.CD_PRD_FORN ??
      row?.cdPrdFornecedor;
    if (!cdFornecedor) return;

    const idPrd = row?.IDPRD ?? row?.Idprd ?? row?.idprd;
    const descricao = row?.DESCRICAO ?? row?.Descricao ?? row?.descricao;

    const cdStr = String(cdFornecedor).trim();
    if (!cdStr) return;

    const nfIndex = itensNf.findIndex((it) => String(it.cProd).trim() === cdStr);
    if (nfIndex >= 0 && mapa[nfIndex] == null) {
      mapa[nfIndex] = {
        idPrd: idPrd != null ? String(idPrd).trim() : '',
        descricao: descricao != null ? String(descricao).trim() : '',
        cdFornecedor: cdStr,
      };
    }
  });

  return mapa;
}

/** Conjunto de IDPRD retornados pela BPM.SUP.008.3 para destacar itens da OC automaticamente. */
function obterIdsPrdAutomaticos(resultadoProdutosFornecedor) {
  const dados = resultadoProdutosFornecedor?.dados;
  if (!Array.isArray(dados)) return new Set();

  const set = new Set();
  dados.forEach((row) => {
    const idPrd = row?.IDPRD ?? row?.Idprd ?? row?.idprd;
    if (idPrd != null && String(idPrd).trim() !== '') {
      set.add(String(idPrd).trim());
    }
  });

  return set;
}

/** CODCFO retornado pela BPM.SUP.008.1 (consulta fornecedor por CNPJ). */
function obterCodCfo(resultadoPorCnpj) {
  const dados = resultadoPorCnpj?.dados;
  if (!Array.isArray(dados) || dados.length === 0) return '';
  const row = dados[0] || {};
  const cod = row?.CODCFO ?? row?.Codcfo ?? row?.codcfo;
  return cod != null ? String(cod).trim() : '';
}

/** Indica se o SaveRecordResult do TOTVS é sucesso (ex.: "1;8693;0;0001974;20197"). */
function isSaveRecordSuccess(resultado) {
  if (resultado == null) return false;
  const s = String(resultado).trim();
  return s.startsWith('1;') || s === '1';
}

function App() {
  const [chaveXml, setChaveXml] = useState('');
  const [resultadoPorChave, setResultadoPorChave] = useState(null);
  const [resultadoPorCnpj, setResultadoPorCnpj] = useState(null);
  const [resultadoProdutosFornecedor, setResultadoProdutosFornecedor] = useState(null);
  const [numeromovSelecionado, setNumeromovSelecionado] = useState(null);
  const [vinculos, setVinculos] = useState({}); // ocIndex -> nfIndex (item da direita vinculado ao item da esquerda)
  const [vinculosTraduzidosSucesso, setVinculosTraduzidosSucesso] = useState(() => new Set()); // keys "nfIndex-ocIndex" já gravados no TOTVS
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [traduzindo, setTraduzindo] = useState(false);
  const [mensagemTraducao, setMensagemTraducao] = useState('');

  const chaveTrim = chaveXml.replace(/\s/g, '');
  const cnpjExtraido = extrairCnpjDaChave(chaveXml);
  const podeConsultar = chaveTrim.length >= 20;
  const itensNf = extrairItensDaRespostaBPM007(resultadoPorChave);
  const listaOc = listarNumeromov(resultadoPorCnpj);
  const itensOc = itensPorNumeromov(resultadoPorCnpj, numeromovSelecionado);
  const numeroNf = extrairNumeroNfDaChave(chaveTrim);
  const vinculosAutomaticosPorNf = mapearVinculosAutomaticos(resultadoProdutosFornecedor, itensNf);
  const idsPrdAutomaticos = obterIdsPrdAutomaticos(resultadoProdutosFornecedor);
  const codCfo = obterCodCfo(resultadoPorCnpj);

  const vinculosPendentes = Object.entries(vinculos)
    .map(([ocIndexStr, nfIndex]) => {
      const ocIndex = Number(ocIndexStr);
      if (Number.isNaN(ocIndex)) return null;
      const ocItem = itensOc[ocIndex];
      const nfItem = itensNf[nfIndex];
      if (!ocItem || !nfItem) return null;
      return {
        ocIndex,
        nfIndex,
        idPrd: ocItem.IDPRD,
        codPrdFornecedor: nfItem.cProd,
        codUnd: ocItem.UN,
        codUndCfo: nfItem.uTrib,
      };
    })
    .filter(Boolean);

  const podeTraduzir = vinculosPendentes.length > 0 && !!codCfo && !carregando && !traduzindo;

  const prevChaveLenRef = useRef(0);

  const consultar = useCallback(async () => {
    if (!podeConsultar) {
      setErro('Informe a chave XML da NF com pelo menos 20 caracteres.');
      return;
    }
    setErro(null);
    setResultadoPorChave(null);
    setResultadoPorCnpj(null);
    setResultadoProdutosFornecedor(null);
    setNumeromovSelecionado(null);
    setVinculos({});
    setVinculosTraduzidosSucesso(new Set());
    setCarregando(true);

    try {
      const [resChave, resCnpj, resProdFornecedor] = await Promise.all([
        fetch(`${API_BASE}/consultaPorChave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chave: chaveTrim }),
        }),
        fetch(`${API_BASE}/consultaFornecedorPorCnpj`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj: cnpjExtraido }),
        }),
        fetch(`${API_BASE}/consultaProdutosFornecedorPorCnpj`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj: cnpjExtraido }),
        }),
      ]);

      const jsonChave = await resChave.json();
      const jsonCnpj = await resCnpj.json();
      const jsonProdFornecedor = await resProdFornecedor.json();

      setResultadoPorChave(jsonChave);
      setResultadoPorCnpj(jsonCnpj);
      setResultadoProdutosFornecedor(jsonProdFornecedor);

      const erros = [];
      if (!resChave.ok) erros.push(jsonChave.erro || `Consulta por chave: ${resChave.status}`);
      if (!resCnpj.ok) erros.push(jsonCnpj.erro || `Consulta por CNPJ: ${resCnpj.status}`);
      if (!resProdFornecedor.ok) erros.push(jsonProdFornecedor.erro || `Consulta produtos fornecedor: ${resProdFornecedor.status}`);
      if (erros.length) setErro(erros.join(' · '));
    } catch (e) {
      setErro(e.message || 'Erro ao chamar o backend.');
    } finally {
      setCarregando(false);
    }
  }, [podeConsultar, chaveTrim, cnpjExtraido]);

  useEffect(() => {
    const len = chaveTrim.length;
    if (len === 44 && prevChaveLenRef.current !== 44) {
      consultar();
    }
    prevChaveLenRef.current = len;
  }, [chaveTrim, consultar]);

  const traduzirPendentes = async () => {
    if (!podeTraduzir) return;
    setTraduzindo(true);
    setMensagemTraducao('');
    try {
      const res = await fetch(`${API_BASE}/traduzirVinculos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codCfo,
          vinculos: vinculosPendentes.map((v) => ({
            idPrd: v.idPrd,
            codPrdFornecedor: v.codPrdFornecedor,
            codUnd: v.codUnd,
            codUndCfo: v.codUndCfo,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.sucesso === false) {
        throw new Error(json.erro || `Falha na tradução (${res.status}).`);
      }
      setMensagemTraducao(json.mensagem || 'Traduções enviadas com sucesso.');
      const resultados = json.resultados;
      if (Array.isArray(resultados) && resultados.length === vinculosPendentes.length) {
        setVinculosTraduzidosSucesso((prev) => {
          const next = new Set(prev);
          resultados.forEach((r, i) => {
            const v = vinculosPendentes[i];
            if (v && r?.sucesso !== false && isSaveRecordSuccess(r?.resultado)) {
              next.add(`${v.nfIndex}-${v.ocIndex}`);
            }
          });
          return next;
        });
      }
    } catch (e) {
      setMensagemTraducao(e.message || 'Erro ao enviar traduções.');
    } finally {
      setTraduzindo(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="App-inner">
          <div className="App-header-row">
            <h1>Tradução Itens</h1>
            <span className="App-badge">v1.0.0 - Beta</span>
          </div>
          <p className="App-desc">
            Compare os itens do XML da NF com as Ordens de Compra do RM, vincule produtos e envie as traduções para o
            DataServer.
          </p>

          <div className="App-form">
            <input
              id="chave-xml"
              type="text"
              placeholder="Ex.: 42260102492310000287550010009069891004961297"
              value={chaveXml}
              onChange={(e) => setChaveXml(e.target.value)}
              maxLength={44}
              className="App-input"
            />
            {carregando && <p className="App-consultando">Consultando…</p>}
          </div>

          {erro && <div className="App-erro">{erro}</div>}

          {(resultadoPorChave != null || resultadoPorCnpj != null) && (
            <>
              <div className="App-two-cols">
                {/* Linha 1: títulos + lista de OCs (só na direita) — alinha as tabelas na linha 2 */}
                <div className="App-col-head">
                  <h3 className="App-col-title">Conteúdo do XML da NF</h3>
                </div>
                <div className="App-col-head">
                  <h3 className="App-col-title">Conteúdo da OC</h3>
                  {resultadoPorCnpj != null && resultadoPorCnpj.sucesso && listaOc.length > 0 && (
                    <ul className="App-list-oc">
                      {listaOc.map((num) => (
                        <li key={num}>
                          <button
                            type="button"
                            className={`App-list-oc-btn ${numeromovSelecionado === num ? 'active' : ''}`}
                            onClick={() => {
                              setNumeromovSelecionado((atual) => {
                                if (atual === num) return null;
                                return num;
                              });
                              setVinculos({});
                              setVinculosTraduzidosSucesso(new Set());
                            }}
                          >
                            {num}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Linha 2: tabelas (ou JSON/msg) alinhadas */}
                <div className="App-col-body">
                  {itensNf.length > 0 ? (
                    <div className="App-table-wrap App-oc-itens">
                      <h4 className="App-oc-itens-title">Itens do XML da NF {numeroNf}</h4>
                      <table className="App-table">
                        <thead>
                          <tr>
                            <th>Cod. Produto</th>
                            <th>NOME PRODUTO</th>
                            <th>UN</th>
                            <th>Qtd</th>
                            <th>OC</th>
                            <th>Seq. OC</th>
                            <th>Vinculado a</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itensNf.map((item, idx) => {
                            const ocIdx = Object.keys(vinculos).find((k) => vinculos[Number(k)] === idx);
                            const ocItem = ocIdx != null && itensOc[Number(ocIdx)];
                            const idAuto = vinculosAutomaticosPorNf[idx];

                            let textoVinculo = '—';
                            if (ocItem) {
                              textoVinculo = `${ocItem.IDPRD} – ${ocItem.NOMEPRODUTO}`;
                            } else if (idAuto) {
                              const desc = idAuto.descricao || '';
                              textoVinculo = `${idAuto.idPrd || ''}${desc ? ` – ${desc}` : ''}`;
                            }

                            const vinculoManual = !!ocItem;
                            const vinculoAutomatico = !ocItem && !!idAuto;
                            const traduzidoOk =
                              vinculoManual && ocIdx != null && vinculosTraduzidosSucesso.has(`${idx}-${ocIdx}`);

                            const classeCelula = traduzidoOk
                              ? 'App-cell-linked'
                              : vinculoManual
                                ? 'App-cell-pending'
                                : vinculoAutomatico
                                  ? 'App-cell-linked'
                                  : undefined;
                            const classeLinha = traduzidoOk
                              ? 'App-row-linked'
                              : vinculoManual
                                ? 'App-row-pending'
                                : vinculoAutomatico
                                  ? 'App-row-linked'
                                  : '';

                            return (
                              <tr
                                key={idx}
                                className={`App-drop-row ${classeLinha}`}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.add('App-drop-over');
                                }}
                                onDragLeave={(e) => {
                                  e.currentTarget.classList.remove('App-drop-over');
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  e.currentTarget.classList.remove('App-drop-over');
                                  const ocIndex = e.dataTransfer.getData('text/plain');
                                  if (ocIndex === '') return;
                                  const ocIdxNum = parseInt(ocIndex, 10);
                                  if (!Number.isNaN(ocIdxNum)) setVinculos((v) => ({ ...v, [ocIdxNum]: idx }));
                                }}
                              >
                                <td className={classeCelula}>{item.cProd}</td>
                                <td className={classeCelula}>{item.xProd}</td>
                                <td className={classeCelula}>{item.uTrib}</td>
                                <td className={classeCelula}>{item.qCom}</td>
                                <td className={classeCelula}>{item.xPed}</td>
                                <td className={classeCelula}>{item.nItemPed}</td>
                                <td className={`App-vinculo-cell ${classeCelula || ''}`}>{textoVinculo}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                  </table>
                </div>
              ) : (
                <pre className="App-json">
                  {resultadoPorChave != null ? JSON.stringify(resultadoPorChave, null, 2) : '—'}
                </pre>
              )}
            </div>
            <div className="App-col-body">
              {resultadoPorCnpj != null && resultadoPorCnpj.sucesso && listaOc.length > 0 ? (
                <>
                  {numeromovSelecionado != null && itensOc.length > 0 ? (
                    <div className="App-table-wrap App-oc-itens">
                      <h4 className="App-oc-itens-title">Itens da OC {numeromovSelecionado}</h4>
                      <table className="App-table">
                        <thead>
                          <tr>
                            <th>IDPRD</th>
                            <th>NOME PRODUTO</th>
                            <th>UN</th>
                            <th>Seq. OC</th>
                            <th>Qtd</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itensOc.map((item, idx) => {
                            const idPrdStr = item.IDPRD != null ? String(item.IDPRD).trim() : '';
                            const vinculoManual = vinculos[idx] != null;
                            const nfIdx = vinculos[idx];
                            const traduzidoOk =
                              vinculoManual &&
                              nfIdx != null &&
                              vinculosTraduzidosSucesso.has(`${nfIdx}-${idx}`);
                            const vinculoAutomatico =
                              !vinculoManual && idPrdStr && idsPrdAutomaticos.has(idPrdStr);

                            const classeCelula = traduzidoOk
                              ? 'App-cell-linked'
                              : vinculoManual
                                ? 'App-cell-pending'
                                : vinculoAutomatico
                                  ? 'App-cell-linked'
                                  : undefined;
                            const classeLinha = traduzidoOk
                              ? 'App-row-linked'
                              : vinculoManual
                                ? 'App-row-pending'
                                : vinculoAutomatico
                                  ? 'App-row-linked'
                                  : '';

                            return (
                              <tr
                                key={idx}
                                draggable
                                className={`App-drag-row ${classeLinha}`}
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('text/plain', String(idx));
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.currentTarget.classList.add('App-dragging');
                                }}
                                onDragEnd={(e) => e.currentTarget.classList.remove('App-dragging')}
                              >
                                <td className={classeCelula}>{item.IDPRD}</td>
                                <td className={classeCelula}>{item.NOMEPRODUTO}</td>
                                <td className={classeCelula}>{item.UN}</td>
                                <td className={classeCelula}>{item.NSEQITMMOV}</td>
                                <td className={classeCelula}>{item.QTD}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : numeromovSelecionado != null && itensOc.length === 0 ? (
                    <p className="App-msg">Nenhum item encontrado para esta OC.</p>
                  ) : (
                    <div className="App-table-wrap App-oc-placeholder" />
                  )}
                </>
              ) : resultadoPorCnpj != null && !resultadoPorCnpj.sucesso ? (
                <p className="App-msg">{resultadoPorCnpj.erro ?? 'Consulta falhou.'}</p>
              ) : resultadoPorCnpj != null && listaOc.length === 0 ? (
                <p className="App-msg">Nenhuma Ordem de Compra (NUMEROMOV) encontrada.</p>
              ) : (
                <pre className="App-json">{resultadoPorCnpj != null ? JSON.stringify(resultadoPorCnpj, null, 2) : '—'}</pre>
              )}
            </div>
          </div>
          <div className="App-translate">
            <button
              type="button"
              className="App-button App-button-secondary"
              onClick={traduzirPendentes}
              disabled={!podeTraduzir}
            >
              {traduzindo ? 'Traduzindo…' : 'Traduzir itens pendentes'}
            </button>
            {mensagemTraducao && <p className="App-translate-msg">{mensagemTraducao}</p>}
          </div>
          </>
        )}
        </div>
      </header>
    </div>
  );
}

export default App;
