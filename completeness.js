(() => {
  const el = id => document.getElementById(id);
  const labels = { found: 'Found', missing: 'Missing', unknown: 'Unable to check' };
  let current;
  let controller;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function renderVisits() {
    const missingOnly = el('missing-only').checked;
    el('years').replaceChildren();
    for (const year of [...new Set(current.visits.map(visit => visit.year))]) {
      const section = element('section', undefined, 'year');
      section.append(element('h2', `YEAR ${year}`));
      let visible = 0;
      current.visits.filter(visit => visit.year === year).forEach(visit => {
        const reports = visit.reports.filter(report => !missingOnly || report.status === 'missing');
        if (!reports.length) return;
        visible++;
        const found = visit.reports.filter(report => report.status === 'found').length;
        const missing = visit.reports.filter(report => report.status === 'missing').length;
        const unknown = visit.reports.filter(report => report.status === 'unknown').length;
        const card = element('details', undefined, 'visit');
        card.open = missing > 0 || unknown > 0;
        const summary = element('summary');
        const title = element('div', undefined, 'visit-title');
        title.append(element('strong', visit.name), element('span', `${found}/${visit.reports.length} found`));
        const notes = [];
        if (missing) notes.push(`${missing} missing`);
        if (unknown) notes.push(`${unknown} unable to check`);
        summary.append(title, element('div', notes.join(' · ') || 'All reports found', 'visit-note'));
        const list = element('ul', undefined, 'reports');
        reports.forEach(report => {
          const row = element('li', undefined, 'report');
          const line = element('div', undefined, 'report-line');
          line.append(element('span', report.name), element('span', labels[report.status], `report-status ${report.status}`));
          row.append(line);
          if (report.reason) row.append(element('p', report.reason, 'reason'));
          list.append(row);
        });
        card.append(summary, list);
        section.append(card);
      });
      if (visible) el('years').append(section);
    }
    el('filter-message').hidden = !missingOnly;
    el('filter-message').textContent = current.counts.missing
      ? `Showing missing reports only.${current.counts.unknown ? ` ${current.counts.unknown} ${current.counts.unknown === 1 ? "report could not be checked and is" : "reports could not be checked and are"} hidden by this filter.` : ''}`
      : `No confirmed missing reports.${current.counts.unknown ? ` ${current.counts.unknown} ${current.counts.unknown === 1 ? "report" : "reports"} could not be checked. Turn off the filter to see them.` : ''}`;
  }
  function show(payload, sample = false) {
    current = payload;
    el('empty-state').hidden = true;
    el('results').hidden = false;
    el('sample-notice').hidden = !sample;
    el('result-id').textContent = sample ? 'Sample participant' : payload.res_id;
    el('checked-at').textContent = sample ? 'Layout preview' : `Checked ${new Date(payload.checked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const { total, found, missing, unknown } = payload.counts;
    el('total-found').textContent = `${found} of ${total} reports found`;
    el('progress').setAttribute('aria-valuemax', total);
    el('progress').setAttribute('aria-valuenow', found);
    el('progress').firstElementChild.style.width = `${total ? found / total * 100 : 0}%`;
    el('counts').replaceChildren(element('span', `${found} found`, 'found'), element('span', `${missing} missing`, 'missing'), element('span', `${unknown} unable to check`, 'unknown'));
    el('no-match').hidden = sample || found > 0 || missing === 0;
    renderVisits();
  }
  el('search-form').addEventListener('submit', async event => {
    event.preventDefault();
    const id = el('participant-id').value.trim().toUpperCase();
    el('results').hidden = true;
    if (!/^RES[0-9]{1,12}$/.test(id)) {
      el('message').textContent = 'Enter a RESET ID such as RES5216.';
      el('participant-id').focus();
      return;
    }
    el('participant-id').value = id;
    controller?.abort();
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    el('search-button').disabled = true;
    el('sample-button').disabled = true;
    el('search-button').textContent = 'Checking…';
    el('message').textContent = `Checking reports for ${id}…`;
    el('results').setAttribute('aria-busy', 'true');
    try {
      const local = ['localhost', '127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
      const base = local ? ENV.LOCAL_URL : ENV.LAMBDA_URL;
      const response = await fetch(`${base}/api/completeness?res_id=${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Reports could not be checked. Please try again.');
      show(payload);
      el('message').textContent = payload.counts.unknown === payload.counts.total ? 'No reports could be checked. Availability is currently unknown.' : 'Report check finished.';
    } catch (error) {
      el('message').textContent = error.name === 'AbortError' ? 'The check timed out. Please try again.' : 'Reports could not be checked. Please try again or contact the study team.';
    } finally {
      clearTimeout(timeout);
      el('search-button').disabled = false;
      el('sample-button').disabled = false;
      el('search-button').textContent = 'Check reports';
      el('results').setAttribute('aria-busy', 'false');
    }
  });
  el('missing-only').addEventListener('change', renderVisits);
  el('sample-button').addEventListener('click', () => {
    const definitions = [
      [1, '1A', ['Golden Form', 'SelfQ', 'MoCA']], [1, '1B', ['Biochem', 'Liver', 'DEXA', 'PE', 'Biobank collection']],
      [1, '1C', ['Echo', 'Vascular']], [2, '2A', ['Medical History', 'SelfQ', 'MoCA', 'Biochem', 'Liver', 'PE', 'Biobank collection']],
      [2, '2B', ['CTCA']],
      [3, '3A', ['Medical History', 'Biochem', 'SelfQ', 'Biobank collection']],
    ];
    let index = 0;
    const visits = definitions.map(([year, id, names]) => ({ year, id, name: `Visit ${id}`, reports: names.map(name => {
      const status = [5, 6, 9, 14].includes(index) ? 'missing' : index === 13 ? 'unknown' : 'found';
      index++;
      return { name, status, ...(status === 'unknown' ? { reason: 'Source temporarily unavailable' } : {}) };
    }) }));
    el('message').textContent = '';
    const counts = { total: 0, found: 0, missing: 0, unknown: 0 };
    visits.flatMap(visit => visit.reports).forEach(report => { counts.total++; counts[report.status]++; });
    show({ res_id: 'SAMPLE', counts, visits }, true);
  });
})();
