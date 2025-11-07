// lib/parser.js
(function () {
  // --------- стиль маркерів ---------
  const COLORS  = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
  const SYMBOLS = ['circle','square','diamond','cross','triangle-up','star'];

  // --------- утиліти читання заголовків ---------
  function headerIndex(h, list){ for (const c of list){ const i=h.findIndex(x=>x.x4Header===c); if(i>=0) return i; } return -1; }
  function headerMap(h){ const m={}; for (const x of h) m[x.x4Header]=x; return m; }

  // --------- побудова одного трейсу ---------
  function makeTrace(ds, iDataset){
    const hs   = ds.headers||[];
    const iE   = headerIndex(hs, ['EN']);
    const iY   = headerIndex(hs, ['DATA']);
    const iErr = headerIndex(hs, ['ERR-T','DATA-ERR']);
    if (iE<0 || iY<0) return null;

    const conv = parseFloat(headerMap(hs)['DATA']?.ConvFactor || 1);
    const x=[], y=[], ey=[];
    for (const row of (ds.data||[])){
      const E=+row[iE], S=+row[iY];
      if (!isFinite(E) || !isFinite(S)) continue;
      x.push(E); y.push(S*conv);
      if (iErr>=0 && isFinite(row[iErr])) ey.push(+row[iErr]*conv); else ey.push(NaN);
    }

    const name = `${ds.author1||''}, ${ds.year||''}`.trim() || (ds.reaction?.code || 'dataset');

    return {
      x, y, name,
      mode: 'markers',
      marker: {
        size: 8,
        color: COLORS[iDataset % COLORS.length],
        symbol: SYMBOLS[iDataset % SYMBOLS.length],
        line: { width: 0.5, color: 'rgba(0,0,0,.25)' }
      },
      error_y: { type: 'data', array: ey, visible: true, thickness: 1, width: 2, color: 'rgba(0,0,0,.35)' },
      hovertemplate: '<b>%{fullData.name}</b><br>E = %{x:.3f} MeV<br>σ = %{y:.5f} b<extra></extra>'
    };
  }

  // ===================== «Красивий» заголовок =====================

  // розбити по комах тільки на верхньому рівні (не в дужках)
  function splitTopLevelCommas(s){
    const out=[]; let lvl=0, buf='';
    for (const ch of String(s||'')) {
      if (ch==='(') lvl++; else if (ch===')' && lvl>0) lvl--;
      if (ch===',' && lvl===0) { out.push(buf.trim()); buf=''; }
      else buf+=ch;
    }
    if (buf) out.push(buf.trim());
    return out;
  }

  // 31-GA-69 → ⁶⁹Ga (показуємо A як верхній індекс; Z не виводимо)
  function prettyNuclide(tok){
    if(!tok) return '';
    tok = String(tok).trim();
    let m = tok.match(/^(\d+)-([A-Za-z]+)-(\d+)$/); // Z-ELEM-A
    if (m){ const [, ,E,A]=m; return `<sup>${A}</sup>${E[0].toUpperCase()+E.slice(1).toLowerCase()}`; }
    m = tok.match(/^([A-Za-z]+)-(\d+)$/);          // ELEM-A
    if (m){ const [,E,A]=m;   return `<sup>${A}</sup>${E[0].toUpperCase()+E.slice(1).toLowerCase()}`; }
    m = tok.match(/^(\d+)-([A-Za-z]+)$/);          // A-ELEM
    if (m){ const [,A,E]=m;   return `<sup>${A}</sup>${E[0].toUpperCase()+E.slice(1).toLowerCase()}`; }
    return tok;
  }

  // (P,N) → (p,n), A/ALPHA → α, G/GAMMA → γ
  function prettyParticles(s){
    if(!s) return '';
    return String(s).split(/[,\/\s]+/)   // без «;»
      .filter(Boolean)
      .map(t=>{
        const u=t.toUpperCase();
        if (u==='ALPHA'||u==='A') return 'α';
        if (u==='GAMMA'||u==='G') return 'γ';
        return t.toLowerCase();
      }).join(',');
  }

  /** obsMode: "raw" | "none" | "word" */
  function prettyObservable(obs, obsMode='raw'){
    const k = String(obs||'').toUpperCase();
    if (obsMode==='none') return '';
    if (obsMode==='raw')  return k;  // лишаємо EXFOR-позначення: SIG, DCS, …
    const map = { SIG:'Cross section', DCS:'Differential cross section', YIELD:'Yield', RATIO:'Ratio' };
    return map[k] || k;
  }

  // з EXFOR-коду робимо людинозрозумілий заголовок
  function formatReactionPretty(code, obsMode='raw'){
    const parts = splitTopLevelCommas(code||'');
    const main  = parts[0] || '';

    // observable — остання непорожня частина
    let obs = '';
    for (let i=parts.length-1;i>0;i--) { if (parts[i]) { obs = parts[i]; break; } }

    // main: <target>(<particles>)<product?>
    const m = main.match(/^(.*?)\(([^\)]*)\)\s*(.*)$/);
    let tTok='', pTok='', prTok='';
    if (m) { tTok=m[1].trim(); pTok=m[2].trim(); prTok=m[3].trim(); }
    else {
      const toks = main.split(/\s+/).filter(Boolean); // запасний варіант
      tTok=toks[0]||''; pTok=toks[1]||''; prTok=toks[2]||'';
    }

    const t  = prettyNuclide(tTok);
    const ps = prettyParticles(pTok);
    const pr = prTok ? prettyNuclide(prTok) : '';
    const ob = prettyObservable(obs, obsMode);

    let title = t + '(' + ps + ')' + pr;
    if (ob) title += ' — ' + ob;     // керуємо виглядом SIG тут
    return title;
  }

  // читання параметрів з рядка запиту
  function getQuery(name, def=''){
    const u = new URL(location.href);
    return u.searchParams.get(name) ?? def;
  }

  // ===================== головний рендер =====================
  function renderFromX4(x4, opts={}){
    const traces=[], meta=[];
    for (const [i,ds] of (x4.datasets||[]).entries()){
      const tr = makeTrace(ds, i);
      if (tr){
        traces.push(tr);
        const id = ds.id || '';
        const rc = ds.reaction?.code || '';
        meta.push(`${ds.author1||''} ${ds.year||''} — ${rc}${id?` (EXFOR ${id})`:''}`);
      }
    }

    const rawCode = x4?.datasets?.[0]?.reaction?.code || '';
    const obsMode = getQuery('obs','raw'); // raw | word | none
    const title   = (x4?.title||'').trim() || formatReactionPretty(rawCode, obsMode);

    if (opts.returnTraces) return { traces, title, meta };

    Plotly.newPlot('chart', traces, {
      title: { text: title, x: 0, xanchor: 'left', pad: { t: 8, b: 8 } },
      xaxis: { title: { text: 'Incident Energy (MeV)' }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      yaxis: { title: { text: 'Cross section (barns)' }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      legend:{ orientation: 'v', x: 1.02, y: 1, xanchor: 'left', bgcolor: 'rgba(255,255,255,.75)' },
      margin:{ l: 78, r: 160, t: 64, b: 72 },
      plot_bgcolor: '#fff',
      paper_bgcolor: '#fff'
    }, { responsive: true, displaylogo: false });

    const metaEl = document.getElementById('meta');
    if (metaEl) metaEl.textContent = meta.length ? ('Datasets included:\n' + meta.join('\n')) : '';
    return { traces, title, meta };
  }

  // робимо доступним для viewer.html
  window.__renderX4 = renderFromX4;
})();
