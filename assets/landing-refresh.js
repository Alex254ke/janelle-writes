// Only the mobile public page changes. Cache both trees so resizing preserves form state.
(() => {
  const landing = document.getElementById('landing-page');
  const template = document.getElementById('mobile-landing-template');
  if (!landing || !template) return;
  const mobile = window.matchMedia('(max-width:760px)');
  const desktopTree = document.createDocumentFragment();
  const mobileTree = template.content.cloneNode(true);
  let showingMobile = false;

  function bindDemo(root) {
    const demo = root.querySelector('[data-order-demo]');
    if (!demo) return;
    const tabs = Array.from(demo.querySelectorAll('[role="tab"]'));
    const panels = Array.from(demo.querySelectorAll('[role="tabpanel"]'));
    function activate(index, focus = false) {
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
        panels[i].hidden = i !== index;
      });
      if (focus) tabs[index].focus();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(index));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(next, true);
      });
    });
  }
  bindDemo(mobileTree);

  function updateLayout() {
    if (mobile.matches === showingMobile) return;
    if (typeof closeLandingMenu === 'function') closeLandingMenu();
    const cached = showingMobile ? mobileTree : desktopTree;
    while (landing.firstChild) cached.appendChild(landing.firstChild);
    landing.appendChild(mobile.matches ? mobileTree : desktopTree);
    showingMobile = mobile.matches;
  }
  mobile.addEventListener('change', updateLayout);
  updateLayout();

  document.querySelectorAll('.auth-role-select .role-card').forEach(card => {
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      card.click();
    });
  });

  // Add labels without replacing rows or handlers; the CSS changes only phones.
  function labelOrderTables() {
    document.querySelectorAll('#page-emp-tasks table, #page-writer-tasks table, #page-writer-available table, #page-writer-bids table, #page-bid-requests table').forEach(table => {
      const headings = Array.from(table.querySelectorAll('thead th'), cell => cell.textContent.trim());
      if (!headings.length) return;
      table.classList.add('mobile-order-table');
      table.querySelectorAll('tbody tr').forEach(row => {
        Array.from(row.cells).forEach((cell, index) => {
          cell.dataset.mobileOrderLabel = cell.colSpan > 1 ? '' : (headings[index] || '');
        });
      });
    });
  }
  labelOrderTables();
  const workspace = document.getElementById('app-shell');
  if (workspace) new MutationObserver(labelOrderTables).observe(workspace, { childList:true, subtree:true });
})();
