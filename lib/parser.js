// /lib/parser.js
(function () {
  function headerIndex(h, list){ for(const c of list){const i=h.findIndex(x=>x.x4Header===c); if(i>=0) return i;} return -1; }
  function headerMap(h){ const m={}; for(const x of h) m[x.x4Header]=x; return m; }

  function makeTrace(ds){
    const hs = ds.headers||[];
    const iE   = headerIndex(hs, ["EN"]);
    const iY   = headerIndex(hs, ["DATA"]);
    const iErr = headerIndex(hs, ["ERR-T","DATA-ERR"]);
    if (iE<0 || iY<0) return null;

    const conv = parseFloat(headerMap(hs)["DATA"]?.ConvFactor || 1);
    const x=[], y=[], ey=[];
    for(const row of (ds.data||[])){
      const E=+row[iE], S=+row[iY];
      if(!isFinite(E)||!isFinite(S)) continue;
      x.push(E); y.push(S*conv);
      if(iErr>=0 && isFinite(row[iErr])) ey.push(+row[iErr]*conv); else ey.push(NaN);
    }
    const name = `${ds.author1||""} ${ds.year||""}`.trim() || (ds.reaction?.code||"dataset");
    return { x,y,name,mode:"markers",error_y:{type:"data",array:ey,visible:true},
      hovertemplate:"E=%{x:.3f} MeV<br>σ=%{y:.5f} b<extra></extra>" };
  }

  function renderFromX4(x4){
    const traces=[], meta=[];
    for(const ds of (x4.datasets||[])){
      const tr = makeTrace(ds);
      if(tr){ traces.push(tr);
        const id=ds.id||"", rc=ds.reaction?.code||"";
        meta.push(`• ${tr.name} — ${rc}${id?` (EXFOR ${id})`:""}`);
      }
    }
    Plotly.newPlot("chart", traces, {
      xaxis:{title:"Incident Energy (MeV)"},
      yaxis:{title:"Cross Section (barns)"},
      legend:{orientation:"h"}, margin:{l:70,r:20,t:10,b:60}
    }, {displaylogo:false});
    document.getElementById("meta").textContent = "Datasets included:\n" + (meta.join("\n")||"(none)");
  }

  // робимо доступним для viewer.html
  window.__renderX4 = renderFromX4;
})();
