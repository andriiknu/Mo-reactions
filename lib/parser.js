// lib/parser.js
(function () {
  // --------- стиль маркерів ---------
  const COLORS  = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
  const SYMBOLS = ['circle','square','diamond','cross','triangle-up','star'];
  const ENERGY_HEADERS = [
    'EN','E','E-LAB','ELAB','EN-LAB','EN-LAB-AVG','EN-LAB-MEAN','EN-MEAN','EN-AVG','EN-AVE','EN-PEAK',
    'EN-CM','E-CM','EN-INC','E-INC','EN-PR','EN-DUMMY','E-DUMMY','KT-DUMMY','EN-MAX','EN-MIN','ENERGY'
  ];
  const SPECTRUM_ENERGY_HEADERS = ['KT-DUMMY','EN-DUMMY','E-DUMMY'];
  const AVERAGED_ENERGY_HEADERS = ['EN-AVG','EN-AVE','EN-MEAN','EN-LAB-AVG','EN-LAB-MEAN','EN-PEAK','EN-MAX','EN-MIN'];

  // --------- утиліти читання заголовків ---------
  function headerIndex(h, list){ for (const c of list){ const i=h.findIndex(x=>x.x4Header===c); if(i>=0) return i; } return -1; }
  function headerMap(h){ const m={}; for (const x of h) m[x.x4Header]=x; return m; }

  function classifyEnergyHeader(header){
    if (!header) return 'direct';
    const up = String(header).toUpperCase();
    if (SPECTRUM_ENERGY_HEADERS.includes(up) || /DUMMY/.test(up)) return 'spectrum';
    if (AVERAGED_ENERGY_HEADERS.includes(up)) return 'averaged';
    return 'direct';
  }

  function convertEnergyToMeV(value, header){
    const v = Number(value);
    if (!isFinite(v)) return NaN;
    const convToBasic = Number(header?.ConvFactor) || 1;
    const basicUnits = String(header?.BasicUnits || '').trim().toUpperCase();
    const valBasic = v * convToBasic;
    const basicToMeV = (unit=>{
      switch(unit){
        case 'EV': return 1e-6;
        case 'KEV': return 1e-3;
        case 'MEV': return 1;
        case 'GEV': return 1e3;
        case 'J': case 'JOULE': return 1 / 1.602176634e-13;
        default: return 1;
      }
    })(basicUnits);
    return valBasic * basicToMeV;
  }

  function describeEnergyKind(kind){
    if (kind === 'spectrum') return 'Spectrum-averaged energy';
    if (kind === 'averaged') return 'Averaged incident energy';
    return 'Incident energy';
  }

  function stripTags(str){
    return String(str || '').replace(/<[^>]*>/g, '').trim();
  }

  // --------- побудова одного трейсу ---------
  function makeTrace(ds, iDataset, opts={}){
    const hs   = ds.headers||[];
    const iE   = headerIndex(hs, ENERGY_HEADERS);
    const iY   = headerIndex(hs, ['DATA']);
    const iErr = headerIndex(hs, ['ERR-T','DATA-ERR']);
    if (iE<0 || iY<0) return null;
    const energyHeader = hs[iE]?.x4Header || '';
    const energyKind = classifyEnergyHeader(energyHeader);
    const energyHeaderInfo = hs[iE] || {};

    const conv = parseFloat(headerMap(hs)['DATA']?.ConvFactor || 1);
    // determine renormalization factor: check opts.renormMap for ds.entry.id or ds.subent.id or ds.id
    let renorm = 1;
    try{
      const map = opts && opts.renormMap ? opts.renormMap : null;
      if (map){
        const entryId = ds.entry?.id || ds.subent?.id || ds.id;
        if (entryId && typeof map[entryId] === 'number') renorm = map[entryId];
        else if (entryId && typeof map[entryId] === 'string') renorm = parseFloat(map[entryId]) || 1;
        if (renorm !== 1) {
          try{ console.log('parser: applying renorm', entryId, renorm); }catch(e){}
        }
      }
    }catch(e){ /* ignore and use renorm=1 */ }

    const x=[], y=[], ey=[];
    for (const row of (ds.data||[])){
      const E=convertEnergyToMeV(row[iE], energyHeaderInfo), S=+row[iY];
      if (!isFinite(E) || !isFinite(S)) continue;
      const Sconv = S * conv * renorm;
      x.push(E); y.push(Sconv);
      if (iErr>=0 && isFinite(row[iErr])){
        const rawErr = +row[iErr];
        const errUnits = (hs[iErr] && hs[iErr].x4Units) ? String(hs[iErr].x4Units) : '';
        if (/PER-?CENT/i.test(errUnits)){
          // err is given in percent -> convert to absolute relative to renormalized value
          ey.push(Sconv * (rawErr / 100));
        } else {
          // absolute error in same units as DATA (apply conv and renorm)
          ey.push(rawErr * conv * renorm);
        }
      } else ey.push(NaN);
    }

    const name = `${ds.author1||''}, ${ds.year||''}`.trim() || (ds.reaction?.code || 'dataset');

    const trace = {
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
    trace._energyKind = energyKind;
    trace._energyHeader = energyHeader;
    trace._energyKindLabel = describeEnergyKind(energyKind);
    return trace;
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
    try{
      if (typeof URL !== 'undefined' && location && location.href){
        const u = new URL(location.href);
        return u.searchParams.get(name) ?? def;
      }
    }catch(e){ /* fall through to fallback parsing */ }
    // fallback: parse location.search manually
    try{
      const qs = (location && location.search) ? location.search.replace(/^\?/, '') : '';
      if (!qs) return def;
      for (const part of qs.split('&')){
        const [k,v] = part.split('=');
        if (decodeURIComponent(k) === name) return decodeURIComponent(v || '') || def;
      }
    }catch(e){ /* ignore */ }
    return def;
  }

  // ===================== головний рендер =====================
  function renderFromX4(x4, opts={}){
    const traces=[], meta=[];
    const obsMode = getQuery('obs','raw');
    const legendGroups = new Map();

    for (const [i,ds] of (x4.datasets||[]).entries()){
      const tr = makeTrace(ds, i, opts);
      if (tr){
        const reactionCode = String(ds.reaction?.code || '').trim();
        const energyKind = tr._energyKind || 'direct';
        const legendGroup = `${reactionCode || `reaction:${ds.reaction?.ReactionType || 'unknown'}`}::${energyKind}`;
        let legendTitle = legendGroups.get(legendGroup);
        const isNewGroup = !legendGroups.has(legendGroup);
        if (isNewGroup){
          const baseTitle = reactionCode ? formatReactionPretty(reactionCode, obsMode) : (reactionCode || ds.reaction?.ReactionType || 'Unknown reaction');
          const suffix = energyKind === 'spectrum'
            ? ' (spectrum-averaged energies)'
            : energyKind === 'averaged'
              ? ' (averaged energies)'
              : '';
          legendTitle = `${baseTitle}${suffix}`;
          legendGroups.set(legendGroup, legendTitle);
        }
        tr.legendgroup = legendGroup;
        if (isNewGroup && legendTitle) tr.legendgrouptitle = { text: legendTitle };

        traces.push(tr);
        const id = ds.id || '';
        const rcPlain = stripTags(legendTitle || reactionCode || '');
        const rc = rcPlain || reactionCode || '';
        const energyLabel = tr._energyKind === 'direct' ? '' : ` [${tr._energyKindLabel || describeEnergyKind(tr._energyKind)}]`;
        meta.push(`${ds.author1||''} ${ds.year||''} — ${rc}${energyLabel}${id?` (EXFOR ${id})`:''}`);
      }
    }

    const rawCode = x4?.datasets?.[0]?.reaction?.code || '';
    const title   = (x4?.title||'').trim() || formatReactionPretty(rawCode, obsMode);

    if (opts.returnTraces) return { traces, title, meta };

    Plotly.newPlot('chart', traces, {
      title: { text: title, x: 0, xanchor: 'left', pad: { t: 8, b: 8 } },
      xaxis: { title: { text: 'Incident Energy (MeV)' }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      yaxis: { title: { text: 'Cross section (barns)' }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      legend:{
        orientation: 'v',
        x: 1.02, y: 1, xanchor: 'left',
        bgcolor: 'rgba(255,255,255,.75)',
        groupclick: 'toggleitem'
      },
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
