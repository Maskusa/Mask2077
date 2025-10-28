(function(){
  const vscode = acquireVsCodeApi();
  function fmt(n){ return (n||0).toLocaleString(); }

  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'update') {
      document.getElementById('inputValue').textContent = fmt(msg.totals.input);
      document.getElementById('cachedValue').textContent = fmt(msg.totals.cached);
      document.getElementById('outputValue').textContent = fmt(msg.totals.output);

      // by day
      const dayTbody = document.querySelector('#byDayTable tbody');
      dayTbody.innerHTML = '';
      (msg.byDay || []).sort((a,b)=>a.key.localeCompare(b.key)).forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.key}</td><td>${fmt(row.input)}</td><td>${fmt(row.cached)}</td><td>${fmt(row.output)}</td>`;
        dayTbody.appendChild(tr);
      });

      // by model
      const modelTbody = document.querySelector('#byModelTable tbody');
      modelTbody.innerHTML = '';
      (msg.byModel || []).sort((a,b)=> (b.input+b.output) - (a.input+a.output)).forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${row.key}</td><td>${fmt(row.input)}</td><td>${fmt(row.cached)}</td><td>${fmt(row.output)}</td>`;
        modelTbody.appendChild(tr);
      });

      // recent
      const recentTbody = document.querySelector('#recentTable tbody');
      recentTbody.innerHTML = '';
      (msg.recent || []).forEach(ev => {
        const tr = document.createElement('tr');
        const time = new Date(ev.ts).toLocaleString();
        const fileName = ev.file.split(/[\\/]/).pop();
        tr.innerHTML = `<td>${time}</td><td>${ev.model||''}</td><td>${fmt(ev.input)}</td><td>${fmt(ev.cached)}</td><td>${fmt(ev.output)}</td><td><a href="#" data-file="${ev.file}">${fileName}</a></td>`;
        tr.querySelector('a')?.addEventListener('click', e => {
          e.preventDefault();
          vscode.postMessage({ type: 'openFile', file: ev.file });
        });
        recentTbody.appendChild(tr);
      });
    }
  });
})();