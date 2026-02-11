// lib/parser.js
(function () {
  // --------- стиль маркерів ---------
  const COLORS  = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
  const SYMBOLS = ['circle','square','diamond','cross','triangle-up','star'];
  const ENERGY_HEADERS = [
    'EN','E','E-LAB','ELAB','EN-LAB','EN-LAB-AVG','EN-LAB-MEAN','EN-MEAN','EN-AVG','EN-AVE','EN-PEAK',
    'EN-CM','E-CM','EN-INC','E-INC','EN-PR','EN-DUMMY','E-DUMMY','KT-DUMMY','EN-MAX','EN-MIN','ENERGY'
  ];
  const ENERGY_ERR_HEADERS = [
    'EN-ERR','E-ERR','EN-RSL','E-RSL',
    'EN-RSL-HW','E-RSL-HW','EN-RSL-FW','E-RSL-FW',
    'EN-ERR-DIG','E-ERR-DIG',
    '+EN-ERR','+E-ERR','+EN-RSL','+E-RSL'
  ];
  const SPECTRUM_ENERGY_HEADERS = ['KT-DUMMY','EN-DUMMY','E-DUMMY'];
  const AVERAGED_ENERGY_HEADERS = ['EN-AVG','EN-AVE','EN-MEAN','EN-LAB-AVG','EN-LAB-MEAN','EN-PEAK','EN-MAX','EN-MIN'];
  const DEFAULT_CONFIG = {
    marker_size: 8,
    font_size: 12,
    font_family: '"Open Sans", verdana, arial, sans-serif',
    font_color: '#444',
    x_label_offset: 20,
    y_label_offset: 20,
    margin: { l: 78, r: 160, t: 64, b: 72 }
  };

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
    const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    const hs   = ds.headers||[];
    const iE   = headerIndex(hs, ENERGY_HEADERS);
    const iY   = headerIndex(hs, ['DATA', 'DATA-MAX', 'DATA-MIN', 'DATA-APRX']);
    const iErr = headerIndex(hs, ['ERR-T','DATA-ERR']);
    const iErrX= headerIndex(hs, ENERGY_ERR_HEADERS);
    if (iE<0 || iY<0) return null;
    const energyHeader = hs[iE]?.x4Header || '';
    const energyKind = classifyEnergyHeader(energyHeader);
    const energyHeaderInfo = hs[iE] || {};

    const conv = parseFloat(hs[iY]?.ConvFactor || 1);
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

    const x=[], y=[], ey=[], ex=[];
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
      if (iErrX>=0 && isFinite(row[iErrX])){
        const rawErr = +row[iErrX];
        const errUnits = (hs[iErrX] && hs[iErrX].x4Units) ? String(hs[iErrX].x4Units) : '';
        if (/PER-?CENT/i.test(errUnits)){
          ex.push(E * (rawErr / 100));
        } else {
          ex.push(convertEnergyToMeV(rawErr, hs[iErrX]));
        }
      } else ex.push(NaN);
    }

    let name = `${ds.author1||''}, ${ds.year||''}`.trim() || (ds.reaction?.code || 'dataset');
    let symbol = SYMBOLS[iDataset % SYMBOLS.length];
    let yLabel = 'σ =';

    const yHeader = hs[iY]?.x4Header;
    if (yHeader === 'DATA-MAX') {
      name += ' (max)';
      symbol = 'triangle-down';
      yLabel = 'σ <';
    } else if (yHeader === 'DATA-MIN') {
      name += ' (min)';
      symbol = 'triangle-up';
      yLabel = 'σ >';
    } else if (yHeader === 'DATA-APRX') {
      name += ' (approx)';
      yLabel = 'σ ≈';
    }

    const trace = {
      x, y, name,
      mode: 'markers',
      marker: {
        size: config.marker_size,
        color: COLORS[iDataset % COLORS.length],
        symbol: symbol,
        line: { width: 0.5, color: 'rgba(0,0,0,.25)' }
      },
      error_y: { type: 'data', array: ey, visible: true, thickness: 1, width: 2, color: 'rgba(0,0,0,.35)' },
      hovertemplate: `<b>%{fullData.name}</b><br>E = %{x:.3f} MeV<br>${yLabel} %{y:.5f} b<extra></extra>`
    };
    if (iErrX>=0) {
      trace.error_x = { type: 'data', array: ex, visible: true, thickness: 1, width: 2, color: 'rgba(0,0,0,.35)' };
    }
    trace._energyKind = energyKind;
    trace._energyHeader = energyHeader;
    trace._energyKindLabel = describeEnergyKind(energyKind);
    return trace;
  }

  // --------- побудова одного трейсу для формату ENDF-like (funcs) ---------
  function makeTraceFromFunc(func, iFunc, rootData, opts={}){
    const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    const x = func.pts.map(p => p.x);
    const y = func.pts.map(p => p.y);

    let name = func.fName || `Function ${iFunc + 1}`;
    const parts = name.split(':');
    if (parts.length > 1) {
      name = parts.slice(1).join(':').trim(); // Use content after the first colon
    }

    // No error bars in this format, so they will be empty/invisible
    const ey = new Array(y.length).fill(NaN);
    const ex = new Array(x.length).fill(NaN);

    const trace = {
      x, y, name,
      mode: 'lines', // Use lines for ENDF data as it's continuous
      line: {
        width: 2, // Default line width
        color: COLORS[iFunc % COLORS.length]
      },
      error_y: { type: 'data', array: ey, visible: false },
      error_x: { type: 'data', array: ex, visible: false },
      hovertemplate: `<b>%{fullData.name}</b><br>${rootData.xAxis} = %{x:.3f} ${rootData.xUnits}<br>${rootData.yAxis} = %{y:.5f} ${rootData.yUnits}<extra></extra>`
    };
    trace._energyKind = 'direct';
    trace._energyHeader = rootData.xAxis;
    trace._energyKindLabel = describeEnergyKind('direct');
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
    const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
    const traces=[], meta=[];
    const obsMode = getQuery('obs','raw');
    const legendGroups = new Map();
    let plotTitle = (x4?.title||'').trim();
    let xAxisTitle = 'Incident Energy (MeV)';
    let yAxisTitle = 'Cross section (barns)';

    if (x4.datasets && x4.datasets.length > 0) {
      // Process EXFOR format
      for (const [i,ds] of x4.datasets.entries()){
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
      // If plotTitle is empty, use the first reaction code formatted
      if (!plotTitle && x4.datasets[0]?.reaction?.code) {
        plotTitle = formatReactionPretty(x4.datasets[0].reaction.code, obsMode);
      }
    } else if (x4.funcs && x4.funcs.length > 0) {
      // Process ENDF-like format (from ZVView)
      xAxisTitle = `${x4.xAxis || 'Incident Energy'} (${x4.xUnits || 'MeV'})`;
      yAxisTitle = `${x4.yAxis || 'Cross Section'} (${x4.yUnits || 'barns'})`;

      for (const [i, func] of x4.funcs.entries()) {
        const tr = makeTraceFromFunc(func, i, x4, opts);
        if (tr) {
          // For ENDF data, each function is a unique trace.
          // No legend grouping is needed, which prevents the "double label" issue.
          // The trace name is already simplified inside makeTraceFromFunc.
          traces.push(tr);
          meta.push(String(func.fName || '').trim());
        }
      }
    } else {
      // No data to plot
      console.warn("No datasets or functions found in the provided JSON data.");
    }

    if (opts.returnTraces) return { traces, title: plotTitle, meta };

    if (traces.length === 0) {
      const chartDiv = document.getElementById('chart');
      if (chartDiv) {
        Plotly.purge(chartDiv);
        chartDiv.innerHTML = `<div style="text-align: center; padding: 40px; font-family: sans-serif; color: #666;">
          <h3>No data to display</h3>
          <p>The data file may be empty, malformed, or in an unsupported format.</p>
          <p>Check the browser's developer console for more details.</p>
        </div>`;
      }
      const metaEl = document.getElementById('meta');
      if (metaEl) metaEl.textContent = '';
      return { traces, title: plotTitle, meta };
    }

    const layout = {
      title: { text: plotTitle, x: 0, xanchor: 'left', pad: { t: 8, b: 8 } },
      font: { size: config.font_size, family: config.font_family, color: config.font_color },
      xaxis: { title: { text: xAxisTitle, standoff: config.x_label_offset }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      yaxis: { title: { text: yAxisTitle, standoff: config.y_label_offset }, showgrid: true, gridcolor: 'rgba(0,0,0,.08)', zeroline: false },
      legend: {
        orientation: 'v',
        x: 1.02, y: 1, xanchor: 'left',
        bgcolor: 'rgba(255,255,255,.75)',
        groupclick: 'toggleitem'
      },
      margin: config.margin,
      plot_bgcolor: '#fff',
      paper_bgcolor: '#fff'
    };

    const plotConfig = {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['toImage'],
      modeBarButtonsToAdd: [{
        name: 'Download plot as png',
        icon: Plotly.Icons.camera,
        click: function (gd) {
          let title = gd.layout.title.text || 'plot';
          try {
            // Use the correct ID for the title input from viewer.html
            const titleInput = document.getElementById('settingTitleText');
            if (titleInput && titleInput.value.trim()) {
              title = titleInput.value;
            }
          } catch (e) {
            // Fallback if element not found or in a non-browser environment
            console.error('Error accessing title input:', e);
          }
          const filename = stripTags(title).replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '_');
          // Add width and height to preserve the current zoom/pan state of the axes
          Plotly.downloadImage(gd, {format: 'png', filename: filename, width: gd.width, height: gd.height});
        }
      }]
    };

    Plotly.newPlot('chart', traces, layout, plotConfig);

    const metaEl = document.getElementById('meta');
    if (metaEl) metaEl.textContent = meta.length ? ('Datasets included:\n' + meta.join('\n')) : '';
    return { traces, title: plotTitle, meta };
  }

  // робимо доступним для viewer.html
  window.__renderX4 = renderFromX4;
})();
