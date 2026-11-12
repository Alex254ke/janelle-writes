/* Enhance the employer's existing form without duplicating fields or posting logic. */
(() => {
  const page = document.getElementById('page-emp-post');
  if (!page || typeof window.empInitForm !== 'function') return;
  let mounted = null;
  const field = id => document.getElementById(id);
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };

  function updateSummary() {
    if (!mounted || currentUser?.role !== 'employer') return;
    field('instruction-file-list')?.querySelectorAll('.file-remove').forEach(button => {
      button.setAttribute('role', 'button'); button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', `Remove ${button.closest('.file-item')?.querySelector('.file-name')?.textContent || 'attachment'}`);
    });
    const value = id => String(field(id)?.value || '').trim();
    const pages = Number(value('emp-pages')) || 0;
    const words = Number(value('emp-words')) || 0;
    const rate = Number(value('emp-price')) || 0;
    const number = value => value.toLocaleString();
    const details = {
      subject:value('emp-subject') || 'Your new task',
      level:value('emp-level'), style:value('emp-style'),
      scope:[pages ? `${number(pages)} ${pages === 1 ? 'page' : 'pages'}` : '', words ? `${number(words)} words` : ''].filter(Boolean).join(' · ') || 'Add pages and word count',
      deadline:'Choose a deadline', writer:'Available writers',
      files:field('instruction-file-list')?.children.length ? `${field('instruction-file-list').children.length} ${field('instruction-file-list').children.length === 1 ? 'file' : 'files'} attached` : 'No files added',
      breakdown:pages && value('emp-price') !== '' ? `${number(pages)} ${pages === 1 ? 'page' : 'pages'} × KES ${number(rate)} per page` : 'Calculated from your page count and rate.'
    };
    if (value('emp-deadline')) {
      const deadline = new Date(value('emp-deadline'));
      if (!Number.isNaN(deadline.getTime())) details.deadline = deadline.toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' });
    }
    const writer = field('emp-preferred-writer');
    if (writer?.value) details.writer = writer.selectedOptions[0]?.textContent.split(' — ')[0] || 'Preferred writer';
    Object.entries(details).forEach(([key, text]) => setText(mounted.summary.querySelector(`[data-task-preview="${key}"]`), text));
  }

  function restore() {
    if (!mounted) return;
    const { card, grid, groups, cardChildren, layout, intro, heading, originalHeadingRole, originalHeadingLevel, contentChanges, attributeChanges, actions, actionChildren } = mounted;
    grid.replaceChildren(...groups);
    card.replaceChildren(...cardChildren);
    page.insertBefore(card, layout);
    layout.remove(); intro.remove();
    card.classList.remove('task-form-main'); grid.classList.remove('task-form-sections');
    groups.forEach(group => group.classList.remove('task-subject-field'));
    actions.classList.remove('task-publish-actions'); actions.replaceChildren(...actionChildren);
    contentChanges.forEach(([element, html]) => { element.innerHTML = html; });
    attributeChanges.forEach(([element, name, value]) => { if (value === null) element.removeAttribute(name); else element.setAttribute(name, value); });
    if (originalHeadingRole === null) heading.removeAttribute('role'); else heading.setAttribute('role', originalHeadingRole);
    if (originalHeadingLevel === null) heading.removeAttribute('aria-level'); else heading.setAttribute('aria-level', originalHeadingLevel);
    page.classList.remove('jw-employer-post'); mounted = null;
  }

  function mount() {
    if (mounted) return;
    const card = page.querySelector(':scope > .card');
    const grid = card?.querySelector(':scope > .form-grid');
    if (!grid) return;
    const groups = Array.from(grid.children), cardChildren = Array.from(card.childNodes);
    const heading = page.querySelector('.section-title');
    const originalHeadingRole = heading.getAttribute('role'), originalHeadingLevel = heading.getAttribute('aria-level');
    const actions = card.querySelector('button[onclick*="empPostTask"]').parentElement;
    const actionChildren = Array.from(actions.childNodes);
    const contentChanges = [], attributeChanges = [];
    const changeContent = (element, html) => { if (!element) return; contentChanges.push([element, element.innerHTML]); element.innerHTML = html; };
    const changeAttribute = (element, name, value) => { if (!element) return; attributeChanges.push([element, name, element.getAttribute(name)]); element.setAttribute(name, value); };
    const group = id => groups.find(element => element.querySelector(`[id="${id}"]`));
    const layout = document.createElement('div'); layout.className = 'task-compose-layout';
    const intro = document.createElement('div'); intro.className = 'task-compose-intro';
    intro.innerHTML = '<span class="task-compose-eyebrow">Employer workspace</span><p>A clear brief makes great work possible. Add the details, set your budget, and choose your writer.</p>';
    page.querySelector('.section-header').append(intro);
    heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '1');
    page.insertBefore(layout, card); layout.append(card);
    card.classList.add('task-form-main'); grid.classList.add('task-form-sections');
    page.classList.add('jw-employer-post');

    const meta = document.createElement('div'); meta.className = 'task-order-meta';
    meta.append(group('emp-order-num'), group('emp-date'));
    changeContent(group('emp-order-num').querySelector('.form-label'), 'Order reference');
    const section = (number, title, copy, ids) => {
      const element = document.createElement('section'); element.className = 'task-form-section';
      element.setAttribute('aria-labelledby', `task-compose-section-${number}`);
      element.innerHTML = `<header class="task-section-head"><span class="task-section-number" aria-hidden="true">${number}</span><div><h2 id="task-compose-section-${number}">${title}</h2><p>${copy}</p></div></header><div class="task-section-fields"></div>`;
      element.lastElementChild.append(...ids.map(group));
      return element;
    };
    const sections = [
      section('01', 'Task details', 'Give your writer a clear starting point.', ['emp-subject','emp-level','emp-style','emp-desc','emp-requirements']),
      section('02', 'Scope & budget', 'Set the length, page rate and delivery deadline.', ['emp-words','emp-pages','emp-price','emp-deadline']),
      section('03', 'Files & writer', 'Share references and choose who receives the task.', ['emp-instruction-link','instruction-upload-zone','emp-preferred-writer'])
    ];
    group('emp-subject').classList.add('task-subject-field');
    grid.replaceChildren(...sections);
    card.replaceChildren(meta, grid);

    const summary = document.createElement('aside'); summary.className = 'task-summary-card';
    summary.setAttribute('aria-label', 'Live task summary');
    summary.innerHTML = '<div class="task-summary-head"><span>Order summary</span><span class="task-preview-badge"><i aria-hidden="true"></i> Live preview</span></div><h2 data-task-preview="subject">Your new task</h2><dl><div><dt>Academic level</dt><dd data-task-preview="level"></dd></div><div><dt>Citation style</dt><dd data-task-preview="style"></dd></div><div><dt>Length</dt><dd data-task-preview="scope"></dd></div><div><dt>Deadline</dt><dd data-task-preview="deadline"></dd></div><div><dt>Assigned to</dt><dd data-task-preview="writer"></dd></div><div><dt>Attachments</dt><dd data-task-preview="files"></dd></div></dl><div class="task-summary-cost"><p data-task-preview="breakdown" aria-live="polite"></p></div><p class="task-review-note">Review your brief, budget and deadline before posting.</p>';
    summary.querySelector('.task-summary-cost').prepend(group('emp-total'));
    changeAttribute(summary.querySelector('#emp-total'), 'placeholder', '0.00');
    actions.classList.add('task-publish-actions');
    changeContent(actions.querySelector('[onclick*="empClearForm"]'), 'Clear form');
    changeContent(actions.querySelector('[onclick*="empPostTask"]'), 'Post task <i class="bi bi-arrow-right" aria-hidden="true"></i>');
    actions.prepend(actions.querySelector('[onclick*="empPostTask"]'));
    summary.append(actions); layout.append(summary);

    groups.forEach(element => {
      const control = element.querySelector('input,select,textarea');
      const label = element.querySelector('label');
      if (control && label && control.id) changeAttribute(label, 'for', control.id);
    });
    ['emp-subject','emp-pages','emp-deadline'].forEach(id => {
      changeAttribute(field(id), 'aria-required', 'true');
      const label = group(id).querySelector('label');
      changeContent(label, `${label.innerHTML}<span class="task-required" aria-hidden="true"> *</span>`);
    });
    changeContent(page.querySelector('.upload-text'), 'Drop files here, or <span>browse files</span>');
    changeContent(page.querySelector('.upload-sub'), 'Documents, images and text · up to 25 MB per file');
    const upload = field('instruction-upload-zone');
    changeAttribute(upload, 'tabindex', '0'); changeAttribute(upload, 'role', 'button'); changeAttribute(upload, 'aria-label', 'Attach instruction files');
    mounted = {card,grid,groups,cardChildren,layout,intro,heading,originalHeadingRole,originalHeadingLevel,contentChanges,attributeChanges,summary,actions,actionChildren};
  }

  page.addEventListener('input', updateSummary);
  page.addEventListener('change', updateSummary);
  page.addEventListener('drop', updateSummary);
  page.addEventListener('click', updateSummary);
  page.addEventListener('keydown', event => {
    if (!mounted || !['Enter',' '].includes(event.key)) return;
    if (event.target.id === 'instruction-upload-zone') { event.preventDefault(); field('instruction-file-input').click(); }
    else if (event.target.matches('.file-remove')) { event.preventDefault(); event.target.click(); }
  });
  // Install after deferred legacy modules have finished replacing app handlers.
  function installHooks() {
    const originalInit = window.empInitForm;
    window.empInitForm = function(...args) {
      if (currentUser?.role === 'employer') mount(); else restore();
      const result = originalInit.apply(this, args); updateSummary(); return result;
    };
    const originalCalculate = window.empCalcTotal;
    window.empCalcTotal = function(...args) {
      const result = originalCalculate.apply(this, args); updateSummary(); return result;
    };
    const originalLogout = window.doLogout;
    window.doLogout = async function(...args) {
      if (mounted) window.empClearForm();
      try { return await originalLogout.apply(this, args); }
      finally { restore(); }
    };
    if (page.classList.contains('active') && currentUser?.role === 'employer') { mount(); updateSummary(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installHooks, { once:true });
  else installHooks();
})();
