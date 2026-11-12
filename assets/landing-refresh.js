// This walkthrough uses static sample content only. It does not access account data.
(() => {
  const demo = document.querySelector('[data-order-demo]');
  if (!demo) return;
  const tabs = Array.from(demo.querySelectorAll('[role="tab"]'));
  const panels = Array.from(demo.querySelectorAll('[role="tabpanel"]'));

  function activateTab(index, moveFocus = false) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (moveFocus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(index));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activateTab(next, true);
    });
  });
})();
