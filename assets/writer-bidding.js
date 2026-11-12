// Keep presentation and unsent requests separate from the existing bid records.
export function writerBidDisplayState(task, bid, email, now = Date.now()) {
  const same = value => String(value || '').toLowerCase() === String(email || '').toLowerCase();
  if (task.taken_by && same(task.taken_by)) return { group:'selected', label:'Selected', note:'This order is in My Tasks. Continue your work there.' };
  if (task.taken_by) return { group:'closed', label:'Not selected', note:'This order was assigned to another writer.' };
  const status = String(bid?.status || 'pending').toLowerCase();
  if (status === 'declined' || status === 'withdrawn') return { group:'closed', label:status === 'withdrawn' ? 'Withdrawn' : 'Not selected', note:'You can explore other available orders.' };
  const raw = String(task.deadline || '');
  const due = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T23:59:59' : raw);
  if (Number.isFinite(due) && due < now) return { group:'closed', label:'Deadline passed', note:'This order is no longer accepting requests.' };
  if (String(task.status || '').toLowerCase() !== 'pending') return { group:'closed', label:'Closed', note:'This order is no longer accepting requests.' };
  return { group:'pending', label:'Pending', note:'The owner is reviewing requests. If selected, this order moves to My Tasks.' };
}

export function writerBidMessageLength(value) { return Array.from(String(value || '').trim()).length; }

export class WriterBidSession {
  constructor() { this.owner = ''; this.version = 0; this.drafts = new Map(); this.requests = new Map(); }
  reset(owner = '') { this.owner = String(owner).toLowerCase(); this.version++; this.drafts.clear(); this.requests.clear(); }
  sync(owner = '') { const next = String(owner).toLowerCase(); if (next === this.owner) return false; this.reset(next); return true; }
  begin(id) { if (this.requests.has(id)) return null; const ticket = { id, owner:this.owner, version:this.version }; this.requests.set(id, ticket); return ticket; }
  current(ticket) { return ticket.owner === this.owner && ticket.version === this.version; }
  finish(ticket) { if (this.requests.get(ticket.id) === ticket) this.requests.delete(ticket.id); }
}

function initializeWriterBidding() {
  const available = document.getElementById('page-writer-available');
  const bidsPage = document.getElementById('page-writer-bids');
  const detail = document.getElementById('page-task-details');
  if (!available || !bidsPage || !detail) return;
  const memory = new WriterBidSession();
  const ui = { query:'', status:'all', open:new Set() };
  const byId = id => document.getElementById(id);
  const text = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  const date = value => { const d = new Date(value); return !value || Number.isNaN(d.getTime()) ? 'Not set' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? fmtDate(value) : d.toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' }); };
  function actor() {
    const owner = currentUser?.role === 'writer' ? currentUser.email : '';
    if (memory.sync(owner)) {
      ui.query = ''; ui.status = 'all'; ui.open.clear();
      const oldInput = detail.querySelector('#writer-bid-message'); if (oldInput) oldInput.value = '';
      ['avail-search','avail-filter-style','avail-filter-level','writer-bids-search'].forEach(id => { if (byId(id)) byId(id).value = ''; });
    }
    return Boolean(owner);
  }
  function header(page, copy, destination, label) {
    const title = page.querySelector('.section-title');
    const head = page.querySelector('.section-header');
    title.setAttribute('role','heading'); title.setAttribute('aria-level','1');
    const heading = document.createElement('div'); heading.className = 'writer-page-heading';
    heading.innerHTML = '<span class="writer-page-kicker">Writer workspace</span>';
    heading.append(title);
    const paragraph = document.createElement('p'); paragraph.textContent = copy; heading.append(paragraph);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.dataset.writerPage = destination; button.textContent = label;
    head.replaceChildren(heading, button);
  }
  const availableTools = available.querySelector('.search-bar');
  availableTools.classList.add('writer-market-tools');
  const sort = document.createElement('select'); sort.id = 'writer-order-sort'; sort.className = 'filter-select'; sort.setAttribute('aria-label', 'Sort available orders');
  sort.innerHTML = '<option value="deadline">Deadline: soonest</option><option value="newest">Newest first</option>';
  sort.addEventListener('change', () => window.renderAvailableOrders()); availableTools.append(sort);
  header(available, 'Find an order that fits your skills. Read the brief before sending your request.', 'writer-bids', 'My bids');
  available.querySelector('.section-header').after(availableTools);
  byId('avail-search').placeholder = 'Search by topic or order reference'; byId('avail-search').setAttribute('aria-label', 'Search available orders');
  byId('avail-filter-style').setAttribute('aria-label', 'Filter by citation style'); byId('avail-filter-level').setAttribute('aria-label', 'Filter by academic level');
  const count = document.createElement('p'); count.className = 'writer-result-count'; count.setAttribute('aria-live','polite'); availableTools.after(count);
  byId('avail-orders-wrap').classList.add('writer-market-grid');
  header(bidsPage, 'Track requests awaiting a decision. Selected orders move to My Tasks.', 'writer-available', 'Find orders');
  const bidTools = document.createElement('div'); bidTools.className = 'writer-bids-tools';
  bidTools.innerHTML = '<div class="writer-bid-filters" role="group" aria-label="Filter your bids"><button type="button" data-writer-bid-filter="all" aria-pressed="true">All</button><button type="button" data-writer-bid-filter="pending" aria-pressed="false">Pending</button><button type="button" data-writer-bid-filter="closed" aria-pressed="false">Closed</button></div><input class="search-input" id="writer-bids-search" type="search" placeholder="Search your requests" aria-label="Search your bids">';
  bidsPage.querySelector('.section-header').after(bidTools);
  byId('writer-bids-search').addEventListener('input', event => { ui.query = event.target.value; window.renderWriterBidsPage(); });
  const facts = pairs => `<dl class="writer-order-facts">${pairs.map(([label,value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
  const pageLabel = task => `${Number(task.pages || 0)} ${Number(task.pages) === 1 ? 'page' : 'pages'}`;
  const requestLabel = task => { const count = bidCountForTask(task); return `${count} ${count === 1 ? 'request' : 'requests'}`; };
  const statusPill = state => `<span class="writer-request-status writer-request-${state.group}">${esc(state.label)}</span>`;
  const openButton = id => `<button type="button" class="btn btn-primary" data-writer-open="${esc(id)}">Open order <i class="bi bi-arrow-right" aria-hidden="true"></i></button>`;
  const empty = (title, copy, button = '') => `<div class="writer-bidding-empty"><i class="bi bi-inbox" aria-hidden="true"></i><h2>${esc(title)}</h2><p>${esc(copy)}</p>${button}</div>`;

  window.writerBidCounts = function() {
    const list = currentUser?.role === 'writer' ? writerBidsList() : [];
    const states = list.map(({task,bid})=>writerBidDisplayState(task,bid,currentUser?.email));
    return { total:list.length, pending:states.filter(state=>state.group==='pending').length, selected:0, declined:states.filter(state=>state.group==='closed').length };
  };

  window.renderAvailableOrders = function() {
    if (!actor()) { byId('avail-orders-wrap').replaceChildren(); return; }
    const query = byId('avail-search').value.trim().toLowerCase(), style = byId('avail-filter-style').value, level = byId('avail-filter-level').value;
    const all = tasks.filter(isPublicAvailableTask);
    const list = all.filter(t => (!query || `${t.id} ${t.subject} ${t.description || ''}`.toLowerCase().includes(query)) && (!style || t.style === style) && (!level || t.level === level));
    const due = t => { const raw = String(t.deadline || ''); const stamp = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + 'T23:59:59' : raw); return Number.isFinite(stamp) ? stamp : Infinity; };
    list.sort(sort.value === 'newest' ? (a,b) => (Date.parse(b.created_at || b.order_date) || 0) - (Date.parse(a.created_at || a.order_date) || 0) : (a,b) => due(a) - due(b));
    text(count, `${list.length} ${list.length === 1 ? 'order' : 'orders'}${query || style || level ? ' matching your filters' : ' available'}`);
    const wrap = byId('avail-orders-wrap');
    if (!list.length) { wrap.innerHTML = empty(all.length ? 'No matching orders' : 'You’re up to date', all.length ? 'Try a different topic, style or academic level.' : 'New orders will appear here when they are available.', all.length ? '<button type="button" class="btn btn-outline" data-writer-clear-orders>Clear filters</button>' : '<button type="button" class="btn btn-outline" data-writer-page="writer-bids">Check my bids</button>'); return; }
    wrap.innerHTML = list.map(t => {
      const own = writerBidForTask(t), attachments = parseInstructionFiles(t.instruction_files).length;
      return `<article class="writer-market-card"><div class="writer-card-top"><span class="writer-order-reference">${esc(t.id)}</span>${own ? statusPill(writerBidDisplayState(t,own,currentUser.email)) : '<span class="writer-open-label">Open for requests</span>'}</div><h2>${esc(t.subject || 'Untitled order')}</h2><p class="writer-card-owner">${esc(isStudentTask(t) ? 'International student' : t.posted_by_name || 'Employer')} · ${ratingChipForUser(t.posted_by,'employer')}</p><p class="writer-card-description">${esc(t.description || 'Open the order to read its instructions.')}</p>${facts([['Academic level',t.level || 'Not set'],['Citation style',t.style || 'Not set'],['Length',`${pageLabel(t)}${t.words ? ` · ${Number(t.words).toLocaleString()} ${Number(t.words) === 1 ? 'word' : 'words'}` : ''}`],['Deadline',date(t.deadline)]])}<div class="writer-card-signals"><span><i class="bi bi-chat-square-text" aria-hidden="true"></i> ${requestLabel(t)}</span>${attachments ? `<span><i class="bi bi-paperclip" aria-hidden="true"></i> ${attachments} ${attachments === 1 ? 'file' : 'files'}</span>` : ''}</div><div class="writer-card-bottom"><div><span class="writer-payout-label">Writer payout</span><strong>${esc(writerPayoutText(t))}</strong><small>${esc(writerRateText(t))}</small></div>${openButton(t.id)}</div></article>`;
    }).join('');
  };

  window.renderWriterBidsPage = function() {
    if (!actor()) { byId('writer-bids-wrap').replaceChildren(); return; }
    bidsPage.querySelectorAll('details[data-writer-message]').forEach(element => {
      if (element.open) ui.open.add(element.dataset.writerMessage); else ui.open.delete(element.dataset.writerMessage);
    });
    const list = writerBidsList().map(item => ({...item, view:writerBidDisplayState(item.task,item.bid,currentUser.email)}));
    const query = ui.query.trim().toLowerCase();
    bidTools.querySelectorAll('[data-writer-bid-filter]').forEach(button => {
      const filter = button.dataset.writerBidFilter, total = filter === 'all' ? list.length : list.filter(item=>item.view.group===filter).length;
      text(button, `${filter === 'all' ? 'All' : filter === 'pending' ? 'Pending' : 'Closed'} (${total})`); button.setAttribute('aria-pressed',String(ui.status === filter));
    });
    const matches = list.filter(({task:t,bid:b,view}) => (ui.status === 'all' || ui.status === view.group) && (!query || `${t.id} ${t.subject} ${b.message || ''}`.toLowerCase().includes(query)));
    byId('writer-bids-wrap').innerHTML = matches.length ? `<div class="writer-request-grid">${matches.map(({task:t,bid:b,view}) => `<article class="writer-request-card"><div class="writer-card-top"><span class="writer-order-reference">${esc(t.id)}</span>${statusPill(view)}</div><h2>${esc(t.subject || 'Untitled order')}</h2><p class="writer-card-owner">Sent ${esc(date(b.at))}</p>${facts([['Length',pageLabel(t)],['Deadline',date(t.deadline)],['Writer payout',writerPayoutText(t)],['Citation style',t.style || 'Not set']])}<details class="writer-request-message" data-writer-message="${esc(t.id)}"${ui.open.has(String(t.id)) ? ' open' : ''}><summary>Your request</summary><p>${esc(b.message || 'No message saved.')}</p></details><p class="writer-request-next">${esc(view.note)}</p><div class="writer-request-actions">${openButton(t.id)}</div></article>`).join('')}</div>` : empty(list.length ? 'No matching requests' : 'Your next opportunity starts here', list.length ? 'Change the status filter or search to find your request.' : 'Open an available order, read the brief, and tell the owner why you’re a good fit.', `<button type="button" class="btn btn-outline" ${list.length ? 'data-writer-clear-bids' : 'data-writer-page="writer-available"'}>${list.length ? 'Clear filters' : 'Find available orders'}</button>`);
  };

  function activeForm(id) { return [...detail.querySelectorAll('form[data-writer-bid-task]')].find(form => !id || form.dataset.writerBidTask === String(id)); }
  function captureDraft() {
    if (!actor()) return null;
    const form = activeForm(), input = form?.querySelector('textarea');
    if (!input) return null;
    const id = form.dataset.writerBidTask;
    if (getTaskById(id) && writerBidForTask(getTaskById(id))) { memory.drafts.delete(id); return null; }
    const saved = { value:input.value, start:input.selectionStart, end:input.selectionEnd, scroll:input.scrollTop, focused:document.activeElement===input };
    memory.drafts.set(id,saved); return { id, ...saved };
  }
  function feedback(form, message) { const line = form?.querySelector('.writer-bid-feedback'); if (line) { text(line,message); line.hidden=!message; form.querySelector('textarea')?.setAttribute('aria-invalid',String(Boolean(message))); } }
  function hydrateForm() {
    const form = activeForm(); if (!form) return;
    const id = form.dataset.writerBidTask, input = form.querySelector('textarea'), draft = memory.drafts.get(id), busy = memory.requests.has(id);
    if (draft) { input.value = draft.value; input.setSelectionRange(draft.start,draft.end); input.scrollTop=draft.scroll; }
    input.readOnly=busy; form.querySelector('button[type="submit"]').disabled=busy; form.setAttribute('aria-busy',String(busy));
    text(form.querySelector('.writer-bid-character-count'),`${writerBidMessageLength(input.value)} characters · minimum 20`);
  }
  window.bidRequestPanelForWriter = function(task) {
    if (!actor()) return '';
    const bid = writerBidForTask(task), state = writerBidDisplayState(task,bid,currentUser.email);
    if (bid) return `<div class="jw-writer-bid-panel"><div class="writer-bid-panel-head"><h2>Your request</h2>${statusPill(state)}</div><p class="writer-bid-help">${esc(state.note)}</p><div class="writer-sent-message">${esc(bid.message || 'No message saved.')}</div><button type="button" class="btn btn-outline" data-writer-page="writer-bids">My bids</button></div>`;
    if (!isPublicAvailableTask(task)) return `<div class="jw-writer-bid-panel">${statusPill(state)}<p class="writer-bid-help">This order is no longer accepting requests.</p></div>`;
    const draft = memory.drafts.get(String(task.id)), busy = memory.requests.has(String(task.id));
    return `<form class="jw-writer-bid-panel" data-writer-bid-task="${esc(task.id)}" novalidate aria-busy="${busy}"><div class="writer-bid-panel-head"><h2>Write your request</h2><span class="writer-open-label">${requestLabel(task)}</span></div><p class="writer-bid-help">Introduce your relevant experience, approach and availability. The payout shown above is set for this order.</p><label for="writer-bid-message">Why are you a good fit?</label><textarea id="writer-bid-message" rows="5" aria-required="true" aria-describedby="writer-bid-help writer-bid-feedback"${busy ? ' readonly' : ''} placeholder="I can help with this order because…">${esc(draft?.value || '')}</textarea><div id="writer-bid-help" class="writer-bid-character-count">${writerBidMessageLength(draft?.value)} characters · minimum 20</div><p class="writer-bid-feedback" id="writer-bid-feedback" role="status" hidden></p><div class="writer-bid-submit-row"><p>Your request is sent to the owner for review.</p><button type="submit" class="btn btn-primary"${busy ? ' disabled' : ''}>${busy ? 'Sending…' : 'Send request'} <i class="bi bi-arrow-right" aria-hidden="true"></i></button></div></form>`;
  };
  const canApply = ticket => currentUser?.role === 'writer' && String(currentUser.email || '').toLowerCase() === ticket.owner && memory.current(ticket);
  const originalSubmit = window.submitWriterBid;
  window.submitWriterBid = async function(taskId) {
    const form = activeForm(taskId);
    if (!form) return originalSubmit.apply(this,arguments);
    if (!actor()) return;
    const id = String(taskId), task = getTaskById(id), input = form.querySelector('textarea'), message = input.value.trim();
    if (!task || !isPublicAvailableTask(task)) { feedback(form,'This order is no longer accepting requests.'); return; }
    if (writerBidForTask(task)) { window.renderTaskDetailsPage(); return; }
    if (writerBidMessageLength(message) < 20) { feedback(form,'Write at least 20 characters about your experience and availability.'); input.focus(); return; }
    captureDraft(); const ticket = memory.begin(id); if (!ticket) return;
    const requester = { email:currentUser.email, name:currentUser.name || 'A writer' };
    feedback(form,''); hydrateForm(); text(form.querySelector('button[type="submit"]'),'Sending…');
    try {
      const {data,error} = await _sb.rpc('jw_add_task_bid',{p_task_id:id,p_message:message});
      if (error) throw error;
      if (!canApply(ticket)) return;
      upsertLocalTask({...(getTaskById(id) || task),ratings:data});
      memory.drafts.delete(id);
      window.renderAvailableOrders(); window.renderWriterBidsPage(); updateBadges();
      if (detail.classList.contains('active') && activeForm(id)) window.renderTaskDetailsPage();
      notify('Request sent. You can track it in My Bids.','message');
      // The bid is already saved; a notification failure must not turn it into a failed bid.
      try {
        await _sb.rpc('jw_create_notification',{p_user_email:String(task.posted_by || '').toLowerCase(),p_type:'bid',p_title:'New task request',p_body:`${id} — ${requester.name} sent a request for this task.`,p_task_id:id,p_event_key:`bid:${id}:${requester.email.toLowerCase()}`,p_metadata:{page:'task-details',writer_email:requester.email}});
      } catch (error) { console.warn('Bid saved; owner notification could not be delivered.',error); }
    } catch (error) {
      if (canApply(ticket)) {
        feedback(activeForm(id),`Your request was not sent. ${error?.message || 'Please try again.'}`);
        notify('Your request was not sent. Your draft has been kept.');
      }
    } finally {
      memory.finish(ticket);
      if (canApply(ticket)) { hydrateForm(); const button = activeForm(id)?.querySelector('button[type="submit"]'); if (button) button.innerHTML='Send request <i class="bi bi-arrow-right" aria-hidden="true"></i>'; }
    }
  };
  const originalDetails = window.renderTaskDetailsPage;
  window.renderTaskDetailsPage = function(...args) {
    const draft = captureDraft(), scroll = window.scrollY, wasActive = detail.classList.contains('active');
    const positions = [];
    for (let element = activeForm()?.parentElement; element; element = element.parentElement) {
      if (element.scrollTop || element.scrollLeft) positions.push({element,top:element.scrollTop,left:element.scrollLeft});
    }
    const result = originalDetails.apply(this,args); hydrateForm();
    if (draft && wasActive && activeForm(draft.id)) {
      if (draft.focused) { const input=activeForm(draft.id).querySelector('textarea'); input.focus({preventScroll:true}); input.setSelectionRange(draft.start,draft.end); input.scrollTop=draft.scroll; }
      const version = memory.version;
      const restorePosition = () => {
        if (version!==memory.version || !detail.classList.contains('active') || !activeForm(draft.id)) return;
        window.scrollTo(0,scroll);
        positions.forEach(({element,top,left})=>{if(element.isConnected){element.scrollTop=top;element.scrollLeft=left;}});
      };
      restorePosition(); requestAnimationFrame(restorePosition);
    }
    return result;
  };
  const originalActions = window.taskDetailActionsHtml;
  window.taskDetailActionsHtml = function(task) {
    const template = document.createElement('template'); template.innerHTML=originalActions.apply(this,arguments);
    if (currentUser?.role === 'writer' && !sameEmail(task.taken_by,currentUser.email)) template.content.querySelectorAll('button[onclick*="openMessagesForTask"]').forEach(button=>button.remove());
    template.content.querySelectorAll('button[onclick*="writer-bid-message"]').forEach(button=>{
      if (!isPublicAvailableTask(task)) { button.remove(); return; }
      button.removeAttribute('onclick'); button.dataset.writerFocusBid=String(task.id); button.textContent=writerBidForTask(task) ? 'Your request' : 'Write request';
    });
    return template.innerHTML;
  };
  function handleClick(event) {
    const button = event.target.closest('button'); if (!button || !actor()) return;
    if (button.dataset.writerPage) navigate(button.dataset.writerPage);
    else if (button.dataset.writerOpen) openTaskDetailsPage(button.dataset.writerOpen,{returnPage:available.contains(button)?'writer-available':'writer-bids'});
    else if (button.hasAttribute('data-writer-focus-bid')) { const panel=detail.querySelector('.jw-writer-bid-panel'); panel?.scrollIntoView({behavior:'auto',block:'center'}); panel?.querySelector('textarea')?.focus({preventScroll:true}); }
    else if (button.hasAttribute('data-writer-clear-orders')) { ['avail-search','avail-filter-style','avail-filter-level'].forEach(id=>byId(id).value=''); window.renderAvailableOrders(); }
    else if (button.hasAttribute('data-writer-clear-bids')) { ui.query='';ui.status='all';byId('writer-bids-search').value='';window.renderWriterBidsPage(); }
    else if (button.dataset.writerBidFilter) { ui.status=button.dataset.writerBidFilter;window.renderWriterBidsPage(); }
  }
  [available,bidsPage,detail].forEach(root=>root.addEventListener('click',handleClick));
  detail.addEventListener('input',event=>{if(event.target.id==='writer-bid-message'){captureDraft();text(event.target.closest('form').querySelector('.writer-bid-character-count'),`${writerBidMessageLength(event.target.value)} characters · minimum 20`);feedback(event.target.closest('form'),'');}});
  detail.addEventListener('submit',event=>{const form=event.target.closest('form[data-writer-bid-task]');if(!form)return;event.preventDefault();window.submitWriterBid(form.dataset.writerBidTask);});
  bidsPage.addEventListener('toggle',event=>{if(!actor()||!event.target.matches('details[data-writer-message]'))return;const id=event.target.dataset.writerMessage;if(event.target.open)ui.open.add(id);else ui.open.delete(id);},true);
  const originalLogout=window.doLogout;
  window.doLogout=async function(...args){
    memory.reset(); const input=detail.querySelector('#writer-bid-message'); if(input)input.value='';
    detail.querySelectorAll('.writer-sent-message').forEach(element=>text(element,''));
    byId('avail-orders-wrap').replaceChildren(); byId('writer-bids-wrap').replaceChildren();
    ui.query='';ui.status='all';ui.open.clear();return originalLogout.apply(this,args);
  };
  if(currentUser?.role==='writer'){
    if(available.classList.contains('active'))window.renderAvailableOrders();
    if(bidsPage.classList.contains('active'))window.renderWriterBidsPage();
    if(detail.classList.contains('active'))window.renderTaskDetailsPage();
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'complete') initializeWriterBidding();
  else document.addEventListener('DOMContentLoaded',initializeWriterBidding,{once:true});
}
